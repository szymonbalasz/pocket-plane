// Rule-trigger formula grammar (FR-MOD-34, MOD §8.5) and owner context (FR-MOD-35).
import { describe, expect, test } from "bun:test";
import { parseExpression } from "@shared/dice-roll-log/grammar";
import {
  evaluateFormula,
  FORMULA_MAX_CHARS,
  type FormulaOwner,
  formulaValue,
  parseFormula,
} from "./formula";

const brakka: FormulaOwner = {
  level: 5,
  classes: [{ name: "Barbarian", level: 5 }],
  prof: 3,
  abilities: { str: 4, dex: 1, con: 3, int: -1, wis: 0, cha: 0 },
};
const thorn: FormulaOwner = {
  level: 5,
  classes: [{ name: "Rogue", level: 5 }],
  prof: 3,
  abilities: { dex: 4, cha: 1 },
};
/** A CR 1/2 monster definition: `cr` rounds down, `level` 0. */
const hobgoblin: FormulaOwner = { cr: 0.5, prof: 2, abilities: { str: 1, dex: 1 } };
const ranger = (level: number): FormulaOwner => ({
  level,
  classes: [{ name: "Ranger", level }],
});

/** The evaluated expression (null = nothing); fails the test on an error. */
function expr(src: string, owner: FormulaOwner, crit = false): string | null {
  const r = formulaValue(src, owner, { crit });
  if (!r.ok) throw new Error(`${src}: ${r.error.message}`);
  if (r.value.expression !== null) expect(parseExpression(r.value.expression).ok).toBe(true);
  return r.value.expression;
}
const parseError = (src: string) => {
  const r = parseFormula(src);
  if (r.ok) throw new Error(`${src} parsed`);
  return r.error;
};
const evalError = (src: string, owner: FormulaOwner) => {
  const r = formulaValue(src, owner);
  if (r.ok) throw new Error(`${src} evaluated to ${r.value.expression}`);
  return r.error;
};

describe("FR-MOD-34 formula grammar accepts", () => {
  test("FR-MOD-34 formula grammar: §8.5 examples", () => {
    expect(expr("1d6 + floor(level(barbarian) / 2)", brakka)).toBe("1d6+2");
    expect(expr("(ceil(level(rogue) / 2))d6", thorn)).toBe("3d6");
    expect(expr("max(1, cha)", thorn)).toBe("1");
    expect(expr("max(1, cha)", { abilities: { cha: 4 } })).toBe("4");
    expect(expr("max(1, cha)", { abilities: { cha: -1 } })).toBe("1");
    expect(expr("1d(4 + 2 * steps(level(ranger), 6, 14))", ranger(5))).toBe("1d4");
    expect(expr("1d(4 + 2 * steps(level(ranger), 6, 14))", ranger(6))).toBe("1d6");
    expect(expr("1d(4 + 2 * steps(level(ranger), 6, 14))", ranger(14))).toBe("1d8");
  });

  test("FR-MOD-34 formula grammar: steps counts thresholds ≤ x", () => {
    const rage = "2 + steps(level(barbarian), 9, 16)";
    const barb = (level: number) => ({ classes: [{ name: "Barbarian", level }] });
    expect(expr(rage, barb(8))).toBe("2");
    expect(expr(rage, barb(9))).toBe("3");
    expect(expr(rage, barb(16))).toBe("4");
    expect(expr("steps(level, 5, 11, 17, 20)", { level: 20 })).toBe("4");
  });

  test("FR-MOD-34 formula grammar: unary minus, min, products, dice signs", () => {
    expect(expr("1d6 - -2", brakka)).toBe("1d6+2");
    expect(expr("-prof + 10", brakka)).toBe("7");
    expect(expr("min(str, 2) * 3", brakka)).toBe("6");
    expect(expr("1d6 - 1d4", brakka)).toBe("1d6-1d4");
    expect(expr("3 - 1d4", brakka)).toBe("3-1d4");
    expect(expr("2d6 + 1d8 + 3", brakka)).toBe("2d6+1d8+3");
  });

  test("FR-MOD-34 formula grammar: whitespace and case are free", () => {
    expect(expr("  1D6+FLOOR( LEVEL(  BarBarian ) /2 ) ", brakka)).toBe("1d6+2");
    expect(expr("(CEIL(Level(Rogue)/2))D6", thorn)).toBe("3d6");
    expect(expr("1d(  4  )", brakka)).toBe("1d4");
  });

  test("FR-MOD-34 formula grammar: `/` is exact, the rest rounds down", () => {
    expect(expr("level / 3 * 3", brakka)).toBe("5");
    expect(expr("level / 2 + level / 2", brakka)).toBe("5");
    expect(expr("level / 2", brakka)).toBe("2");
    expect(expr("-level / 2", brakka)).toBe("0-3");
    expect(expr("ceil(level / 2)", brakka)).toBe("3");
    expect(expr("floor(-level / 2)", brakka)).toBe("0-3");
  });

  test("FR-MOD-34 formula grammar: names with hyphens and spaces in level(<class>)", () => {
    const o: FormulaOwner = { classes: [{ name: "Blood  Hunter", level: 3 }] };
    expect(expr("level(blood hunter)", o)).toBe("3");
    expect(expr("level(blood-hunter)", { classes: [{ name: "Blood-Hunter", level: 2 }] })).toBe(
      "2",
    );
  });
});

