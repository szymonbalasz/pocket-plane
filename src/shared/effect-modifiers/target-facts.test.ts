// FR-MOD-24 / -25 popup target facts (pure): effective AC with its parts, defense presets.
import { describe, expect, test } from "bun:test";
import type { ModEffect } from "./rules";
import type { Modifier } from "./schemas";
import { acText, defensePreset, targetCreature, targetFacts } from "./target-facts";

const fx = (
  id: string,
  label: string,
  modifiers: Modifier[],
  on: Partial<ModEffect>,
): ModEffect => ({
  id,
  label,
  modifiers,
  targetCharacterId: null,
  targetCombatantId: null,
  endedAt: null,
  ...on,
});
const sof: Modifier = { kind: "flat", on: { roll: "ac" }, value: 2 };
const resPhys: Modifier = {
  kind: "defense",
  types: ["bludgeoning", "piercing", "slashing"],
  level: "resistance",
};
const goblin = { id: "c-gob", kind: "monster" as const, entityId: "def-gob" };
const brakka = { id: "c-brakka", kind: "pc" as const, entityId: "brakka" };

describe("FR-MOD-24 effective AC in the popup", () => {
  test("FR-MOD-24 Shield of Faith on the Goblin: AC 17 (15 + 2 Shield of Faith); unknown stored AC → none", () => {
    const effects = [fx("e1", "Shield of Faith", [sof], { targetCombatantId: "c-gob" })];
    const f = targetFacts(effects, goblin, 15, "slashing");
    expect(f.ac).toEqual({
      value: 17,
      stored: 15,
      parts: [{ effectId: "e1", label: "Shield of Faith", value: 2 }],
    });
    expect(acText(f.ac as NonNullable<typeof f.ac>)).toBe("AC 17 (15 + 2 Shield of Faith)");
    expect(targetFacts(effects, goblin, null, null).ac).toBeNull();
    expect(acText({ value: 15, stored: 15, parts: [] })).toBe("AC 15");
  });

  test("FR-MOD-24 a PC target's parts come from its character's effects", () => {
    expect(targetCreature(brakka)).toEqual({ characterId: "brakka" });
    const effects = [fx("e1", "SoF", [sof], { targetCharacterId: "brakka" })];
    expect(targetFacts(effects, brakka, 14, null).ac?.value).toBe(16);
    expect(targetFacts(effects, goblin, 14, null).ac?.value).toBe(14);
  });
});

describe("FR-MOD-25 defense presets in the popup", () => {
  test("FR-MOD-25 Rage + slashing → Half (Rage); fire → none; untyped → none", () => {
    const effects = [fx("r", "Rage", [resPhys], { targetCharacterId: "brakka" })];
    expect(defensePreset(effects, brakka, "slashing")).toEqual({
      level: "resistance",
      label: "Rage",
      multiplier: "half",
      hint: "Half (Rage)",
    });
    expect(defensePreset(effects, brakka, "fire")).toBeNull();
    expect(defensePreset(effects, brakka, null)).toBeNull();
  });

  test("FR-MOD-25 immunity → None; resistance + vulnerability → Normal", () => {
    const imm = fx("i", "Ward", [{ kind: "defense", types: ["cold"], level: "immunity" }], {
      targetCombatantId: "c-gob",
    });
    const vul = fx(
      "v",
      "Frail",
      [{ kind: "defense", types: ["slashing"], level: "vulnerability" }],
      {
        targetCombatantId: "c-gob",
      },
    );
    const res = fx("r", "Stone", [resPhys], { targetCombatantId: "c-gob" });
    expect(defensePreset([imm], goblin, "cold")?.multiplier).toBe("none");
    expect(defensePreset([vul, res], goblin, "slashing")).toMatchObject({
      level: "both",
      multiplier: "normal",
      hint: "Normal (Frail, Stone)",
    });
  });
});
