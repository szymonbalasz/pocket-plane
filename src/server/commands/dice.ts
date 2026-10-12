// The dice library behind the ctx.dice seam (FR-DICE-03, #137). The library's number
// generator is process-global: it is pointed at the caller's engine for one synchronous
// evaluation, then restored. Between evaluations it holds a guard that throws, so no roll
// can fall back to the library's default engine (Math.random). Grammar and limits are
// dice-roll-log's (FR-DICE-01): validate before calling `rollDice`.
import { DiceRoll, NumberGenerator, Results } from "@dice-roller/rpg-dice-roller";
import type { DiceEngine } from "./context";

const guardEngine: DiceEngine = {
  next() {
    throw new Error("Dice rolled outside ctx.dice (FR-DICE-03): use rollDice(ctx.dice, …)");
  },
};

NumberGenerator.generator.engine = guardEngine;

/** Runs `fn` with the library's generator set to `engine`, then restores it. Synchronous only. */
export function withDiceEngine<T>(engine: DiceEngine, fn: () => T): T {
  const gen = NumberGenerator.generator;
  const previous = gen.engine as DiceEngine;
  gen.engine = engine;
  try {
    const out = fn();
    if (out instanceof Promise) throw new Error("withDiceEngine: fn must be synchronous");
    return out;
  } finally {
    gen.engine = previous;
  }
}

/** One die's result (#140: per-die results are stored, for gems later). */
export interface DieResult {
  value: number;
  /** False when dropped (keep-highest / keep-lowest). */
  kept: boolean;
}

export interface RolledExpression {
  /** The library's roll, for anything beyond totals and dice. */
  roll: DiceRoll;
  total: number;
  /** One list per dice term, in notation order; constants and operators excluded. */
  dice: DieResult[][];
}

/** Evaluates `notation` with `engine`. Throws the library's error for notation it can't parse. */
export function rollDice(engine: DiceEngine, notation: string): RolledExpression {
  const roll = withDiceEngine(engine, () => new DiceRoll(notation));
  const dice: DieResult[][] = [];
  for (const part of roll.rolls) {
    if (part instanceof Results.RollResults) {
      dice.push(part.rolls.map((r) => ({ value: r.value, kept: r.useInTotal })));
    }
  }
  return { roll, total: roll.total, dice };
}