describe("FR-MOD-35 owner context", () => {
  test("FR-MOD-35 level, level(<class>) case-insensitive and summed, none → 0", () => {
    const multi: FormulaOwner = {
      level: 7,
      classes: [
        { name: "Fighter", level: 2 },
        { name: "rogue", level: 5 },
      ],
    };
    expect(expr("level", multi)).toBe("7");
    expect(expr("level(ROGUE)", multi)).toBe("5");
    expect(expr("level(wizard)", multi)).toBeNull();
  });

  test("FR-MOD-35 a CR 1/2 monster: cr rounds down, prof, abilities, level 0", () => {
    expect(expr("cr + prof", hobgoblin)).toBe("2");
    expect(expr("2d6 + str", hobgoblin)).toBe("2d6+1");
    expect(expr("level + cr", hobgoblin)).toBeNull();
    expect(expr("cr", { cr: 5 })).toBe("5");
  });

  test("FR-MOD-35 missing scores count as 0", () => {
    expect(expr("1d8 + wis + prof + level", {})).toBe("1d8");
  });
});

describe("FR-MOD-34 formula grammar rejects", () => {
  test("FR-MOD-34 formula grammar: unknown name, with its position", () => {
    expect(parseError("1d6 + foo")).toEqual({ message: "Unknown name ‘foo’ at 7", pos: 7 });
    expect(parseError("bar").message).toBe("Unknown name ‘bar’ at 1");
  });

  test("FR-MOD-34 formula grammar: no property access, no prototype names", () => {
    expect(parseError("__proto__").message).toBe("Unknown name ‘__proto__’ at 1");
    expect(parseError("constructor").message).toBe("Unknown name ‘constructor’ at 1");
    expect(parseError("level.barbarian").message).toBe("Unexpected ‘.’ at 6");
    expect(parseError("str.constructor").message).toBe("Unexpected ‘.’ at 4");
    expect(parseError('level["x"]').message).toBe("Unexpected ‘[’ at 6");
    for (const name of ["toString", "hasOwnProperty", "prototype", "eval", "valueOf"]) {
      expect(parseError(`1 + ${name}`).message).toContain(`Unknown name ‘${name.toLowerCase()}’`);
    }
    expect(parseError("Math.random()").message).toBe("Unexpected ‘.’ at 5");
  });

  test("FR-MOD-34 formula grammar: bad die sizes, literal or constant", () => {
    expect(parseError("1d7")).toEqual({ message: "Die size 7 at 3", pos: 3 });
    expect(parseError("1d20").message).toBe("Die size 20 at 3");
    expect(parseError("1d(3 + 4)").message).toBe("Die size 7 at 3");
    expect(parseError("1d").message).toContain("Die size");
  });

  test("FR-MOD-34 formula grammar: dice only as top-level addends", () => {
    expect(parseError("1d(1d4)").message).toBe("No dice inside dice at 5");
    expect(parseError("(1d4)d6").message).toBe("No dice inside dice at 3");
    expect(parseError("2 * 1d6").message).toBe("Dice only as a top-level addend at 6");
    expect(parseError("1d6 * 2").message).toBe("Dice only as a top-level addend at 5");
    expect(parseError("1d6 / 2").message).toBe("Dice only as a top-level addend at 5");
    expect(parseError("floor(1d6)").message).toBe("Dice only as a top-level addend at 8");
    expect(parseError("max(1, 1d6)").message).toContain("Dice only as a top-level addend");
    expect(parseError("(1d6)").message).toContain("Dice only as a top-level addend");
    expect(parseError("1d6d6").message).toBe("Dice only as a top-level addend at 4");
    expect(parseError("d6").message).toBe("Dice need a count, like 1d6 at 1");
  });

  test("FR-MOD-34 formula grammar: divide by 0 or by anything but a whole number", () => {
    expect(parseError("level / 0").message).toBe("Divide by 0 at 9");
    expect(parseError("level / cha").message).toBe("Divide by a whole number at 9");
    expect(parseError("level / (2)").message).toBe("Divide by a whole number at 9");
    expect(parseError("level / -2").message).toBe("Divide by a whole number at 9");
  });

  test("FR-MOD-34 formula grammar: length, token and dice-term caps", () => {
    const long = `1+${"1".repeat(FORMULA_MAX_CHARS - 2)}`;
    expect(parseFormula(long).ok).toBe(true);
    expect(parseError(`${long}1`).message).toBe("Too long: 61 > 60 characters");
    const forty = Array.from({ length: 20 }, () => "1").join("+");
    expect(parseFormula(`${forty}`).ok).toBe(true); // 39 tokens
    expect(parseError(`${forty}+1`).message).toBe("Too many parts: 41 > 40");
    expect(parseFormula("1d4+1d4+1d4").ok).toBe(true);
    expect(parseError("1d4+1d4+1d4+1d4").message).toBe("Too many dice terms: 4 > 3");
  });

  test("FR-MOD-34 formula grammar: calls and syntax", () => {
    expect(parseError("").message).toBe("Enter a formula");
    expect(parseError("   ").message).toBe("Enter a formula");
    expect(parseError("min(1)").message).toBe("Expected ‘,’ at 6");
    expect(parseError("floor 2").message).toBe("Expected ‘(’ after floor at 7");
    expect(parseError("steps(level)").message).toBe("steps takes 1–4 thresholds at 1");
    expect(parseError("steps(level, 1, 2, 3, 4, 5)").message).toBe(
      "steps takes 1–4 thresholds at 1",
    );
    expect(parseError("steps(level, cha)").message).toBe(
      "steps thresholds are whole numbers at 14",
    );
    expect(parseError("level(2)").message).toContain("Class name");
    expect(parseError("level()").message).toContain("Class name");
    expect(parseError(`level(${"a".repeat(31)})`).message).toContain("Class name");
    expect(parseError("level(rogue").message).toBe("Expected ‘)’ at 6");
    expect(parseError("(1 + 2").message).toBe("Expected ‘)’ at the end");
    expect(parseError("1 + 2)").message).toBe("Expected + or - at 6");
    expect(parseError("1 2").message).toBe("Expected + or - at 3");
    expect(parseError("1 +").message).toBe("Unexpected end");
    expect(parseError("prof(2)").message).toBe("Expected + or - at 5");
  });

  test("FR-MOD-34 formula grammar: 26 dice > 25 against the owner", () => {
    expect(parseFormula("20d6+6d8").ok).toBe(true);
    expect(evalError("20d6+6d8", brakka)).toEqual({ message: "Too many dice: 26 > 25", pos: null });
    const twoTerms = "(level)d6 + (level)d8";
    expect(expr(twoTerms, { level: 12 })).toBe("12d6+12d8");
    expect(evalError(twoTerms, { level: 15 }).message).toBe("Too many dice: 30 > 25");
  });

  test("FR-MOD-34 formula grammar: die-size formula checked for the owner", () => {
    expect(expr("1d(level)", { level: 6 })).toBe("1d6");
    expect(evalError("1d(level)", { level: 7 })).toEqual({ message: "Die size 7 at 3", pos: 3 });
    expect(evalError("1d(level)", {}).message).toBe("Die size 0 at 3");
  });
});

