// Inspiration reroll (GEM FR-GEM-18–24, GM1): the eligibility rule on top of dice-roll-log's
// generic reroll (`rerollableRoll`, FR-DICE-70), and the spend's target detail by audience
// (FR-GEM-13). The command (`gem.spend`) writes count + spend line + reroll in one transaction.
import { inRerollWindow, isAnswerEntry, rerollableRoll } from "@shared/dice-roll-log/reroll";
import {
  GAME_LOG_WINDOW,
  type GameLogEntryRecord,
  LABEL_MAX,
  RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import type { GemSpendTarget } from "@shared/gems/log-kinds";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { eq, max } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { gameLogEntry, roll } from "../../db/schema";
import { cards } from "../combat-tracker/cards";
import { readEntry } from "../dice-roll-log/game-log";

type Env = Pick<CommandEnv, "tx" | "actor">;

/** FR-GEM-18 (OQ-GEM-20 A): rule-driven rolls the table rerolls by hand. */
export const RULE_DRIVEN = "Death and concentration saves are rerolled at the table";

export interface RerollTarget {
  entry: GameLogEntryRecord;
  rollId: string;
  /** The pending, unruled card a combat to-hit belongs to (FR-GEM-22). */
  card: NotificationRecord | null;
}

/**
 * The entry a reroll names, as the actor may see it: a player gets `not_found` for an entry
 * they don't receive (GEM §11), as for an unknown id.
 */
export function visibleEntry(env: Env, entryId: string): GameLogEntryRecord {
  const e = readEntry(env, entryId);
  const a = env.actor;
  const sees =
    e !== undefined &&
    (a.role !== "player" ||
      e.public ||
      (e.audiencePlayerId !== null && e.audiencePlayerId === a.playerId));
  if (!e || !sees) throw notFound("Log entry not found");
  return e;
}

/**
 * FR-GEM-18 (OQ-GEM-05 A, OQ-GEM-20 A): the character's own d20 roll (`rerollableRoll`: not
 * initiative, not undone / superseded) in the newest-100 window, written by an allowlisted
 * command (free `dice.roll`, the sheet's checks / saves / skills / to-hits, combat to-hits and
 * the DM's combatant checks / saves); never a rule-driven roll (death and concentration saves:
 * their line states the outcome, `note`); a combat to-hit only while its card is pending and
 * unruled. Else `conflict` with the reason.
 */
export function rerollTarget(
  env: Env,
  character: { id: string; name: string },
  entry: GameLogEntryRecord,
): RerollTarget {
  const rollId = rerollableRoll(entry);
  if (!rollId) {
    if (entry.supersededBy !== null) throw conflict("Already rerolled");
    if (entry.undone) throw conflict("Undone");
    if (entry.category === "initiative") throw conflict("Initiative can't be rerolled");
    if (isAnswerEntry(entry)) throw conflict("A requested roll can't be rerolled"); // FR-DICEX-78
    throw conflict("No d20 roll to reroll");
  }
  const newest = env.tx
    .select({ n: max(gameLogEntry.n) })
    .from(gameLogEntry)
    .where(eq(gameLogEntry.campaignId, entry.campaignId))
    .get();
  if (!inRerollWindow(entry.n, newest?.n ?? entry.n)) {
    throw conflict(`Only the newest ${GAME_LOG_WINDOW} lines can be rerolled`);
  }
  const row = env.tx.select().from(roll).where(eq(roll.id, rollId)).get();
  if (row?.actorKind !== "entity" || row.actorId !== character.id) {
    throw conflict(`Not ${character.name}'s roll`);
  }
  const item = RollEntryPayload.parse(entry.payload).find((i) => i.rollId === rollId);
  if (item?.note !== undefined) throw conflict(RULE_DRIVEN);
  // FR-GEM-22: a combat to-hit follows its card: only while pending and unruled.
  const found = row.source === "cbt" ? cards.findToHitCard(env, rollId) : null;
  if (row.source === "cbt" && row.category === "attack") {
    if (!found) throw conflict("The attack was already applied");
    const block = cards.toHitBlock(env, found.card);
    if (block) throw conflict(block);
  }
  return { entry, rollId, card: found?.card ?? null };
}

/** FR-GEM-19: the spend line's target: the line's label (else its expression) and old total. */
export function entryTarget(entry: GameLogEntryRecord, rollId: string): GemSpendTarget {
  const item = RollEntryPayload.parse(entry.payload).find((i) => i.rollId === rollId);
  const label = item?.label ?? item?.expression ?? "a roll";
  return {
    kind: "entry",
    id: entry.id,
    label: label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label,
    from: item?.total ?? 0,
  };
}

/**
 * FR-GEM-13 (rulings-a #1): the target detail takes the target's audience: a public line → the
 * spend's `payload`; anything narrower (a hidden roll) → `dmPayload`, the public line names no
 * detail (`target: null`).
 */
export function targetByAudience(entry: GameLogEntryRecord, target: GemSpendTarget) {
  return entry.public
    ? { payload: { target }, dmPayload: undefined }
    : { payload: { target: null }, dmPayload: { target } };
}
