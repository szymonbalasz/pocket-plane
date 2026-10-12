// `dice.evaluate` (FR-DICE-19, FR-DICE-01–08): grammar + mode + manual checks, then one
// immutable `roll` row in the caller's transaction. No event; the caller logs and emits.
import {
  constantOf,
  type DiceTerm,
  diceCount,
  diceRange,
  diceTerms,
  keptFlags,
  prepareExpression,
  type Term,
  toNotation,
} from "@shared/dice-roll-log/grammar";
import {
  type DieResult,
  type ManualEntry,
  type RollCategory,
  RollLabel,
  type RollMode,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import type { CommandEnv } from "../../commands/commands";
import { rollDice } from "../../commands/dice";
import { CommandError, invalid } from "../../commands/errors";
import { roll } from "../../db/schema";
import { campaignOf } from "./settings";

export type RollSource = "dice" | "char" | "cbt";
export type RollActorKind = "dm" | "player" | "entity" | "token";

export interface EvaluateInput {
  expression: string;
  mode: RollMode;
  category: RollCategory;
  label?: string | null;
  /** Resolved by the caller; the name is copied into the row (FR-DICE-10). */
  actor: { kind: RollActorKind; id: string | null; name: string };
  manual?: ManualEntry;
  source: RollSource;
  target?: { entityId?: string | null; tokenId?: string | null; name: string | null };
}

/** A stored roll (data model §15). */
export type Roll = Omit<typeof roll.$inferSelect, "dice"> & { dice: DieResult[] };

const exprIssue = (message: string) => invalid(message, [{ path: ["expression"], message }]);
const manualIssue = (message: string, path: (string | number)[] = []) =>
  invalid(message, [{ path: ["manual", ...path], message }]);

/** Signed sum of kept dice with known values. */
function keptSum(terms: DiceTerm[], dice: DieResult[]): number {
  let at = 0;
  let sum = 0;
  for (const t of terms) {
    for (const d of dice.slice(at, at + t.count)) if (d.kept) sum += t.sign * (d.value ?? 0);
    at += t.count;
  }
  return sum;
}

/** FR-DICE-06: manual dice, validated against the final terms. */
function manualDice(terms: Term[], m: ManualEntry): DieResult[] {
  const dts = diceTerms(terms);
  const { min, max } = diceRange(terms);
  if (m.diceTotal < min || m.diceTotal > max) {
    throw manualIssue(`Dice total must be ${min}–${max}`, ["diceTotal"]);
  }
  const count = diceCount(terms);
  if (m.dice) {
    if (m.dice.length !== count) throw manualIssue(`Enter ${count} dice values`, ["dice"]);
    const out: DieResult[] = [];
    let at = 0;
    for (const t of dts) {
      const values = m.dice.slice(at, at + t.count);
      values.forEach((v, i) => {
        if (v > t.faces) {
          throw manualIssue(`Die ${at + i + 1} must be 1–${t.faces}`, ["dice", at + i]);
        }
      });
      const kept = keptFlags(t, values);
      values.forEach((v, i) => {
        out.push({ faces: t.faces, value: v, kept: kept[i] ?? true });
      });
      at += t.count;
    }
    if (keptSum(dts, out) !== m.diceTotal) {
      throw manualIssue("Dice values must add up to the dice total", ["dice"]);
    }
    return out;
  }
  if (count === 1) {
    const t = dts[0] as DiceTerm;
    return [{ faces: t.faces, value: t.sign * m.diceTotal, kept: true }];
  }
  // Several dice, total only: values unknown (null); kept = the first K of a keep term.
  return dts.flatMap((t) =>
    Array.from({ length: t.count }, (_, i) => ({
      faces: t.faces,
      value: null,
      kept: i < (t.keep ? t.keep.n : t.count),
    })),
  );
}

/** Rolled dice from `ctx.dice` via the library (FR-DICE-02, FR-DICE-03). */
function rolledDice(env: CommandEnv, terms: Term[]): { dice: DieResult[]; libraryTotal: number } {
  let rolled: ReturnType<typeof rollDice>;
  try {
    rolled = rollDice(env.ctx.dice, toNotation(terms));
  } catch (err) {
    if (err instanceof CommandError) throw err;
    throw exprIssue("Invalid dice expression");
  }
  const dts = diceTerms(terms);
  if (rolled.dice.length !== dts.length) throw new Error("Dice library term count mismatch");
  const dice = dts.flatMap((t, i) => {
    const group = rolled.dice[i] ?? [];
    if (group.length !== t.count) throw new Error("Dice library die count mismatch");
    return group.map((d) => ({ faces: t.faces, value: d.value, kept: d.kept }));
  });
  return { dice, libraryTotal: rolled.total };
}

/** `natural` = the value of the single kept d20 (positive term), else null. */
function naturalOf(terms: Term[], dice: DieResult[]): number | null {
  const kept: DieResult[] = [];
  let at = 0;
  for (const t of diceTerms(terms)) {
    for (const d of dice.slice(at, at + t.count)) {
      if (d.kept && d.faces === 20 && t.sign === 1) kept.push(d);
    }
    at += t.count;
  }
  return kept.length === 1 ? (kept[0]?.value ?? null) : null;
}

export function evaluate(env: CommandEnv, input: EvaluateInput): Roll {
  const cid = campaignOf(env.actor);
  const prepared = prepareExpression(input.expression, input.mode);
  if (!prepared.ok) throw exprIssue(prepared.message);
  const terms = prepared.value;
  const constant = constantOf(terms);
  const dts = diceTerms(terms);

  let dice: DieResult[];
  let total: number;
  if (input.manual) {
    dice = manualDice(terms, input.manual);
    total = input.manual.diceTotal + constant;
  } else {
    const r = rolledDice(env, terms);
    dice = r.dice;
    total = keptSum(dts, dice) + constant;
    if (total !== r.libraryTotal) throw new Error("Dice library total mismatch");
  }

  let label: string | null = null;
  if (input.label !== undefined && input.label !== null) {
    const lp = RollLabel.safeParse(input.label);
    if (!lp.success) {
      const message = lp.error.issues[0]?.message ?? "Invalid label";
      throw invalid(message, [{ path: ["label"], message }]);
    }
    label = lp.data === "" ? null : lp.data;
  }
  const row: Roll = {
    id: env.ctx.ids.next(),
    campaignId: cid,
    at: env.ctx.clock.iso(),
    rollerRole: env.actor.role === "player" ? "player" : "dm",
    rollerPlayerId: env.actor.role === "player" ? env.actor.playerId : null,
    actorKind: input.actor.kind,
    actorId: input.actor.id,
    actorName: input.actor.name,
    targetEntityId: input.target?.entityId ?? null,
    targetTokenId: input.target?.tokenId ?? null,
    targetName: input.target?.name ?? null,
    category: input.category,
    label,
    source: input.source,
    expression: toNotation(terms),
    mode: input.mode,
    manual: input.manual !== undefined,
    dice,
    constant,
    total,
    natural: naturalOf(terms, dice),
    replacesRollId: null,
  };
  env.tx.insert(roll).values(row).run();
  return row;
}

/** The `roll` kind's payload item for a stored roll (callers build multi-roll entries with it). */
export function rollPayloadItem(r: Roll): RollPayloadItem {
  return {
    rollId: r.id,
    expression: r.expression,
    mode: r.mode,
    manual: r.manual,
    dice: r.dice,
    constant: r.constant,
    total: r.total,
    natural: r.natural,
    label: r.label,
  };
}
