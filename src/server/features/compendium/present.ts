// Entry present (CMP §6.2, FR-CMP-78–83; DM #455): `cmp.presentEntry` (DM) opens a compendium
// entry on every player's screen; `cmp.closeEntryPresent` (DM, player) closes a row; an unshare
// or delete of a homebrew entry closes its rows (FR-CMP-82). Record `entry-present` is in the
// snapshot (it must reach a player who never opens the Compendium): DM every row, a player only
// their own. No notification: the popup is the alert (as FR-PARTY-32).
import {
  CloseEntryPresentIntent,
  ENTRY_PRESENT_INTENTS,
  ENTRY_PRESENT_TYPE,
  EntryPresentRecord,
  entryPresentVisibility,
  MONSTER_NOT_SHOWN,
  NO_PLAYERS,
  PresentEntryIntent,
  type PresentEntryResult,
  SHARE_ENTRY_FIRST,
} from "@shared/compendium/present";
import { COMPENDIUM_KINDS, entryNameKey } from "@shared/compendium/schemas";
import { EntryPresentClosed, EntryPresented } from "@shared/events/compendium";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Db, Tx } from "../../db/client";
import { compendiumEntry, entryPresent, player } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { defineRecordType } from "../../ws/records";
import { getEntry } from "./entries";
import { campaignOf } from "./homebrew";
import { entryVisibleTo } from "./visibility";

type Reader = Pick<Db | Tx, "select">;
type Row = typeof entryPresent.$inferSelect;

const ENTRY_NOT_FOUND = "Entry not found";
const PRESENT_NOT_FOUND = "Not found";

const toRecord = (r: Row): EntryPresentRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  entryId: r.entryId,
  playerId: r.playerId,
  presentedAt: r.presentedAt,
});

const order = [asc(entryPresent.presentedAt), asc(entryPresent.id)] as const;

/** Snapshot rows: the campaign's presents (`playerId` given → only that player's). */
export function listEntryPresents(
  db: Reader,
  campaignId: string,
  playerId?: string,
): EntryPresentRecord[] {
  return db
    .select()
    .from(entryPresent)
    .where(
      playerId === undefined
        ? eq(entryPresent.campaignId, campaignId)
        : and(eq(entryPresent.campaignId, campaignId), eq(entryPresent.playerId, playerId)),
    )
    .orderBy(...order)
    .all()
    .map(toRecord);
}

/** FR-CMP-78: not lazy; ≤ players rows for the DM, ≤ 1 for a player. */
export const entryPresentType = defineRecordType<EntryPresentRecord>({
  type: ENTRY_PRESENT_TYPE,
  scope: "campaign",
  schema: EntryPresentRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => entryPresentVisibility(r, v),
  snapshot: ({ db }, v) =>
    v.role === "dm"
      ? listEntryPresents(db, v.campaignId)
      : v.playerId === null
        ? []
        : listEntryPresents(db, v.campaignId, v.playerId),
});

function deleteRows(env: Pick<CommandEnv, "tx">, rows: readonly EntryPresentRecord[]) {
  if (rows.length === 0) return [];
  env.tx
    .delete(entryPresent)
    .where(
      inArray(
        entryPresent.id,
        rows.map((r) => r.id),
      ),
    )
    .run();
  return rows.map(
    (r): RecordChange => ({ type: ENTRY_PRESENT_TYPE, id: r.id, before: r, after: null }),
  );
}

/**
 * FR-CMP-82: every row of `entryId`, deleted (a homebrew unshare or delete); the caller puts the
 * changes in its own event.
 */
export function closeEntryPresents(env: Pick<CommandEnv, "tx">, entryId: string): RecordChange[] {
  const rows = env.tx
    .select()
    .from(entryPresent)
    .where(eq(entryPresent.entryId, entryId))
    .orderBy(...order)
    .all()
    .map(toRecord);
  return deleteRows(env, rows);
}

/**
 * FR-CMP-79 per target: delete their current row (any entry), insert a new one (id `ctx.ids`,
 * `presentedAt` now), emit `EntryPresented`. Returns the new ids in target order.
 */
