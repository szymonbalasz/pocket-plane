import { describe, expect, test } from "bun:test";
import { ApplyInput, PresetInput, PutPresetInput, ToggleInput } from "./intents";
import { BUILTIN_PRESET_DEFS, builtinPreset, builtinPresets } from "./presets";
import {
  activeMods,
  type ModEffect,
  matches,
  matchingMods,
  partDice,
  presetChoices,
  type RollShape,
  toggleOn,
} from "./rules";
import {
  AnyModifier,
  BUILTIN_PRESET_KEYS,
  type EffectPresetRecord,
  Modifier,
  type Modifier as ModifierT,
  modifierTier,
} from "./schemas";

describe("FR-MOD-05 built-in presets", () => {
  test("FR-MOD-05 every built-in part parses as a modifier of its tier; keys = BUILTIN_PRESET_KEYS", () => {
    expect(BUILTIN_PRESET_DEFS.map((d) => d.key)).toEqual([...BUILTIN_PRESET_KEYS]);
    for (const d of BUILTIN_PRESET_DEFS) {
      for (const p of d.modifiers) {
        expect(AnyModifier.safeParse(p.modifier).success).toBe(true);
        expect(p.tier).toBe(modifierTier(p.modifier));
      }
    }
  });

  test("FR-MOD-05 tier 1: Rage = +2 weapon damage only; Shield of Faith, Reckless, Dodge hidden", () => {
    const t1 = builtinPresets(1);
    expect(t1.map((p) => p.key)).toEqual([
      "bless",
      "bane",
      "rage",
      "hunters-mark",
      "guidance",
      "resistance",
    ]);
    expect(builtinPreset("rage")?.modifiers).toEqual([
      { kind: "flat", on: { roll: "damage", via: "weapon" }, value: 2 },
    ]);
    expect(builtinPreset("shield-of-faith")).toBeUndefined();
    // Every shipped part is a valid stored modifier at the built tier.
    for (const p of t1)
      for (const m of p.modifiers) expect(Modifier.safeParse(m).success).toBe(true);
  });

  test("FR-MOD-05 at tier 2 every built-in shows, Rage with 4 parts", () => {
    const t2 = builtinPresets(2);
    expect(t2).toHaveLength(BUILTIN_PRESET_KEYS.length);
    expect(t2.find((p) => p.key === "rage")?.modifiers).toHaveLength(4);
  });
});

const sel = (s: object) => s as Parameters<typeof matches>[0];

describe("FR-MOD-02 matcher", () => {
  const cases: [string, object, RollShape, boolean][] = [
    ["attack any via, weapon roll", { roll: "attack" }, { roll: "attack", via: "weapon" }, true],
    ["attack any via, spell roll", { roll: "attack" }, { roll: "attack", via: "spell" }, true],
    [
      "attack weapon vs spell",
      { roll: "attack", via: "weapon" },
      { roll: "attack", via: "spell" },
      false,
    ],
    [
      "damage weapon vs weapon",
      { roll: "damage", via: "weapon" },
      { roll: "damage", via: "weapon" },
      true,
    ],
    ["damage weapon vs no via", { roll: "damage", via: "weapon" }, { roll: "damage" }, false],
    ["attack ≠ damage", { roll: "attack" }, { roll: "damage", via: "weapon" }, false],
    ["save any, death save (no ability)", { roll: "save" }, { roll: "save" }, true],
    ["save str, death save", { roll: "save", abilities: ["str"] }, { roll: "save" }, false],
    [
      "save con, concentration",
      { roll: "save", abilities: ["con"] },
      { roll: "save", ability: "con" },
      true,
    ],
    [
      "save wis vs con",
      { roll: "save", abilities: ["wis"] },
      { roll: "save", ability: "con" },
      false,
    ],
    [
      "check str, Athletics (str)",
      { roll: "check", abilities: ["str"] },
      { roll: "check", ability: "str" },
      true,
    ],
    ["check any, Stealth (dex)", { roll: "check" }, { roll: "check", ability: "dex" }, true],
    ["check ≠ save", { roll: "check" }, { roll: "save", ability: "dex" }, false],
    ["initiative", { roll: "initiative" }, { roll: "initiative" }, true],
    ["ac never matches a roll", { roll: "ac" }, { roll: "attack" }, false],
  ];
  for (const [name, s, shape, want] of cases) {
    test(`FR-MOD-02 ${name} → ${want}`, () => expect(matches(sel(s), shape)).toBe(want));
  }
});

