import { describe, expect, test } from "bun:test";
import {
  applyMode,
  constantOf,
  diceRange,
  keptFlags,
  parseExpression,
  prepareExpression,
  SYNTAX_MESSAGE,
  toNotation,
} from "./grammar";
import { DiceExpression, RollLabel } from "./schemas";

const msg = (s: string) => {
  const r = parseExpression(s);
  return r.ok ? null : r.message;
};
const norm = (s: string) => {
  const r = parseExpression(s);
  if (!r.ok) throw new Error(r.message);
  return toNotation(r.value);
};

describe("FR-DICE-01 grammar and limits", () => {
  test("FR-DICE-01 accepts NdM, NdMkhK, NdMklK, constants; case-insensitive; spaces ignored", () => {
    expect(norm("1d20+4")).toBe("1d20+4");
    expect(norm(" 2D20KH1 + 3d6 - 2 ")).toBe("2d20kh1+3d6-2");
    expect(norm("4d6kl3")).toBe("4d6kl3");
    expect(norm("7")).toBe("7");
    expect(norm("1d1000-0")).toBe("1d1000-0");
  });

  test("FR-DICE-01 limits name the broken limit", () => {
    expect(msg("1000d1000")).toBe("At most 50 dice");
    expect(msg("30d6+21d6")).toBe("At most 50 dice");
    expect(msg("50d6")).toBeNull();
    expect(msg("1d1")).toBe("Dice faces must be 2–1000");
    expect(msg("1d1001")).toBe("Dice faces must be 2–1000");
    expect(msg("0d6")).toBe("Dice count must be at least 1");
    expect(msg("2d20kh3")).toBe("Keep must be 1–2");
    expect(msg("2d20kl0")).toBe("Keep must be 1–2");
    expect(msg("1d20+1000")).toBe("Constants must be 0–999");
    expect(msg("1+1+1+1+1+1+1+1+1+1+1")).toBe("At most 10 terms");
    expect(msg("1+1+1+1+1+1+1+1+1+1")).toBeNull();
    expect(msg(`1d20+${"1".repeat(3)}${" ".repeat(60)}`)).toBe("At most 60 characters");
    expect(msg("")).toBe("Enter a dice expression");
  });

  test("FR-DICE-01 rejects everything else before the library (operators, functions, signs)", () => {
    for (const bad of [
      "1d20*5",
      "1d20*2",
      "floor(1d20)",
      "1d20/2",
      "-1d4",
      "1d20++4",
      "d20",
      "1d%",
      "2d20kh",
      "1d20!",
      "{1d20}",
      "1d20+",
    ]) {
      expect({ bad, m: msg(bad) }).toEqual({ bad, m: SYNTAX_MESSAGE });
    }
  });

  test("FR-DICE-01 zod issue carries the limit message", () => {
    const r = DiceExpression.safeParse("1000d1000");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("At most 50 dice");
  });

  test("FR-DICE-11 label: trimmed, ≤ 60 chars, no control chars", () => {
    expect(RollLabel.parse("  Scimitar  ")).toBe("Scimitar");
    expect(RollLabel.safeParse("x".repeat(61)).success).toBe(false);
    expect(RollLabel.safeParse(`  ${"x".repeat(60)}  `).success).toBe(true);
    expect(RollLabel.safeParse("a\u0007b").success).toBe(false);
    expect(RollLabel.safeParse("<b>bold</b>").success).toBe(true);
  });
});

describe("FR-DICE-04 roll mode", () => {
  test("FR-DICE-04 adv/dis rewrite the first 1d20 term only", () => {
    const p = parseExpression("1d4+1d20+1d20+3");
    if (!p.ok) throw new Error(p.message);
    const adv = applyMode(p.value, "advantage");
    const dis = applyMode(p.value, "disadvantage");
    expect(adv.ok && toNotation(adv.value)).toBe("1d4+2d20kh1+1d20+3");
    expect(dis.ok && toNotation(dis.value)).toBe("1d4+2d20kl1+1d20+3");
    const normal = applyMode(p.value, "normal");
    expect(normal.ok && toNotation(normal.value)).toBe("1d4+1d20+1d20+3");
  });

  test("FR-DICE-04 no 1d20 term → error", () => {
    expect(prepareExpression("2d6", "advantage")).toEqual({
      ok: false,
      message: "Advantage needs a d20 roll",
    });
    expect(prepareExpression("2d20+1", "disadvantage")).toEqual({
      ok: false,
      message: "Disadvantage needs a d20 roll",
    });
    expect(prepareExpression("2d6", "normal").ok).toBe(true);
  });

  test("FR-DICE-04 rewrite respects the 50-dice limit", () => {
    expect(prepareExpression("1d20+49d6", "advantage")).toEqual({
      ok: false,
      message: "At most 50 dice",
    });
  });
});

describe("FR-DICE-06 manual helpers", () => {
  test("FR-DICE-06 dice part range is signed and counts kept dice only", () => {
    const t = (s: string) => {
      const r = prepareExpression(s, "normal");
      if (!r.ok) throw new Error(r.message);
      return r.value;
    };
    expect(diceRange(t("1d20+4"))).toEqual({ min: 1, max: 20 });
    expect(diceRange(t("2d20kh1"))).toEqual({ min: 1, max: 20 });
    expect(diceRange(t("2d6-1d4+3"))).toEqual({ min: -2, max: 11 });
    expect(constantOf(t("1d6+3-1"))).toBe(2);
  });

  test("FR-DICE-06 kept dice computed server-side: highest / lowest K, ties by position", () => {
    const term = (which: "h" | "l", n: number) =>
      ({ kind: "dice", sign: 1, count: 3, faces: 6, keep: { which, n } }) as const;
    expect(keptFlags(term("h", 1), [3, 5, 5])).toEqual([false, true, false]);
    expect(keptFlags(term("l", 2), [3, 5, 1])).toEqual([true, false, true]);
    expect(keptFlags({ ...term("h", 1), keep: null }, [1, 2, 3])).toEqual([true, true, true]);
  });
});
