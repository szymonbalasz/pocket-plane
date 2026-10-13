// Dice rolling behind the ctx.dice seam (FR-DICE-03, #137, #151). Grammar and limits are
// dice-roll-log's (FR-DICE-01). Each die is random-js's `integer(1, faces)` over the caller's
// engine, in notation order; keep-highest / keep-lowest drop dice as rpg-dice-roller did
// (stable ascending sort), so seeded rolls match the old library. There is no default
// engine: every roll needs one, so nothing can fall back to Math.random.
import { parseExpression } from "@shared/dice-roll-log/grammar";
import { integer } from "random-js";
import type { DiceEngine } from "./context";

/** One die's result (#140: per-die results are stored, for gems later). */
export interface DieResult {
  value: number;
  /** False when dropped (keep-highest / keep-lowest). */
  kept: boolean;
}

export interface RolledExpression {
  total: number;
  /** One list per dice term, in notation order; constants and operators excluded. */
  dice: DieResult[][];
}

/** Dropped dice: ascending by value, ties by position; `kh` drops the low end, `kl` the high. */
function keptFlags(values: readonly number[], keep: { which: "h" | "l"; n: number } | null) {
  if (!keep) return values.map(() => true);
  const asc = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const dropped = keep.which === "h" ? asc.slice(0, values.length - keep.n) : asc.slice(keep.n);
  const drop = new Set(dropped.map((x) => x.i));
  return values.map((_, i) => !drop.has(i));
}

/** Evaluates `notation` with `engine`. Throws for notation outside the grammar. */
export function rollDice(engine: DiceEngine, notation: string): RolledExpression {
  if (typeof engine?.next !== "function") {
    throw new Error("Dice rolled outside ctx.dice (FR-DICE-03): use rollDice(ctx.dice, …)");
  }
  const parsed = parseExpression(notation);
  if (!parsed.ok) throw new Error(`Invalid dice expression: ${parsed.message}`);
  let total = 0;
  const dice: DieResult[][] = [];
  for (const t of parsed.value) {
    if (t.kind === "const") {
      total += t.sign * t.value;
      continue;
    }
    const die = integer(1, t.faces);
    const values = Array.from({ length: t.count }, () => die(engine));
    const kept = keptFlags(values, t.keep);
    const group = values.map((value, i) => ({ value, kept: kept[i] ?? true }));
    for (const d of group) if (d.kept) total += t.sign * d.value;
    dice.push(group);
  }
  return { total, dice };
}
