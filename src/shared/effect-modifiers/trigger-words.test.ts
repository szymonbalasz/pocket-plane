// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Triggers in words (FR-MOD-49, -50): sentences for the fixture and built-in rules, the formula
// value now per owner, the block's warnings, redacted player copies (FR-MOD-47).
import { describe, expect, test } from "bun:test";
import type { StatBlock } from "@shared/entities/schemas";
import { formulaOwnerOf } from "./trigger-fire";
import { getTriggerPreset } from "./trigger-presets";
import { MISSING_PRESET_NAME } from "./trigger-records";
import {
  hasRedactedRefs,
  presetRefName,
  triggerSentence,
  triggerValueNow,
  triggerWarnings,
} from "./trigger-words";
import type { PlayerTriggerRule, TriggerRule } from "./triggers";

const brakka = formulaOwnerOf({
  abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 12, cha: 10 },
  level: 5,
  className: "Barbarian",
  classes: [{ name: "Barbarian", level: 5, hitDie: "d12" }],
} as unknown as StatBlock);
const elite = formulaOwnerOf({
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 8, cha: 8 },
  cr: "1/2",
} as unknown as StatBlock);

const cx = {
  presetName: (id: string) => ({ "p-rage": "Rage", "p-ward": "Frost Ward" })[id],
  featureName: (id: string) => ({ "f-rage": "Rage" })[id],
};

const divineFury: TriggerRule = {
  on: "hit",
  requires: { preset: "p-rage" },
  when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
  every: "turn",
  then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
};
const rule = (key: string) => getTriggerPreset(key)?.rule as TriggerRule;
const RAGE_ROW = { id: "f-rage", name: "Rage", source: "", text: "", used: 0, usesMax: 3 };

describe("FR-MOD-49 trigger sentence", () => {
  test("FR-MOD-49 Divine Fury: 'Once per turn, on a weapon hit on your turn, while Rage is on: …'", () => {
    expect(triggerSentence(divineFury, cx)).toBe(
      "Once per turn, on a weapon hit on your turn, while Rage is on: 1d6 + floor(level(barbarian) / 2) radiant",
    );
  });

  test("FR-MOD-49 built-ins: soft / ask checks, marks, hurt targets, reminders", () => {
    expect(triggerSentence(rule("sneak-attack"), cx)).toBe(
      "Once per turn, on a weapon hit with a normal roll or advantage: (ceil(level(rogue) / 2))d6 damage of the attack's type (ticked with advantage; check: finesse or ranged; or an ally within 5 ft)",
    );
    expect(triggerSentence(rule("hunters-mark"), cx)).toBe(
      "On a weapon hit against a target with your Hunter's Mark: 1d6 damage of the attack's type",
    );
    expect(triggerSentence(rule("colossus-slayer"), cx)).toContain("against a hurt target");
    expect(triggerSentence(rule("regeneration"), cx)).toBe(
      "At the start of its turn: remind “regain {value} HP unless it took acid or fire damage” (value 10)",
    );
  });

  test("FR-MOD-49 roll triggers, rows, crits, feature uses, redacted names", () => {
    const r: PlayerTriggerRule = {
      on: "roll",
      requires: { name: "Frost Ward" },
      when: [
        { if: "roll", on: { roll: "damage", via: "weapon" } },
        { if: "row", names: ["Greataxe", "Handaxe"] },
        { if: "crit" },
      ],
      every: { feature: "f-rage" },
      then: { do: "part", formula: "1d12" },
    };
    expect(triggerSentence(r, cx)).toBe(
      "Spends a use of Rage, on weapon damage rolls with Greataxe or Handaxe on a crit, while Frost Ward is on: + 1d12",
    );
    expect(
      triggerSentence({ ...r, requires: { preset: "gone" }, every: { feature: "x" } }, cx),
    ).toBe(
      `Spends a use of a missing feature, on weapon damage rolls with Greataxe or Handaxe on a crit, while ${MISSING_PRESET_NAME} is on: + 1d12`,
    );
    expect(presetRefName({ preset: "rage" }, cx)).toBe("Rage");
  });
});

describe("FR-MOD-49 formula now", () => {
  test("FR-MOD-49 '= 1d6+2' for Brakka; CR 1/2 monster; no owner → none; errors surface", () => {
    const v = triggerValueNow(divineFury, brakka);
    expect(v?.ok && v.value.expression).toBe("1d6+2");
    const ma = triggerValueNow(rule("martial-advantage"), elite);
    expect(ma?.ok && ma.value.expression).toBe("2d6");
    expect(triggerValueNow(divineFury, null)).toBeNull();
    expect(triggerValueNow({ then: { do: "mode", mode: "advantage" } }, brakka)).toBeNull();
    const big = triggerValueNow(
      { then: { do: "damage", formula: "20d6 + 6d8", type: null } },
      brakka,
    );
    expect(big?.ok).toBe(false);
    expect(big && !big.ok && big.error.message).toBe("Too many dice: 26 > 25");
  });
});

describe("FR-MOD-49 warnings", () => {
  test("FR-MOD-49 'Uses link broken': row deleted, uses cleared, sheet not held", () => {
    const r: TriggerRule = { ...divineFury, every: { feature: "f-rage" } };
    expect(triggerWarnings(r, [RAGE_ROW], cx)).toEqual([]);
    expect(triggerWarnings(r, [], cx)).toEqual(["uses-broken"]);
    expect(triggerWarnings(r, [{ ...RAGE_ROW, usesMax: undefined }], cx)).toEqual(["uses-broken"]);
    expect(triggerWarnings(r, undefined, cx)).toEqual(["uses-broken"]);
  });

  test("FR-MOD-49 'Requires a missing preset': deleted preset / mark, 'Missing preset' copy; built-ins fine", () => {
    expect(triggerWarnings(divineFury, undefined, cx)).toEqual([]);
    expect(triggerWarnings({ ...divineFury, requires: { preset: "rage" } }, undefined, cx)).toEqual(
      [],
    );
    expect(triggerWarnings({ ...divineFury, requires: { preset: "gone" } }, undefined, cx)).toEqual(
      ["missing-preset"],
    );
    const copy: PlayerTriggerRule = { ...divineFury, requires: { name: MISSING_PRESET_NAME } };
    expect(triggerWarnings(copy, undefined, cx)).toEqual(["missing-preset"]);
    expect(
      triggerWarnings({ ...divineFury, requires: { name: "Frost Ward" } }, undefined, cx),
    ).toEqual([]);
    const marked: TriggerRule = {
      ...rule("hunters-mark"),
      when: [{ if: "targetMarked", preset: "gone" }],
    };
    expect(triggerWarnings(marked, undefined, cx)).toEqual(["missing-preset"]);
    expect(triggerWarnings(rule("hunters-mark"), undefined, cx)).toEqual([]);
  });

  test("FR-MOD-47 a player's copy with a campaign preset by name is redacted (not savable)", () => {
    expect(hasRedactedRefs(divineFury)).toBe(false);
    expect(hasRedactedRefs({ ...divineFury, requires: { name: "Frost Ward" } })).toBe(true);
    expect(
      hasRedactedRefs({ ...rule("hunters-mark"), when: [{ if: "targetMarked", name: "Foe" }] }),
    ).toBe(true);
  });
});