function presentTo(
  env: CommandEnv,
  campaignId: string,
  entryId: string,
  playerIds: readonly string[],
): string[] {
  const changes: RecordChange[] = [];
  const presentIds: string[] = [];
  const now = env.ctx.clock.iso();
  for (const playerId of playerIds) {
    const old = env.tx
      .select()
      .from(entryPresent)
      .where(and(eq(entryPresent.campaignId, campaignId), eq(entryPresent.playerId, playerId)))
      .get();
    if (old) changes.push(...deleteRows(env, [toRecord(old)]));
    const row: EntryPresentRecord = {
      id: env.ctx.ids.next(),
      campaignId,
      entryId,
      playerId,
      presentedAt: now,
    };
    env.tx.insert(entryPresent).values(row).run();
    changes.push({ type: ENTRY_PRESENT_TYPE, id: row.id, before: null, after: row });
    presentIds.push(row.id);
  }
  env.emit({
    type: EntryPresented.type,
    campaignId,
    payload: { entryId, playerIds: [...playerIds] },
    changes,
  });
  return presentIds;
}

/** FR-CMP-79's checks and targets: every player of the campaign, when players may read it. */
function present(env: CommandEnv, entryId: string): PresentEntryResult {
  const cid = campaignOf(env);
  const e = getEntry(env.tx, entryId);
  if (!e || !entryVisibleTo(e, { role: "dm", campaignId: cid, playerId: null })) {
    throw notFound(ENTRY_NOT_FOUND);
  }
  if (e.kind === "monster") {
    throw invalid(MONSTER_NOT_SHOWN, [{ path: ["entryId"], message: "A monster" }]);
  }
  const players = env.tx
    .select({ id: player.id })
    .from(player)
    .where(eq(player.campaignId, cid))
    .orderBy(asc(player.createdAt), asc(player.id))
    .all()
    .map((p) => p.id);
  // Same rule for every player of the campaign (FR-CMP-14): one check is enough.
  const readable = entryVisibleTo(e, {
    role: "player",
    campaignId: cid,
    playerId: players[0] ?? null,
  });
  if (!readable) throw conflict(SHARE_ENTRY_FIRST);
  if (players.length === 0) throw conflict(NO_PLAYERS);
  return { presentIds: presentTo(env, cid, e.id, players) };
}

/**
 * FR-CMP-79: `cmp.presentEntry {entryId}` (DM). Unknown or another campaign's → `not_found`; a
 * monster → `invalid`; unshared homebrew → `conflict` "Share it…"; no players → `conflict`.
 */
export const presentEntry = defineCommand({
  name: ENTRY_PRESENT_INTENTS.present,
  input: PresentEntryIntent,
  execute: ({ entryId }, env): PresentEntryResult => present(env, entryId),
});

/**
 * FR-CMP-81: a player closes only their own row (another's → `not_found`), the DM any row of the
 * campaign. Already gone → `ack`, no event (two devices closing at once).
 */
export const closeEntryPresent = defineCommand({
  name: ENTRY_PRESENT_INTENTS.close,
  input: CloseEntryPresentIntent,
  roles: ["dm", "player"],
  execute({ presentId }, env): void {
    const cid = campaignOf(env);
    const isDm = env.actor.role === "dm";
    const row = env.tx
      .select()
      .from(entryPresent)
      .where(and(eq(entryPresent.id, presentId), eq(entryPresent.campaignId, cid)))
      .get();
    if (!row) return;
    if (!isDm && row.playerId !== env.actor.playerId) throw notFound(PRESENT_NOT_FOUND);
    const r = toRecord(row);
    env.emit({
      type: EntryPresentClosed.type,
      campaignId: cid,
      payload: { entryId: r.entryId, playerIds: [r.playerId], by: isDm ? "dm" : "player" },
      changes: deleteRows(env, [r]),
    });
  },
});

/**
 * Fixtures only (not an intent; as `notes.seedBody`): `cmp.presentEntryByName {kind, name}` finds
 * the campaign's homebrew entry by name (refs can't name entries: they aren't records) and
 * presents it as `cmp.presentEntry`.
 */
export const presentEntryByName = defineCommand({
  name: "cmp.presentEntryByName",
  input: z.strictObject({ kind: z.enum(COMPENDIUM_KINDS), name: z.string().min(1).max(200) }),
  execute({ kind, name }, env): PresentEntryResult {
    const cid = campaignOf(env);
    const row = env.tx
      .select({ id: compendiumEntry.id })
      .from(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.campaignId, cid),
          eq(compendiumEntry.kind, kind),
          eq(compendiumEntry.nameKey, entryNameKey(name)),
        ),
      )
      .get();
    if (!row) throw notFound(ENTRY_NOT_FOUND);
    return present(env, row.id);
  },
});
