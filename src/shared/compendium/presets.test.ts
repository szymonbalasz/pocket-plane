// FR-CMP-29 preset resolution: presetKey > preset > built-in trigger by featureKey; effect presets
// (rage) resolve to nothing; spells by built-in only (Hunter's Mark).
import { describe, expect, test } from "bun:test";
import { type PresetSource, resolvePreset } from "./presets";

const RULE = {
  on: "hit" as const,
  when: [{ if: "ownTurn" as const }],
  every: "turn" as const,
  // biome-ignore lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4)
  then: { do: "damage" as const, formula: "1d6", type: "radiant" as const },
};

const feature = (sourceKey: string | null, body: object = {}): PresetSource => ({
  id: "e1",
  kind: "feature",
  name: "Divine Fury",
  source: sourceKey === null ? null : "srd-5.1",
  sourceKey,
  body: { text: "t", ...body },
});

describe("FR-CMP-29 preset resolution", () => {
  test("FR-CMP-29 presetKey > preset > built-in trigger by featureKey", () => {
    expect(resolvePreset(feature("feature/rogue/sneak-attack"))).toEqual({
      via: "builtin",
      name: "Sneak Attack",
      from: { presetKey: "sneak-attack" },
    });
    expect(
      resolvePreset(feature("feature/rogue/sneak-attack", { presetKey: "colossus-slayer" })),
    ).toEqual({
      via: "presetKey",
      name: "Colossus Slayer",
      from: { presetKey: "colossus-slayer" },
    });
    expect(resolvePreset(feature(null, { preset: RULE }))).toEqual({
      via: "preset",
      name: "Divine Fury",
      from: { name: "Divine Fury", rule: RULE },
    });
    expect(resolvePreset(feature(null, { presetKey: "no-such-key" }))).toBeNull();
    expect(resolvePreset(feature(null))).toBeNull();
  });

  test("FR-CMP-29 rage (an effect preset) → none; Hunter's Mark spell → hunters-mark; other kinds none", () => {
    expect(resolvePreset(feature("feature/barbarian/rage"))).toBeNull();
    expect(resolvePreset(feature(null, { presetKey: "rage" }))).toBeNull();
    const spell = (sourceKey: string): PresetSource => ({
      id: "s1",
      kind: "spell",
      name: "x",
      source: "srd-5.1",
      sourceKey,
      body: { text: "t" },
    });
    expect(resolvePreset(spell("spell/hunters-mark"))?.from).toEqual({ presetKey: "hunters-mark" });
    expect(resolvePreset(spell("spell/fireball"))).toBeNull();
    expect(resolvePreset({ ...spell("item/x"), kind: "item" })).toBeNull();
  });
});
