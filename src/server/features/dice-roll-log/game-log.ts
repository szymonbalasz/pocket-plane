// `gameLog.append` / `gameLog.markUndone` (FR-DICE-19): in the caller's transaction, no events;
// they return the `game-log-entry` change for the caller's event.
import { getLogKind } from "@shared/dice-roll-log/kinds";
import {
  categoryPublic,
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryRecord,
  type RollCategory,
} from "@shared/dice-roll-log/schemas";
import { and, eq, max } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { gameLogEntry } from "../../db/schema";
import type { RecordChange } from "../../events/types";
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
}

type EntryRow = typeof gameLogEntry.$inferSelect;

export function toEntryRecord(row: EntryRow): GameLogEntryRecord {
  return {
    ...row,
    dmPayload: row.dmPayload ?? null,
    rollIds: row.rollIds as string[],
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
 */
function stampPublic(env: CommandEnv, cid: string, input: AppendInput): boolean {
  if (env.actor.role === "player") return true;
  return input.public ?? categoryPublic(readSettings(env.tx, cid), input.category);
}

export function append(env: CommandEnv, input: AppendInput): RecordChange {
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
      supersededBy: null,
    })
    .run();
  const after = toEntryRecord(getEntry(env.tx, cid, id) as EntryRow);
  return { type: GAME_LOG_ENTRY_TYPE, id, before: null, after };
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