describe("FR-MOD-34 clamps and crit", () => {
  test("FR-MOD-34 count > 20 clamps to 20; 0 or less drops the term", () => {
    expect(expr("(level * 10)d6", brakka)).toBe("20d6");
    expect(expr("(level - 10)d6 + 2", brakka)).toBe("2");
    expect(expr("(level - 10)d6", brakka)).toBeNull();
    expect(expr("0", brakka)).toBeNull();
    expect(expr("prof - prof", brakka)).toBeNull();
  });

  test("FR-MOD-34 the constant clamps to −99…99", () => {
    expect(expr("level * 100", brakka)).toBe("99");
    expect(expr("1d4 - level * 100", brakka)).toBe("1d4-99");
  });

  test("FR-MOD-34 crit doubles each count after the cap: 25 → 50", () => {
    const r = formulaValue("20d6 + 5d8 + 3", brakka, { crit: true });
    expect(r.ok && r.value).toEqual({
      dice: [
        { sign: 1, count: 40, size: 6 },
        { sign: 1, count: 10, size: 8 },
      ],
      constant: 3,
      diceCount: 50,
      expression: "40d6+10d8+3",
    });
    expect(expr("1d6 + floor(level(barbarian) / 2)", brakka, true)).toBe("2d6+2");
  });

  test("FR-MOD-34 a parsed formula evaluates for many owners", () => {
    const p = parseFormula("(ceil(level(rogue) / 2))d6");
    if (!p.ok) throw new Error(p.error.message);
    const rogue = (level: number) => ({ classes: [{ name: "Rogue", level }] });
    const at = (level: number) => {
      const v = evaluateFormula(p.value, rogue(level));
      return v.ok ? v.value.expression : v.error.message;
    };
    expect([1, 2, 3, 19, 20].map(at)).toEqual(["1d6", "1d6", "2d6", "10d6", "10d6"]);
  });
});
