// `gameLog.append` / `gameLog.markUndone` (FR-DICE-19) / `gameLog.supersede` (FR-DICE-63): in
// the caller's transaction, no events; they return the `game-log-entry` change for the caller's
// event.
import { getLogKind } from "@shared/dice-roll-log/kinds";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import {
  categoryPublic,
  type EntryStamp,
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryRecord,
  type RollCategory,
  RollEntryDmPayload,
  RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { and, eq, max } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { gameLogEntry } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { rollGuarded } from "./roll-guard";
import { campaignOf, readSettings } from "./settings";

export interface AppendInput {
  kind: string;
  category: RollCategory;
  actorName: string;
  payload: unknown;
  dmPayload?: unknown;
  rollIds: string[];
  encounterId?: string | null;
  /** DM rollers only (FR-DICE-13); ignored when the roller is a player. */
  public?: boolean;
  /**
   * The roll's actor is hidden from players (e.g. a hidden PC's death save, FR-CBTX-23): the
   * entry is DM-only whoever rolls; wins over `public` and the player stamp.
   */
  forcePrivate?: boolean;
  /**
   * Sprint 6 (ADR-0056, FR-CBT-114): a companion's roll line: DM + this player (the owner)
   * only, whoever rolls (`public` false). Null / absent = the usual stamp.
   */
  audiencePlayerId?: string | null;
  /**
   * Sprint 7 (FR-DICE-62): a reroll's entry copies the old entry's audience as stamped (never
   * re-stamped, ADR-0056); wins over every other stamp. FR-DICE-101: a hidden line's `hiddenFrom`
   * comes along, so a reveal restores the same audience on both lines.
   */
  copyAudience?: {
    public: boolean;
    audiencePlayerId: string | null;
    hiddenFrom: EntryStamp | null;
  };
  /**
   * Sprint 8 (FR-DICE-79, -83; ADR-0061): a roll-request answer's audience, stamped by the server
   * from the request, never from an intent field (a player-sent `public` stays `forbidden`):
   * public → `{public: true}`; hidden → `{public: false, audiencePlayerId}` = the target's player
   * (DM + that player, whoever rolls). Wins over the role / category stamp and `forcePrivate`;
   * never combined with `copyAudience`.
   */
  audience?: EntryAudience;
}

/** FR-DICE-83: the internal audience input of `gameLog.append` and the sheet roll helper. */
export type EntryAudience = { public: true } | { public: false; audiencePlayerId: string };

type EntryRow = typeof gameLogEntry.$inferSelect;

export function toEntryRecord(row: EntryRow): GameLogEntryRecord {
  return {
    ...row,
    dmPayload: row.dmPayload ?? null,
    rollIds: row.rollIds as string[],
    hiddenFrom: (row.hiddenFrom as EntryStamp | null) ?? null,
  };
}

function getEntry(tx: Pick<Tx, "select">, campaignId: string, id: string): EntryRow | undefined {
  return tx
    .select()
    .from(gameLogEntry)
    .where(and(eq(gameLogEntry.id, id), eq(gameLogEntry.campaignId, campaignId)))
    .get();
}

/**
 * FR-DICE-13: `public` stamped once, by who rolls. Player → always true. DM (and the fixture
 * loader, which runs as DM) → the override if given, else the category's setting at commit.
 * `forcePrivate` → false for anyone. A copied (reroll) or request (`audience`) stamp wins.
 * Sprint 14 (#367): a DM entry whose roll was made as a hidden or renamed monster creature →
 * false, over every stamp (`rollGuarded`).
 */
function stampPublic(env: CommandEnv, cid: string, input: AppendInput): boolean {
  const stamped = baseStamp(env, cid, input);
  if (!stamped || env.actor.role === "player") return stamped;
  return !rollGuarded(env, cid, input.rollIds, input.encounterId);
}

function baseStamp(env: CommandEnv, cid: string, input: AppendInput): boolean {
  if (input.copyAudience) return input.copyAudience.public;
  if (input.audience) return input.audience.public;
  if (input.forcePrivate || input.audiencePlayerId) return false;
  if (env.actor.role === "player") return true;
  return input.public ?? categoryPublic(readSettings(env.tx, cid), input.category);
}

/** The entry's `audiencePlayerId`: the copied / request audience, else the companion owner. */
function audiencePlayerOf(input: AppendInput): string | null {
  if (input.copyAudience) return input.copyAudience.audiencePlayerId;
  if (input.audience) return input.audience.public ? null : input.audience.audiencePlayerId;
  return input.forcePrivate ? null : (input.audiencePlayerId ?? null);
}

export function append(env: CommandEnv, input: AppendInput): RecordChange {
  if (env.actor.role === "system") throw new Error("gameLog.append: the system actor never logs"); // FR-DICE-61
  const cid = campaignOf(env.actor);
  const def = getLogKind(input.kind);
  // FR-DICE-18: an unregistered kind or a bad payload is a programming error → `internal`.
  if (!def) throw new Error(`Unregistered log-entry kind "${input.kind}"`);
  const payload = def.payload.parse(input.payload);
  let dmPayload: unknown = null;
  if (input.dmPayload !== undefined && input.dmPayload !== null) {
    if (!def.dmPayload) throw new Error(`Log-entry kind "${input.kind}" has no dmPayload`);
    dmPayload = def.dmPayload.parse(input.dmPayload);
  }
  if (input.rollIds.length > 20) throw new Error("At most 20 rolls per entry");
  // FR-DICE-17: per-campaign counter, max + 1 inside the transaction.
  const top = env.tx
    .select({ n: max(gameLogEntry.n) })
    .from(gameLogEntry)
    .where(eq(gameLogEntry.campaignId, cid))
    .get();
  const n = (top?.n ?? 0) + 1;
  const id = env.ctx.ids.next();
  env.tx
    .insert(gameLogEntry)
    .values({
      id,
      campaignId: cid,
      n,
      at: env.ctx.clock.iso(),
      kind: input.kind,
      category: input.category,
      public: stampPublic(env, cid, input),
      undone: false,
      rollerRole: env.actor.role === "player" ? "player" : "dm",
      rollerPlayerId: env.actor.role === "player" ? env.actor.playerId : null,
      actorName: input.actorName,
      payload,
      dmPayload,
      rollIds: input.rollIds,
      encounterId: input.encounterId ?? null,
      audiencePlayerId: audiencePlayerOf(input),
      supersededBy: null,
      hiddenFrom: input.copyAudience?.hiddenFrom ?? null,
    })
    .run();
  const after = toEntryRecord(getEntry(env.tx, cid, id) as EntryRow);
  return { type: GAME_LOG_ENTRY_TYPE, id, before: null, after };
}

/** An entry of the actor's campaign as a record, or undefined. */
export function readEntry(env: Pick<CommandEnv, "tx" | "actor">, id: string) {
  const row = getEntry(env.tx, campaignOf(env.actor), id);
  return row ? toEntryRecord(row) : undefined;
}

/** FR-DICE-63: the reason an entry can't be superseded (or rerolled), or null. */
export function supersedeBlock(e: Pick<GameLogEntryRecord, "undone" | "supersededBy">) {
  if (e.supersededBy !== null) return "Already rerolled";
  if (e.undone) return "Undone";
  return null;
}

/**
 * FR-DICE-63: sets `supersededBy` once (`null` → the new entry), like `markUndone`; already set
 * or undone → `conflict`. The entry's rolls stay immutable (FR-DICE-08).
 */
export function supersede(env: CommandEnv, entryId: string, newEntryId: string): RecordChange {
  const cid = campaignOf(env.actor);
  const row = getEntry(env.tx, cid, entryId);
  if (!row) throw notFound("Log entry not found");
  const before = toEntryRecord(row);
  const block = supersedeBlock(before);
  if (block) throw conflict(block);
  env.tx
    .update(gameLogEntry)
    .set({ supersededBy: newEntryId })
    .where(eq(gameLogEntry.id, entryId))
    .run();
  const after = toEntryRecord(getEntry(env.tx, cid, entryId) as EntryRow);
  return { type: GAME_LOG_ENTRY_TYPE, id: entryId, before, after };
}

/** Sets `undone` (combat undo). Entry of another campaign / unknown → `not_found`. */
export function markUndone(env: CommandEnv, entryId: string): RecordChange {
  const cid = campaignOf(env.actor);
  const row = getEntry(env.tx, cid, entryId);
  if (!row) throw notFound("Log entry not found");
  env.tx.update(gameLogEntry).set({ undone: true }).where(eq(gameLogEntry.id, entryId)).run();
  const after = toEntryRecord(getEntry(env.tx, cid, entryId) as EntryRow);
  return { type: GAME_LOG_ENTRY_TYPE, id: entryId, before: toEntryRecord(row), after };
}

/** FR-DICE-96: `markUsed`'s refusal for an entry already stamped. */
export const ALREADY_USED = "Already used by a card";

/**
 * FR-DICE-96 (#385): stamps a `roll` entry's DM-only `dmPayload.usedByCardId` once, in the
 * caller's transaction (combat's `cbt.useRoll`); already stamped → `conflict`. An entry without a
 * `dmPayload` gets one with empty names per item. Never cleared; no event (the caller emits).
 */
export function markUsed(env: CommandEnv, entryId: string, cardId: string): RecordChange {
  const cid = campaignOf(env.actor);
  const row = getEntry(env.tx, cid, entryId);
  if (!row) throw notFound("Log entry not found");
  if (row.kind !== ROLL_KIND) throw new Error(`gameLog.markUsed: entry ${entryId} is no roll`);
  const before = toEntryRecord(row);
  const items = RollEntryPayload.parse(row.payload);
  const dm: RollEntryDmPayload =
    row.dmPayload === null
      ? { items: items.map(() => ({ mods: [] })) }
      : RollEntryDmPayload.parse(row.dmPayload);
  if (dm.usedByCardId !== undefined) throw conflict(ALREADY_USED);
  const dmPayload = RollEntryDmPayload.parse({ ...dm, usedByCardId: cardId });
  env.tx.update(gameLogEntry).set({ dmPayload }).where(eq(gameLogEntry.id, entryId)).run();
  const after = toEntryRecord(getEntry(env.tx, cid, entryId) as EntryRow);
  return { type: GAME_LOG_ENTRY_TYPE, id: entryId, before, after };
}