const bless: ModifierT = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 };
const blessSave: ModifierT = { kind: "dice", on: { roll: "save" }, dice: "1d4", sign: 1 };
const rage: ModifierT = { kind: "flat", on: { roll: "damage", via: "weapon" }, value: 2 };
const fx = (o: Partial<ModEffect> & { id: string }): ModEffect => ({
  targetCharacterId: "mira",
  targetCombatantId: null,
  modifiers: [],
  endedAt: null,
  ...o,
});

describe("FR-MOD-04 active modifiers", () => {
  test("FR-MOD-04 the creature's active effects, by seq then index; ended and others' excluded", () => {
    const effects = [
      fx({ id: "b", seq: 5, modifiers: [rage] }),
      fx({ id: "a", seq: 2, modifiers: [bless, blessSave] }),
      fx({ id: "ended", seq: 1, modifiers: [bless], endedAt: "t" }),
      fx({ id: "thorn", seq: 3, targetCharacterId: "thorn", modifiers: [bless] }),
      fx({
        id: "goblin",
        seq: 4,
        targetCharacterId: null,
        targetCombatantId: "g1",
        modifiers: [bless],
      }),
    ];
    expect(activeMods(effects, { characterId: "mira" }).map((m) => [m.effect.id, m.index])).toEqual(
      [
        ["a", 0],
        ["a", 1],
        ["b", 0],
      ],
    );
    expect(activeMods(effects, { combatantId: "g1" }).map((m) => m.effect.id)).toEqual(["goblin"]);
  });

  test("FR-MOD-04 players' rows (no seq, no endedAt) keep the store order", () => {
    const effects = [
      { id: "x", targetCharacterId: "mira", targetCombatantId: null, modifiers: [rage] },
      { id: "y", targetCharacterId: "mira", targetCombatantId: null, modifiers: [bless] },
    ];
    expect(activeMods(effects, { characterId: "mira" }).map((m) => m.effect.id)).toEqual([
      "x",
      "y",
    ]);
  });

  test("FR-MOD-14 matching: Bless on attacks and saves, not damage; Rage on weapon damage", () => {
    const effects = [fx({ id: "a", seq: 1, modifiers: [bless, blessSave, rage] })];
    const ids = (s: RollShape) =>
      matchingMods(effects, { characterId: "mira" }, s).map((m) => m.index);
    expect(ids({ roll: "attack", via: "weapon" })).toEqual([0]);
    expect(ids({ roll: "save" })).toEqual([1]);
    expect(ids({ roll: "damage", via: "weapon" })).toEqual([2]);
    expect(ids({ roll: "damage", via: "spell" })).toEqual([]);
  });

  test("FR-MOD-14 crit doubles dice on damage only", () => {
    expect(partDice("1d6", { roll: "damage", crit: true })).toBe("2d6");
    expect(partDice("3d4", { roll: "damage", crit: true })).toBe("6d4");
    expect(partDice("1d4", { roll: "attack", crit: true })).toBe("1d4");
    expect(partDice("1d6", { roll: "damage" })).toBe("1d6");
  });
});

const preset = (o: Partial<EffectPresetRecord> = {}): EffectPresetRecord => ({
  id: "p1",
  campaignId: "c",
  seq: 1,
  key: null,
  characterId: null,
  ownerPlayerId: null,
  name: "Cursed",
  modifiers: [blessSave],
  durationRounds: null,
  concentration: false,
  activeEffectId: null,
  usesFeatureId: null,
  note: "",
  createdAt: "t",
  updatedAt: "t",
  ...o,
});

describe("FR-MOD-11 toggle state", () => {
  test("FR-MOD-11 on iff activeEffectId names an active effect", () => {
    const active = [{ id: "e1", endedAt: null }];
    expect(toggleOn(preset({ activeEffectId: "e1" }), active)).toBe(true);
    expect(toggleOn(preset({ activeEffectId: "e1" }), [{ id: "e1", endedAt: "t" }])).toBe(false);
    // Players' store holds active effects only: a missing row reads as off.
    expect(toggleOn(preset({ activeEffectId: "e1" }), [])).toBe(false);
    expect(toggleOn(preset({ activeEffectId: null }), active)).toBe(false);
  });
});

