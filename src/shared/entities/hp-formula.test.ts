// FR-ENT-25: HP formula in the stat block zod, `hpAverage`, `hpRollSpec`.
import { describe, expect, test } from "bun:test";
import { parseExpression } from "@shared/dice-roll-log/grammar";
import { clampRolledHp, hpAverage, hpRollSpec, parseHpFormula } from "./hp-formula";
import { CharacterStatBlock, MonsterStatBlock } from "./schemas";

const monster = { size: "small", ac: 15, hpMax: 7, initBonus: 2, attacks: [], cr: "1/4" };

describe("FR-ENT-25 HP formula", () => {
  test("NdM ± K: N 1–50, M ∈ 4/6/8/10/12/20, K 0–999", () => {
    expect(parseHpFormula("2d6")).toEqual({ count: 2, faces: 6, modifier: 0 });
    expect(parseHpFormula("2d8+2")).toEqual({ count: 2, faces: 8, modifier: 2 });
    expect(parseHpFormula("4d10-4")).toEqual({ count: 4, faces: 10, modifier: -4 });
    expect(parseHpFormula(" 3D12 − 1 ")).toEqual({ count: 3, faces: 12, modifier: -1 });
    expect(parseHpFormula("50d20+999")).toEqual({ count: 50, faces: 20, modifier: 999 });
    for (const bad of [
      "",
      "d8",
      "0d8",
      "51d8",
      "2d7",
      "2d100",
      "2d8+1000",
      "2d8+2+1",
      "2d8*2",
      "8",
    ]) {
      expect(parseHpFormula(bad)).toBeNull();
    }
  });

  test("hpAverage = max(1, floor(N × (M + 1) / 2) + K), capped at 999", () => {
    expect(hpAverage("2d6")).toBe(7); // goblin
    expect(hpAverage("2d8+2")).toBe(11); // wolf
    expect(hpAverage("1d4-5")).toBe(1);
    expect(hpAverage("50d20+999")).toBe(999);
    expect(() => hpAverage("nope")).toThrow();
  });

  test("hpRollSpec: an expression the dice grammar accepts; clamp 1–999", () => {
    expect(hpRollSpec("2d8+2")).toBe("2d8+2");
    expect(hpRollSpec("2d6+0")).toBe("2d6");
    expect(hpRollSpec("4d10−4")).toBe("4d10-4");
    for (const f of ["2d6", "2d8+2", "4d10-4", "50d20+999"]) {
      expect(parseExpression(hpRollSpec(f)).ok).toBe(true);
    }
    expect([clampRolledHp(-3), clampRolledHp(0), clampRolledHp(17), clampRolledHp(1500)]).toEqual([
      1, 1, 17, 999,
    ]);
  });

  test("stat block: optional on both kinds, stored normalised, bad formula invalid; old blocks parse", () => {
    expect(MonsterStatBlock.parse(monster)).not.toHaveProperty("hpFormula");
    expect(MonsterStatBlock.parse({ ...monster, hpFormula: " 2D6 " }).hpFormula).toBe("2d6");
    expect(MonsterStatBlock.safeParse({ ...monster, hpFormula: "2d7" }).success).toBe(false);
    const pc = { ...monster, cr: undefined, level: 3, className: "Rogue", hpFormula: "3d8+3" };
    const { cr: _cr, ...character } = pc;
    expect(CharacterStatBlock.safeParse(character).success).toBe(true);
  });
});
