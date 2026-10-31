// `share.toLog` (FR-SHARE-01–10): posts an entry's or a sheet row's full text to the game log,
// public. The server reads the text from what the sender may read; the intent only names it.
import { sourceRank } from "@shared/compendium/match";
import { type CompendiumKind, entryNameKey } from "@shared/compendium/schemas";
import { GAME_LOG_ENTRY_TYPE, GAME_LOG_WINDOW } from "@shared/dice-roll-log/schemas";
import type { CharacterRecord } from "@shared/entities/schemas";
import { LogEntryShared } from "@shared/events/log-share";
import {
  LOG_KIND_SHARE,
  SHARE_TO_LOG,
  SHARE_WINDOW_TEXT_MAX,
  SharePayload,
  ShareToLogIntent,
  type ShareToLogResult,
} from "@shared/log-share/schemas";
import { attackShareLine, entryShareText, sharePayload, withNotes } from "@shared/log-share/text";
import { and, desc, eq, gt, max } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { compendiumEntry, entity, gameLogEntry, player } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { authorizedCharacter } from "../character-sheet/commands";
import { getSheet } from "../character-sheet/sheet-rows";
import { type EntryRow, getEntry } from "../compendium/entries";
import { entryVisibleTo } from "../compendium/visibility";
import { gameLog } from "../dice-roll-log";
import { readEntry, toEntryRecord } from "../dice-roll-log/game-log";

const ROW_GONE = "That row is no longer on the sheet";

type SheetShare = Extract<ShareToLogIntent, { from: "sheet" }>;

function campaignOf(env: CommandEnv): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

const viewerOf = (env: CommandEnv) => ({
  role: env.actor.role === "player" ? ("player" as const) : ("dm" as const),
  campaignId: campaignOf(env),
  playerId: env.actor.playerId,
});

/** FR-SHARE-09: who a compendium share reads as: the player's one character, else their name. */
function senderName(env: CommandEnv): string {
  if (env.actor.role !== "player") return "DM";
  const cid = campaignOf(env);
  const playerId = env.actor.playerId ?? "";
  const own = env.tx
    .select({ name: entity.name })
    .from(entity)
    .where(
      and(
        eq(entity.campaignId, cid),
        eq(entity.kind, "character"),
        eq(entity.ownerPlayerId, playerId),
      ),
    )
    .all();
  if (own.length === 1) return (own[0] as { name: string }).name;
  const p = env.tx
    .select({ name: player.name })
    .from(player)
    .where(and(eq(player.id, playerId), eq(player.campaignId, cid)))
    .get();
  if (!p) throw notFound("Player not found");
  return p.name;
}

/**
 * FR-SHARE-04: sheet rows hold no rules text, so a row reads the compendium entry of its name the
 * sender may read: the campaign's own first (source rank, FR-CMP-38), never one another candidate
 * replaces (FR-CMPX-13). None → the row's own words.
 */
function entryNamed(env: CommandEnv, kind: CompendiumKind, name: string): EntryRow | null {
  const viewer = viewerOf(env);
  const rows = env.tx
    .select()
    .from(compendiumEntry)
    .where(and(eq(compendiumEntry.kind, kind), eq(compendiumEntry.nameKey, entryNameKey(name))))
    .all()
    .filter((e) => entryVisibleTo(e, viewer));
  const replaced = new Set(rows.flatMap((e) => e.replaces));
  const live = rows.filter((e) => !replaced.has(`${e.source}:${e.sourceKey}`));
  live.sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || (a.id < b.id ? -1 : 1));
  return live[0] ?? null;
}

interface Built {
  actorName: string;
  title: string;
  line: string;
  text: string;
}

/** FR-SHARE-01, -10: an entry the sender may read (else `not_found`), never a monster. */
function fromCompendium(env: CommandEnv, entryId: string): Built {
  const e = getEntry(env.tx, entryId);
  if (!e || !entryVisibleTo(e, viewerOf(env))) throw notFound("Entry not found");
  if (e.kind === "monster") {
    throw invalid("Monster stat blocks can't be shared", [
      { path: ["entryId"], message: "Monsters aren't shared" },
    ]);
  }
  return { actorName: senderName(env), title: e.name, line: e.line, text: entryShareText(e) };
}

/** FR-SHARE-04: a row's clipped text (`cmp.addToSheet`, "…") stands for the whole entry's. */
function featureText(rowText: string, entryText: string | null): string {
  if (entryText === null) return rowText;
  if (rowText.trim() === "") return entryText;
  if (!rowText.endsWith("…")) return rowText;
  return entryText.startsWith(rowText.slice(0, -1).trimEnd()) ? entryText : rowText;
}