describe("FR-MOD-06 preset list", () => {
  test("FR-MOD-06 a customised row replaces its built-in in place; campaign rows after; character rows not listed", () => {
    const list = presetChoices([
      preset({ id: "cursed", seq: 3 }),
      preset({ id: "house", seq: 2, key: "bless", name: "Bless", note: "House" }),
      preset({ id: "rage", seq: 4, characterId: "thorn", ownerPlayerId: "p2", name: "Rage" }),
    ]);
    expect(list.map((c) => [c.source, c.key, "id" in c.preset ? c.preset.id : null])).toEqual([
      ["customised", "bless", "house"],
      ["builtin", "bane", null],
      ["builtin", "rage", null],
      ["builtin", "hunters-mark", null],
      ["builtin", "guidance", null],
      ["builtin", "resistance", null],
      ["campaign", null, "cursed"],
    ]);
  });
});

describe("FR-MOD-01 intent bounds", () => {
  const base = {
    characterId: null,
    name: "Cursed",
    modifiers: [blessSave],
    durationRounds: null,
    concentration: false,
  };
  test("FR-MOD-01 presets: 1–6 built-tier modifiers; key on campaign presets only; name per label rules", () => {
    expect(PresetInput.safeParse(base).success).toBe(true);
    expect(PresetInput.safeParse({ ...base, modifiers: [] }).success).toBe(false);
    expect(PresetInput.safeParse({ ...base, modifiers: Array(7).fill(bless) }).success).toBe(false);
    const mode = { kind: "mode", on: { roll: "check" }, mode: "advantage" };
    expect(PresetInput.safeParse({ ...base, modifiers: [mode] }).success).toBe(false);
    const ac = { kind: "flat", on: { roll: "ac" }, value: 2 };
    expect(PresetInput.safeParse({ ...base, modifiers: [ac] }).success).toBe(false);
    expect(PresetInput.safeParse({ ...base, key: "bless" }).success).toBe(true);
    expect(PresetInput.safeParse({ ...base, key: "bless", characterId: "x" }).success).toBe(false);
    expect(PresetInput.safeParse({ ...base, key: "fireball" }).success).toBe(false);
    expect(PresetInput.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(PresetInput.safeParse({ ...base, name: "x".repeat(41) }).success).toBe(false);
    expect(PresetInput.safeParse({ ...base, durationRounds: 101 }).success).toBe(false);
    expect(PresetInput.safeParse({ ...base, note: "n".repeat(201) }).success).toBe(false);
    expect(PutPresetInput.safeParse({ preset: base, extra: 1 }).success).toBe(false);
  });

  test("FR-MOD-09 apply: 1–20 targets; concentration needs a source; FR-MOD-11 toggle strict", () => {
    const t = { combatantId: "k1" };
    const ok = { targets: [t], preset: { key: "bless" } };
    expect(ApplyInput.safeParse(ok).success).toBe(true);
    expect(ApplyInput.safeParse({ ...ok, targets: [] }).success).toBe(false);
    expect(ApplyInput.safeParse({ ...ok, targets: Array(21).fill(t) }).success).toBe(false);
    expect(ApplyInput.safeParse({ ...ok, startConcentration: true }).success).toBe(false);
    expect(ApplyInput.safeParse({ ...ok, linkConcentration: true }).success).toBe(false);
    expect(
      ApplyInput.safeParse({ ...ok, startConcentration: true, sourceCombatantId: "k2" }).success,
    ).toBe(true);
    expect(ApplyInput.safeParse({ ...ok, durationRounds: null }).success).toBe(true);
    expect(ApplyInput.safeParse({ ...ok, preset: { key: "nope" } }).success).toBe(false);
    expect(ToggleInput.safeParse({ characterId: "c", presetId: "p", on: true }).success).toBe(true);
    expect(ToggleInput.safeParse({ characterId: "c", presetId: "p" }).success).toBe(false);
  });
});
