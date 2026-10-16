// effect-modifiers shared shapes (MOD §8): modifier bounds per tier, selectors, subjects, the
// `effect-preset` record and built-in keys.
import { describe, expect, test } from "bun:test";
import { ABILITIES, DAMAGE_TYPES } from "@shared/entities/schemas";
import {
  AnyModifier,
  BUILT_TIER,
  BUILTIN_PRESET_KEYS,
  EffectPresetRecord,
  isBuiltinPresetKey,
  MODIFIER_ABILITIES,
  MODIFIER_DAMAGE_TYPES,
  Modifier,
  Modifiers,
  modifierTier,
  PresetModifiers,
  playerPresetKey,
  RollSel,
  RollSubject,
} from "./schemas";

const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  expect(s.safeParse(v).success).toBe(true);
const bad = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  expect(s.safeParse(v).success).toBe(false);

const bless = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 } as const;
const rage = { kind: "flat", on: { roll: "damage", via: "weapon" }, value: 2 } as const;

describe("FR-MOD-01 modifier bounds", () => {
  test("FR-MOD-01 dice: NdM with N 1–4, M ∈ 4/6/8/10/12, sign ±1", () => {
    for (const dice of ["1d4", "2d6", "3d8", "4d10", "1d12"]) ok(Modifier, { ...bless, dice });
    for (const dice of ["0d4", "5d4", "1d20", "1d3", "d4", "1d4+1", "-1d4", " 1d4"]) {
      bad(Modifier, { ...bless, dice });
    }
    ok(Modifier, { ...bless, sign: -1 });
    bad(Modifier, { ...bless, sign: 2 });
    bad(Modifier, { ...bless, sign: 0 });
  });

  test("FR-MOD-01 flat: int −10…10, not 0", () => {
    for (const value of [-10, -1, 1, 10]) ok(Modifier, { ...rage, value });
    for (const value of [0, 11, -11, 1.5]) bad(Modifier, { ...rage, value });
  });

  test("FR-MOD-01 strict: unknown kinds and extra keys rejected", () => {
    bad(Modifier, { ...bless, kind: "multiply" });
    bad(Modifier, { ...bless, extra: 1 });
    bad(Modifier, { ...bless, on: { roll: "attack", extra: 1 } });
    bad(Modifier, { ...bless, on: { roll: "hp" } });
  });

  test("FR-MOD-01 tier 1 built: mode, defense and flat AC parse as any-tier but are invalid", () => {
    expect(BUILT_TIER).toBe(1);
    const mode = { kind: "mode", on: { roll: "check", abilities: ["str"] }, mode: "advantage" };
    const defense = { kind: "defense", types: ["slashing"], level: "resistance" };
    const ac = { kind: "flat", on: { roll: "ac" }, value: 2 };
    for (const m of [mode, defense, ac]) {
      ok(AnyModifier, m);
      bad(Modifier, m);
      expect(modifierTier(AnyModifier.parse(m))).toBe(2);
    }
    expect(modifierTier(AnyModifier.parse(bless))).toBe(1);
    expect(modifierTier(AnyModifier.parse(rage))).toBe(1);
    bad(AnyModifier, { ...defense, types: [] });
    bad(AnyModifier, { ...defense, types: ["slashing", "psychic", "laser"] });
  });

  test("FR-MOD-01 ≤ 6 per effect (0 ok), 1–6 per preset", () => {
    ok(Modifiers, []);
    ok(Modifiers, Array(6).fill(bless));
    bad(Modifiers, Array(7).fill(bless));
    bad(PresetModifiers, []);
    ok(PresetModifiers, Array(6).fill(rage));
    bad(PresetModifiers, Array(7).fill(rage));
  });
});

describe("FR-MOD-02 roll selector", () => {
  test("FR-MOD-02 abilities only on save / check; via only on attack / damage", () => {
    ok(RollSel, { roll: "save", abilities: ["wis", "con"] });
    ok(RollSel, { roll: "check", abilities: ["str"] });
    ok(RollSel, { roll: "attack", via: "spell" });
    ok(RollSel, { roll: "damage", via: "weapon" });
    ok(RollSel, { roll: "initiative" });
    bad(RollSel, { roll: "attack", abilities: ["str"] });
    bad(RollSel, { roll: "initiative", abilities: ["dex"] });
    bad(RollSel, { roll: "save", via: "weapon" });
    bad(RollSel, { roll: "save", abilities: [] });
    bad(RollSel, { roll: "save", abilities: ["wis", "wis"] });
    bad(RollSel, { roll: "save", abilities: ["luck"] });
  });

  test("abilities and damage types match entities' lists (leaf copies)", () => {
    expect([...MODIFIER_ABILITIES]).toEqual([...ABILITIES]);
    expect([...MODIFIER_DAMAGE_TYPES]).toEqual([...DAMAGE_TYPES]);
  });
});

