// Tier 2 pure rules (FR-MOD-17, -18, -24, -25): mode hints and the final mode, bonus-die groups,
// effective AC, defense presets.
import { describe, expect, test } from "bun:test";
import {
  bonusDieGroups,
  combineModes,
  DEFENSE_MULTIPLIER,
  defenseFor,
  effectiveAc,
  type ModEffect,
  modeHints,
} from "./rules";
import type { Modifier } from "./schemas";

const fx = (o: Partial<ModEffect> & { id: string }): ModEffect => ({
  targetCharacterId: "brakka",
  targetCombatantId: null,
  modifiers: [],
  endedAt: null,
  label: o.id,
  ...o,
});
const brakka = { characterId: "brakka" };
const advStr: Modifier = {
  kind: "mode",
  on: { roll: "check", abilities: ["str"] },
  mode: "advantage",
};
const disAll: Modifier = { kind: "mode", on: { roll: "check" }, mode: "disadvantage" };
const resPhys: Modifier = {
  kind: "defense",
  types: ["bludgeoning", "piercing", "slashing"],
  level: "resistance",
};
const ac2: Modifier = { kind: "flat", on: { roll: "ac" }, value: 2 };

describe("FR-MOD-17 mode", () => {
  test("FR-MOD-17 combine: any adv + any dis → normal; else the one present", () => {
    const adv = { mode: "advantage" as const };
    const dis = { mode: "disadvantage" as const };
    expect(combineModes("normal", [])).toBe("normal");
    expect(combineModes("advantage", [])).toBe("advantage");
    expect(combineModes("normal", [adv])).toBe("advantage");
    expect(combineModes("normal", [adv, adv])).toBe("advantage");
    expect(combineModes("normal", [dis])).toBe("disadvantage");
    expect(combineModes("normal", [adv, dis])).toBe("normal");
    expect(combineModes("disadvantage", [adv])).toBe("normal");
    expect(combineModes("advantage", [adv, adv])).toBe("advantage");
    expect(combineModes("disadvantage", [dis])).toBe("disadvantage");
  });

  test("FR-MOD-17 hints: the creature's active mode modifiers matching the roll, seq order", () => {
    const effects = [
      fx({ id: "Rage", seq: 2, modifiers: [advStr, resPhys] }),
      fx({ id: "Hex", seq: 1, modifiers: [disAll] }),
      fx({ id: "ended", seq: 0, modifiers: [advStr], endedAt: "t" }),
      fx({ id: "other", seq: 3, targetCharacterId: "thorn", modifiers: [advStr] }),
    ];
    const athletics = modeHints(effects, brakka, { roll: "check", ability: "str" });
    expect(athletics.map((h) => [h.effect.id, h.mode])).toEqual([
      ["Hex", "disadvantage"],
      ["Rage", "advantage"],
    ]);
    expect(
      modeHints(effects, brakka, { roll: "check", ability: "dex" }).map((h) => h.mode),
    ).toEqual(["disadvantage"]);
    expect(modeHints(effects, brakka, { roll: "save", ability: "str" })).toEqual([]);
  });
});

describe("FR-MOD-18 bonus-die groups", () => {
  test("FR-MOD-18 one group per effect e:<id>; several dice parts on one roll keyed by index; crit doubles", () => {
    const bless: Modifier = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 };
    const both: Modifier = { kind: "dice", on: { roll: "damage" }, dice: "1d6", sign: 1 };
    const minus: Modifier = { kind: "dice", on: { roll: "damage" }, dice: "1d4", sign: -1 };
    const effects = [
      fx({ id: "b", seq: 1, modifiers: [bless, advStr] }),
      fx({ id: "x", seq: 2, modifiers: [both, ac2, minus] }),
    ];
    expect(bonusDieGroups(effects, brakka, { roll: "attack" }).map((g) => g.key)).toEqual(["e:b"]);
    const dmg = bonusDieGroups(effects, brakka, { roll: "damage", crit: true });
    expect(dmg.map((g) => [g.key, g.dice, g.sign])).toEqual([
      ["e:x.0", "2d6", 1],
      ["e:x.2", "2d4", -1],
    ]);
  });
});

describe("FR-MOD-24 effective AC", () => {
  test("FR-MOD-24 stored AC + Σ flat on ac of active effects, parts named", () => {
    const effects = [
      fx({ id: "sof", label: "Shield of Faith", modifiers: [ac2] }),
      fx({ id: "old", label: "Old", modifiers: [ac2], endedAt: "t" }),
      fx({ id: "rage", label: "Rage", modifiers: [resPhys] }),
    ];
    expect(effectiveAc(15, effects, brakka)).toEqual({
      ac: 17,
      parts: [{ effectId: "sof", label: "Shield of Faith", value: 2 }],
    });
    expect(effectiveAc(15, effects, { combatantId: "g" })).toEqual({ ac: 15, parts: [] });
  });
});

describe("FR-MOD-25 defense presets", () => {
  const imm: Modifier = { kind: "defense", types: ["slashing"], level: "immunity" };
  const vul: Modifier = { kind: "defense", types: ["slashing", "fire"], level: "vulnerability" };
  test("FR-MOD-25 immunity → None, resistance → Half, vulnerability → Double, both → Normal", () => {
    const rage = fx({ id: "rage", label: "Rage", modifiers: [resPhys] });
    const curse = fx({ id: "curse", label: "Curse", modifiers: [vul] });
    const stone = fx({ id: "stone", label: "Stoneskin", modifiers: [imm] });
    expect(defenseFor([rage], brakka, "slashing")).toEqual({ level: "resistance", label: "Rage" });
    expect(defenseFor([rage], brakka, "radiant")).toBeNull();
    expect(defenseFor([rage], brakka, null)).toBeNull();
    expect(defenseFor([curse], brakka, "fire")).toEqual({ level: "vulnerability", label: "Curse" });
    expect(defenseFor([rage, curse], brakka, "slashing")).toEqual({
      level: "both",
      label: "Rage, Curse",
    });
    expect(defenseFor([rage, curse, stone], brakka, "slashing")).toEqual({
      level: "immunity",
      label: "Stoneskin",
    });
    expect(defenseFor([{ ...rage, endedAt: "t" }], brakka, "slashing")).toBeNull();
    expect(DEFENSE_MULTIPLIER).toEqual({
      immunity: "none",
      resistance: "half",
      vulnerability: "double",
      both: "normal",
    });
  });
});
