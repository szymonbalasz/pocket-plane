import { describe, expect, test } from "bun:test";
import {
  type DiceEngine,
  realContext,
  realDice,
  SeedNotAllowedError,
  seededContext,
  seededDice,
} from "./context";
import { rollDice } from "./dice";

const draws = (e: DiceEngine, n: number) => Array.from({ length: n }, () => e.next());
const isInt32 = (v: number) => Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31;

describe("FR-DICE-03 ctx.dice seam", () => {
  test("FR-DICE-03 real engine: CSPRNG int32, on every real context", () => {
    const a = draws(realDice(), 200);
    expect(a.every(isInt32)).toBe(true);
    expect(new Set(a).size).toBeGreaterThan(190);
    expect(draws(realContext().dice, 5).every(isInt32)).toBe(true);
  });

  test("FR-DICE-03 seeded dice refuse non-disposable data (ADR-0022 guard)", () => {
    expect(() => seededDice({ disposable: false, key: "x" })).toThrow(SeedNotAllowedError);
    expect(() => seededContext({ disposable: false, key: "x" })).toThrow(SeedNotAllowedError);
  });

  test("FR-DICE-03 seeded dice: same (seed, key) → same draws; other key or seed → different", () => {
    const a = draws(seededDice({ disposable: true, key: "rolls-1" }), 50);
    expect(a.every(isInt32)).toBe(true);
    expect(draws(seededDice({ disposable: true, key: "rolls-1" }), 50)).toEqual(a);
    expect(draws(seededDice({ disposable: true, key: "rolls-2" }), 50)).not.toEqual(a);
    expect(draws(seededDice({ disposable: true, key: "rolls-1", seed: "t" }), 50)).not.toEqual(a);
    // The seeded context's engine is the same stream as seededDice for its key.
    expect(draws(seededContext({ disposable: true, key: "rolls-1" }).dice, 50)).toEqual(a);
  });

  test("FR-DICE-03 dice draws never shift the ID or token streams (own stream per key)", () => {
    const a = seededContext({ disposable: true, key: "k" });
    const b = seededContext({ disposable: true, key: "k" });
    draws(b.dice, 17);
    expect(b.ids.next()).toBe(a.ids.next());
    expect(b.tokens.next()).toBe(a.tokens.next());
  });

  test("FR-DICE-25 same seed + same rolls → identical results", () => {
    const run = () => {
      const e = seededContext({ disposable: true, key: "combat" }).dice;
      return ["1d20+5", "2d20kh1+3", "8d6", "2d20kl1", "1d1000-2"].map((x) => rollDice(e, x));
    };
    const a = run();
    const b = run();
    expect(a.map((r) => [r.total, r.dice])).toEqual(b.map((r) => [r.total, r.dice]));
  });
});

describe("FR-DICE-03 dice roller behind the seam", () => {
  test("FR-DICE-08 per-die results with kept flags (#140), totals from kept dice + constants", () => {
    const e = seededDice({ disposable: true, key: "per-die" });
    const r = rollDice(e, "2d20kh1 + 3d6 - 2");
    expect(r.dice).toHaveLength(2);
    const [d20, d6] = r.dice as [{ value: number; kept: boolean }[], { value: number }[]];
    expect(d20).toHaveLength(2);
    expect(d20.filter((d) => d.kept)).toHaveLength(1);
    const kept = d20.find((d) => d.kept)?.value ?? 0;
    expect(kept).toBe(Math.max(...d20.map((d) => d.value)));
    expect(d6).toHaveLength(3);
    for (const d of d20) expect(d.value).toBeWithin(1, 21);
    for (const d of d6) expect(d.value).toBeWithin(1, 7);
    expect(r.total).toBe(kept + d6.reduce((s, d) => s + d.value, 0) - 2);
  });

  test("FR-DICE-03 rolls draw only from the given engine", () => {
    let calls = 0;
    const counting: DiceEngine = {
      next() {
        calls++;
        return 0x7fffffff;
      },
    };
    const r = rollDice(counting, "4d6");
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(r.dice[0]).toHaveLength(4);
  });

  test("FR-DICE-03 no default engine: a roll without an engine throws, never Math.random", () => {
    expect(() => rollDice(undefined as unknown as DiceEngine, "1d20")).toThrow(/outside ctx\.dice/);
    expect(() => rollDice({} as DiceEngine, "1d20")).toThrow(/outside ctx\.dice/);
    expect(() => rollDice(realDice(), "not dice")).toThrow(/Invalid dice expression/);
  });

  test("FR-DICE-03 one engine draw per die, in notation order", () => {
    const seen: number[] = [];
    let n = 0;
    const counting: DiceEngine = {
      next() {
        seen.push(n);
        return n++;
      },
    };
    const r = rollDice(counting, "2d4kl1+3-1d8");
    expect(seen).toEqual([0, 1, 2]);
    expect(r.dice.map((g) => g.map((d) => d.value))).toEqual([[1, 2], [3]]);
    expect(r.dice[0]?.map((d) => d.kept)).toEqual([true, false]);
    expect(r.total).toBe(1 + 3 - 3);
  });
});
