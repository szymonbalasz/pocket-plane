// FR-MOD-58, FR-CBT-82 (sprint 4): the popup's per-part presets and preview, pure.
import { describe, expect, test } from "bun:test";
import type { ModEffect } from "@shared/effect-modifiers/rules";
import { extraPartPresets, weaponRaw } from "./targets";

const goblin = { id: "g1", kind: "monster" as const, entityId: "d1" };
const ward = (
  id: string,
  label: string,
  level: "resistance" | "vulnerability" | "immunity",
  types: string[],
): ModEffect => ({
  id,
  label,
  targetCharacterId: null,
  targetCombatantId: "g1",
  modifiers: [{ kind: "defense", types, level } as never],
});

describe("FR-MOD-58 defense preset per part", () => {
  test("FR-MOD-58 defensePreset per type: resistance → Half, immunity → None, vulnerable → Double, both → Normal; none → Normal", () => {
    const effects = [
      ward("e1", "Fire Ward", "resistance", ["fire"]),
      ward("e2", "Ice Skin", "immunity", ["cold"]),
      ward("e3", "Brittle", "vulnerability", ["thunder", "acid"]),
      ward("e4", "Acid Coat", "resistance", ["acid"]),
    ];
    expect(
      extraPartPresets(effects, goblin, ["fire", "cold", "thunder", "acid", "radiant"]),
    ).toEqual([
      { multiplier: "half", hint: "Half (Fire Ward)" },
      { multiplier: "none", hint: "None (Ice Skin)" },
      { multiplier: "double", hint: "Double (Brittle)" },
      { multiplier: "normal", hint: "Normal (Brittle, Acid Coat)" },
      { multiplier: "normal", hint: null },
    ]);
  });

  test("FR-MOD-58 another creature's defenses don't count; untyped Rage-style parts stay with the base (no extra preset)", () => {
    const other = { id: "g2", kind: "monster" as const, entityId: "d1" };
    expect(
      extraPartPresets([ward("e1", "Fire Ward", "resistance", ["fire"])], other, ["fire"]),
    ).toEqual([{ multiplier: "normal", hint: null }]);
    expect(extraPartPresets([], goblin, [])).toEqual([]);
  });
});

describe("FR-CBT-82 popup preview", () => {
  test("FR-CBT-82 raw = floor(base × m) + Σ floor(part × m_i); a miss → 0", () => {
    expect(weaponRaw(true, 15, "normal", [{ total: 8, multiplier: "half" }])).toBe(19);
    expect(weaponRaw(true, 15, "half", [{ total: 9, multiplier: "double" }])).toBe(7 + 18);
    expect(weaponRaw(false, 15, "normal", [{ total: 8, multiplier: "normal" }])).toBe(0);
  });
});