function sheetRow(env: CommandEnv, c: CharacterRecord, input: SheetShare): Built {
  const sheet = getSheet(env.tx, c.id);
  const lookedUp = (kind: CompendiumKind, rowName: string) => {
    const e = entryNamed(env, kind, rowName);
    return e ? { line: e.line, text: entryShareText(e) } : null;
  };
  const base = { actorName: c.name };
  switch (input.list) {
    case "attacks": {
      const a = c.statBlock.attacks.find((r) => r.id === input.rowId);
      if (!a) throw notFound(ROW_GONE);
      return {
        ...base,
        title: a.name,
        line: attackShareLine(a),
        text: lookedUp("item", a.name)?.text ?? "",
      };
    }
    case "spells": {
      const s = sheet?.spells.find((r) => r.id === input.rowId);
      if (!s) throw notFound(ROW_GONE);
      const e = lookedUp("spell", s.name);
      return {
        ...base,
        title: s.name,
        line: e?.line ?? (s.level === 0 ? "Cantrip" : `Level ${s.level} spell`),
        text: withNotes(e?.text ?? "", s.notes),
      };
    }
    case "features": {
      const f = sheet?.features.find((r) => r.id === input.rowId);
      if (!f) throw notFound(ROW_GONE);
      const e = lookedUp("feature", f.name);
      return {
        ...base,
        title: f.name,
        line: f.source || (e?.line ?? ""),
        text: featureText(f.text, e?.text ?? null),
      };
    }
    case "items": {
      const it = sheet?.items.find((r) => r.id === input.rowId);
      if (!it) throw notFound(ROW_GONE);
      const e = lookedUp("item", it.name);
      return {
        ...base,
        title: it.name,
        line: e?.line ?? "",
        text: withNotes(e?.text ?? "", it.notes),
      };
    }
  }
}

/**
 * FR-SHARE-08: the window's shared text stays within `SHARE_WINDOW_TEXT_MAX`, newest first: an
 * older share past it keeps its head and loses its text. A snapshot therefore grows by a bounded
 * amount however many shares are made (CON-44).
 */
function foldOlder(env: CommandEnv, cid: string): RecordChange[] {
  const top = env.tx
    .select({ n: max(gameLogEntry.n) })
    .from(gameLogEntry)
    .where(eq(gameLogEntry.campaignId, cid))
    .get();
  const rows = env.tx
    .select()
    .from(gameLogEntry)
    .where(
      and(
        eq(gameLogEntry.campaignId, cid),
        eq(gameLogEntry.kind, LOG_KIND_SHARE),
        gt(gameLogEntry.n, (top?.n ?? 0) - GAME_LOG_WINDOW),
      ),
    )
    .orderBy(desc(gameLogEntry.n))
    .all();
  const changes: RecordChange[] = [];
  let kept = 0;
  for (const row of rows) {
    const p = SharePayload.parse(row.payload);
    kept += p.text.length;
    if (kept <= SHARE_WINDOW_TEXT_MAX || p.folded) continue;
    const { cut: _cut, ...rest } = p;
    const before = toEntryRecord(row);
    env.tx
      .update(gameLogEntry)
      .set({ payload: { ...rest, text: "", folded: true } })
      .where(eq(gameLogEntry.id, row.id))
      .run();
    const after = readEntry(env, row.id) as NonNullable<ReturnType<typeof readEntry>>;
    changes.push({ type: GAME_LOG_ENTRY_TYPE, id: row.id, before, after });
  }
  return changes;
}

export const shareToLog = defineCommand({
  name: SHARE_TO_LOG,
  input: ShareToLogIntent,
  roles: ["dm", "player"],
  execute(input, env): ShareToLogResult {
    const cid = campaignOf(env);
    // FR-SHARE-02, -10: a sheet row: the DM any character of the campaign, a player their own.
    const built =
      input.from === "compendium"
        ? fromCompendium(env, input.entryId)
        : sheetRow(env, authorizedCharacter(env, input.creatureId), input);
    const payload = sharePayload(built);
    const change = gameLog.append(env, {
      kind: LOG_KIND_SHARE,
      category: "other",
      actorName: built.actorName,
      payload,
      rollIds: [],
      // FR-SHARE-05: for the whole table, whatever the DM's category setting says.
      public: true,
    });
    env.emit({
      type: LogEntryShared.type,
      campaignId: cid,
      payload: { entryId: change.id, from: input.from, title: payload.title },
      changes: [change, ...foldOlder(env, cid)],
    });
    return { entryId: change.id };
  },
});