describe("FR-MOD-13 roll subject", () => {
  test("FR-MOD-13 creature is a combatant or a character; strict", () => {
    ok(RollSubject, { creature: { combatantId: "k1" }, roll: "attack", via: "weapon" });
    ok(RollSubject, { creature: { characterId: "mira" }, roll: "save", ability: "con" });
    ok(RollSubject, { creature: { characterId: "mira" }, roll: "save" });
    ok(RollSubject, { creature: { combatantId: "k1" }, roll: "damage", crit: true });
    bad(RollSubject, { creature: { tokenId: "t" }, roll: "attack" });
    bad(RollSubject, { creature: { combatantId: "k1", characterId: "m" }, roll: "attack" });
    bad(RollSubject, { creature: { combatantId: "k1" }, roll: "ac" });
    bad(RollSubject, { creature: { combatantId: "k1" }, roll: "attack", extra: 1 });
  });

  test("FR-MOD-13 (T) card damage subjects: `card`, the card's `toHitMode`, the row's name ≤ 60", () => {
    const dmg = { creature: { combatantId: "k1" }, roll: "damage", via: "weapon" } as const;
    ok(RollSubject, { ...dmg, card: true, toHitMode: "advantage", row: "Greataxe" });
    ok(RollSubject, { ...dmg, row: "x".repeat(60) });
    bad(RollSubject, { ...dmg, row: "x".repeat(61) });
    bad(RollSubject, { ...dmg, row: "" });
    bad(RollSubject, { ...dmg, toHitMode: "elven" });
  });
});

describe("FR-MOD-21 built-in keys", () => {
  test("FR-MOD-05 nine built-in keys; FR-MOD-21 players get built-in keys only, ids → null", () => {
    expect(BUILTIN_PRESET_KEYS).toHaveLength(9);
    expect(isBuiltinPresetKey("bless")).toBe(true);
    expect(isBuiltinPresetKey("hunters-mark")).toBe(true);
    expect(isBuiltinPresetKey(null)).toBe(false);
    expect(playerPresetKey("rage")).toBe("rage");
    expect(playerPresetKey("0b8f6a2e-preset-id")).toBeNull();
    expect(playerPresetKey("Bless")).toBeNull();
    expect(playerPresetKey(null)).toBeNull();
  });
});

describe("MOD §8.2 effect-preset record", () => {
  const campaignPreset = {
    id: "pr-1",
    campaignId: "c1",
    seq: 1,
    key: "bless",
    characterId: null,
    ownerPlayerId: null,
    name: "Bless",
    modifiers: [bless, { ...bless, on: { roll: "save" as const } }],
    durationRounds: 10,
    concentration: true,
    activeEffectId: null,
    usesFeatureId: null,
    originKey: null,
    note: "House: Bless (test)",
    createdAt: "t",
    updatedAt: "t",
  };
  const characterPreset = {
    ...campaignPreset,
    id: "pr-2",
    key: null,
    characterId: "thorn",
    ownerPlayerId: "p2",
    name: "Rage",
    modifiers: [rage],
    concentration: false,
    activeEffectId: "fx-9",
  };

  test("MOD §8.2 campaign and character presets parse and round-trip", () => {
    for (const r of [campaignPreset, characterPreset]) {
      expect(EffectPresetRecord.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
    }
  });

  test("MOD §8.2 key on campaign presets only; owner, toggle, uses on character presets only", () => {
    bad(EffectPresetRecord, { ...characterPreset, key: "rage" });
    bad(EffectPresetRecord, { ...campaignPreset, ownerPlayerId: "p1" });
    bad(EffectPresetRecord, { ...campaignPreset, activeEffectId: "fx" });
    bad(EffectPresetRecord, { ...campaignPreset, usesFeatureId: "row" });
    ok(EffectPresetRecord, { ...characterPreset, usesFeatureId: "row" });
  });

  test("MOD §8.2 bounds: name 1–40, note ≤ 200, 1–6 built-tier modifiers, duration 1–100", () => {
    bad(EffectPresetRecord, { ...campaignPreset, name: "" });
    bad(EffectPresetRecord, { ...campaignPreset, name: "x".repeat(41) });
    bad(EffectPresetRecord, { ...campaignPreset, note: "x".repeat(201) });
    bad(EffectPresetRecord, { ...campaignPreset, modifiers: [] });
    bad(EffectPresetRecord, {
      ...campaignPreset,
      modifiers: [{ kind: "flat", on: { roll: "ac" }, value: 2 }],
    });
    bad(EffectPresetRecord, { ...campaignPreset, durationRounds: 0 });
    bad(EffectPresetRecord, { ...campaignPreset, durationRounds: 101 });
    ok(EffectPresetRecord, { ...campaignPreset, durationRounds: null });
  });
});
