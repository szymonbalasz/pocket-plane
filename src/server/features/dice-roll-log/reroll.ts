// `dice.reroll` (FR-DICE-62): rerolls the d20 of one roll of a `roll` entry, in the caller's
// transaction, no event of its own. A new immutable roll row (`replacesRollId`): only the d20
// term's dice new (adv / dis: both, kept recomputed), every other die and the constant copied;
// roll hooks **not** run, the old item's `mods` copied (a `natural` rule trigger doesn't fire).
// A new `roll` entry (the old payload with that item replaced + `replaces`, FR-DICE-64; audience
// copied, never re-stamped), then the old entry superseded (FR-DICE-63). The caller emits.
import {
  type DiceTerm,
  diceTerms,
  keptFlags,
  parseExpression,
} from "@shared/dice-roll-log/grammar";
import { d20TermIndex } from "@shared/dice-roll-log/reroll";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import {
  type DieResult,
  type ManualEntry,
  RollEntryPayload,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { modsTotal } from "@shared/effect-modifiers/line";
import { and, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { rollDice } from "../../commands/dice";
import { conflict, invalid, notFound } from "../../commands/errors";
import { roll } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { keptSum, naturalOf, type Roll } from "./evaluate";
import { append, readEntry, supersede, supersedeBlock } from "./game-log";
import { campaignOf } from "./settings";

export interface RerollInput {
  entryId: string;
  rollId: string;
  /** FR-DICE-62 / FR-GEM-21: the new d20(s) by hand (adv / dis: `dice` with both). */
  manual?: ManualEntry;
}

export interface RerollResult {
  /** The new roll row. */
  roll: Roll;
  /** Its payload item (with `replaces`) and the old item's total. */
  item: RollPayloadItem;
  was: number;
  /** The new entry's upsert. */
  entry: RecordChange;
  /** The old entry's supersede upsert. */
  superseded: RecordChange;
}

const manualIssue = (message: string, path: (string | number)[] = []) =>
  invalid(message, [{ path: ["manual", ...path], message }]);

/** The d20 term's values: from `ctx.dice`, or the player's (FR-DICE-06 rules for that term). */
function d20Values(env: CommandEnv, term: DiceTerm, manual: ManualEntry | undefined): number[] {
  if (!manual) {
    const rolled = rollDice(env.ctx.dice, `${term.count}d20`);
    return (rolled.dice[0] ?? []).map((d) => d.value);
  }
  const values = manual.dice ?? (term.count === 1 ? [manual.diceTotal] : null);
  if (!values) throw manualIssue(`Enter both d20 values`, ["dice"]);
  if (values.length !== term.count) throw manualIssue(`Enter ${term.count} dice values`, ["dice"]);
  values.forEach((v, i) => {
    if (v < 1 || v > 20) throw manualIssue(`Die ${i + 1} must be 1–20`, ["dice", i]);
  });
  const kept = keptFlags(term, values);
  const sum = values.reduce((s, v, i) => s + (kept[i] ? v : 0), 0);
  if (sum !== manual.diceTotal) {
    throw manualIssue("Dice values must add up to the dice total", ["dice"]);
  }
  return values;
}

export function reroll(env: CommandEnv, input: RerollInput): RerollResult {
  const cid = campaignOf(env.actor);
  const old = readEntry(env, input.entryId);
  if (!old) throw notFound("Log entry not found");
  if (old.kind !== ROLL_KIND) throw conflict("Not a roll");
  const block = supersedeBlock(old);
  if (block) throw conflict(block);
  const items = RollEntryPayload.parse(old.payload);
  const at = items.findIndex((i) => i.rollId === input.rollId);
  const oldItem = items[at];
  if (!oldItem || !old.rollIds.includes(input.rollId)) throw conflict("Not a roll of this entry");
  const row = env.tx
    .select()
    .from(roll)
    .where(and(eq(roll.id, input.rollId), eq(roll.campaignId, cid)))
    .get();
  if (!row) throw new Error(`Roll ${input.rollId} missing`);
  const parsed = parseExpression(row.expression);
  const terms = parsed.ok ? diceTerms(parsed.value) : [];
  const d20 = d20TermIndex(terms);
  const term = terms[d20];
  if (!parsed.ok || !term) throw conflict("No d20 to reroll");
  // The d20 term's dice in the stored list (notation order).
  const from = terms.slice(0, d20).reduce((s, t) => s + t.count, 0);
  const oldDice = row.dice as DieResult[];
  if (oldDice.some((d, i) => d.value === null && (i < from || i >= from + term.count))) {
    throw conflict("This roll's other dice aren't known: reroll it at the table");
  }
  const values = d20Values(env, term, input.manual);
  const kept = keptFlags(term, values);
  const dice: DieResult[] = [
    ...oldDice.slice(0, from),
    ...values.map((value, i) => ({ faces: 20, value, kept: kept[i] ?? true })),
    ...oldDice.slice(from + term.count),
  ];
  const total = keptSum(terms, dice) + row.constant;
  const next: Roll = {
    ...row,
    id: env.ctx.ids.next(),
    at: env.ctx.clock.iso(),
    rollerRole: env.actor.role === "player" ? "player" : "dm",
    rollerPlayerId: env.actor.role === "player" ? env.actor.playerId : null,
    manual: input.manual !== undefined,
    dice,
    total,
    natural: naturalOf(parsed.value, dice),
    replacesRollId: row.id,
  };
  env.tx.insert(roll).values(next).run();
  const item: RollPayloadItem = {
    ...oldItem,
    rollId: next.id,
    manual: next.manual,
    dice,
    total: total + modsTotal(oldItem.mods),
    natural: next.natural,
    replaces: { entryId: old.id, total: oldItem.total },
  };
  const entry = append(env, {
    kind: ROLL_KIND,
    category: old.category,
    actorName: old.actorName,
    payload: items.map((x, i) => (i === at ? item : x)),
    dmPayload: old.dmPayload,
    rollIds: old.rollIds.map((id) => (id === row.id ? next.id : id)),
    encounterId: old.encounterId,
    copyAudience: { public: old.public, audiencePlayerId: old.audiencePlayerId },
  });
  const superseded = supersede(env, old.id, entry.id);
  return { roll: next, item, was: oldItem.total, entry, superseded };
}
