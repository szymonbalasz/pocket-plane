// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Built-in trigger presets (FR-MOD-46, MOD §8.6; #209) and the Divine Fury acceptance rule
// (§6.1) as plain data.
import { describe, expect, test } from "bun:test";
import { type FormulaOwner, formulaValue } from "./formula";
import { builtinPreset } from "./presets";
import { PutTriggerInput } from "./trigger-intents";
import {
  draftFromTriggerPreset,
  getTriggerPreset,
  isTriggerPresetKey,
  startFromTriggerPreset,
  TRIGGER_PRESETS,
  type TriggerPreset,
  triggerPresetForFeature,
  triggerPresetsFor,
} from "./trigger-presets";
import { checkRuleForOwner, reminderText, TriggerRule } from "./triggers";

const thorn: FormulaOwner = { level: 5, classes: [{ name: "Rogue", level: 5 }], prof: 3 };
const brakka: FormulaOwner = {
  level: 5,
  classes: [{ name: "Barbarian", level: 5 }],
  prof: 3,
  abilities: { str: 4 },
};

const expression = (formula: string, owner: FormulaOwner, crit = false) => {
  const v = formulaValue(formula, owner, { crit });
  if (!v.ok) throw new Error(v.error.message);
  return v.value.expression;
};

describe("FR-MOD-46 built-in trigger presets", () => {
  test("FR-MOD-46 built-ins: exactly the five keys, no divine-fury", () => {
    expect(TRIGGER_PRESETS.map((p) => p.key)).toEqual([
      "sneak-attack",
      "hunters-mark",
      "colossus-slayer",
      "martial-advantage",
      "regeneration",
    ]);
    expect(isTriggerPresetKey("divine-fury")).toBe(false);
    expect(getTriggerPreset("divine-fury")).toBeUndefined();
    expect(getTriggerPreset("sneak-attack")?.name).toBe("Sneak Attack");
  });

  test("FR-MOD-46 built-ins: every rule parses and checks for its owner kind", () => {
    for (const p of TRIGGER_PRESETS) {
      expect([p.key, TriggerRule.safeParse(p.rule).success]).toEqual([p.key, true]);
      const values = p.owner === "character" ? thorn : { cr: 3, prof: 2 };
      expect(checkRuleForOwner(p.rule, { kind: p.owner, values })).toBeNull();
      // Owner-specific fields: none of the five sets them (FR-MOD-46).
      expect(p.rule.requires).toBeUndefined();
      expect(typeof p.rule.every).toBe("string");
    }
  });

  test("FR-MOD-47 built-ins: public on for character triggers, off for monster ones", () => {
    expect(TRIGGER_PRESETS.map((p) => [p.key, p.owner, p.public])).toEqual([
      ["sneak-attack", "character", true],
      ["hunters-mark", "character", true],
      ["colossus-slayer", "character", true],
      ["martial-advantage", "definition", false],
      ["regeneration", "definition", false],
    ]);
  });

  test("FR-MOD-46 built-ins: featureKeys per §8.6, `<source>:<sourceKey>`", () => {
    const keys = Object.fromEntries(TRIGGER_PRESETS.map((p) => [p.key, p.featureKeys]));
    expect(keys).toEqual({
      "sneak-attack": ["srd-5.1:feature/rogue/sneak-attack"],
      "hunters-mark": ["srd-5.1:spell/hunters-mark"],
      "colossus-slayer": ["srd-5.1:feature/ranger/hunters-prey"],
      "martial-advantage": [],
      regeneration: [],
    });
  });

  test("FR-MOD-46 built-ins: values for sample owners", () => {
    const formula = (key: string) => {
      const t = getTriggerPreset(key)?.rule.then;
      return t?.do === "damage" ? t.formula : "";
    };
    expect(expression(formula("sneak-attack"), thorn)).toBe("3d6");
    expect(expression(formula("sneak-attack"), thorn, true)).toBe("6d6");
    expect(expression(formula("hunters-mark"), thorn)).toBe("1d6");
    expect(expression(formula("colossus-slayer"), thorn)).toBe("1d8");
    expect(expression(formula("martial-advantage"), { cr: 0.5, prof: 2 })).toBe("2d6");
    const regen = getTriggerPreset("regeneration")?.rule.then;
    if (regen?.do !== "remind") throw new Error("regeneration is a reminder");
    const v = formulaValue(regen.value ?? "", { cr: 5 });
    expect(reminderText(regen.text, v.ok ? v.value : null)).toBe(
      "regain 10 HP unless it took acid or fire damage",
    );
  });

  test("FR-MOD-46 no non-SRD subclass name in MOD's src and fixtures folders (#209)", async () => {
    const banned = ["zea", "lot"].join("");
    const globs = [
      "src/shared/effect-modifiers/**/*",
      "src/server/features/effect-modifiers/**/*",
      "src/client/*/features/effect-modifiers/**/*",
      "fixtures/units/effect-modifiers/**/*",
    ];
    const root = `${import.meta.dir}/../../..`;
    const files = globs.flatMap((g) => [...new Bun.Glob(g).scanSync({ cwd: root })]);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of files) {
      const text = await Bun.file(`${root}/${f}`).text();
      if (text.toLowerCase().includes(banned)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});

describe("FR-MOD-46 Start from", () => {
  test("FR-MOD-46 Start from lists the built-ins per owner kind, §8.6 order", () => {
    expect(triggerPresetsFor("character").map((p) => p.key)).toEqual([
      "sneak-attack",
      "hunters-mark",
      "colossus-slayer",
    ]);
    expect(triggerPresetsFor("definition").map((p) => p.key)).toEqual([
      "martial-advantage",
      "regeneration",
    ]);
  });

  test("FR-MOD-46 Start from copies a built-in into a valid putTrigger draft for the owner (a fresh rule copy)", () => {
    for (const p of TRIGGER_PRESETS) {
      const owner = { kind: p.owner, id: "owner-1" };
      const s = startFromTriggerPreset(p.key, owner);
      expect(s?.draft).toEqual({
        characterId: p.owner === "character" ? "owner-1" : null,
        definitionId: p.owner === "definition" ? "owner-1" : null,
        name: p.name,
        enabled: true,
        public: p.public,
        rule: p.rule,
      });
      expect(s?.draft.rule).not.toBe(p.rule);
      expect(s?.confirm).toEqual([]);
      expect(PutTriggerInput.safeParse({ trigger: s?.draft }).success).toBe(true);
    }
    const sa = startFromTriggerPreset("sneak-attack", { kind: "character", id: "c" });
    sa?.draft.rule.when.pop();
    expect(getTriggerPreset("sneak-attack")?.rule.when).toHaveLength(4);
    expect(startFromTriggerPreset("divine-fury", { kind: "character", id: "c" })).toBeUndefined();
    expect(startFromTriggerPreset("regeneration", { kind: "character", id: "c" })).toBeUndefined();
    expect(startFromTriggerPreset("sneak-attack", { kind: "definition", id: "d" })).toBeUndefined();
  });

  test("FR-MOD-46 owner-specific fields: a feature preselected by name (rows with uses), requires kept as the built-in key; both to confirm", () => {
    const p: TriggerPreset = {
      key: "sneak-attack",
      name: "Test",
      owner: "character",
      public: true,
      rule: {
        on: "hit",
        requires: { preset: "rage" },
        when: [],
        every: "turn",
        then: { do: "damage", formula: "1d6", type: null },
      },
      featureKeys: [],
      usesFeature: "Rage",
    };
    const features = [
      { id: "f-1", name: "rage", usesMax: null },
      { id: "f-2", name: " Rage ", usesMax: 3 },
    ];
    const s = draftFromTriggerPreset(p, { kind: "character", id: "c", features });
    expect(s.draft.rule.every).toEqual({ feature: "f-2" });
    expect(s.draft.rule.requires).toEqual({ preset: "rage" });
    expect(s.confirm).toEqual(["requires", "every"]);
    const none = draftFromTriggerPreset(p, { kind: "character", id: "c", features: [] });
    expect([none.draft.rule.every, none.confirm]).toEqual(["turn", ["requires", "every"]]);
  });

  test("FR-MOD-46 featureKeys (S5): the built-in implementing a compendium key; Colossus Slayer = Hunter's Prey (#213)", () => {
    expect(triggerPresetForFeature("srd-5.1:feature/rogue/sneak-attack")?.key).toBe("sneak-attack");
    expect(triggerPresetForFeature("srd-5.1:spell/hunters-mark")?.key).toBe("hunters-mark");
    expect(triggerPresetForFeature("srd-5.1:feature/ranger/hunters-prey")?.key).toBe(
      "colossus-slayer",
    );
    expect(triggerPresetForFeature("srd-5.1:feature/barbarian/rage")).toBeUndefined();
  });

  test("FR-MOD-05 / OQ-MOD-27 Hunter's Mark pairs the mark preset with the trigger (same key)", () => {
    const rule = getTriggerPreset("hunters-mark")?.rule;
    expect(rule?.when).toContainEqual({ if: "targetMarked", preset: "hunters-mark" });
    expect(builtinPreset("hunters-mark")).toMatchObject({ mark: true, modifiers: [] });
  });
});

describe("FR-MOD-46 Divine Fury: trigger data, not a built-in (§6.1, #209)", () => {
  // The §6.2 rule as a fixture would type it: no key, no subclass name; requires the
  // character's own Rage preset (an id), which origin-matches the built-in `rage` (FR-MOD-36).
  const divineFury = {
    on: "hit",
    requires: { preset: "pre-brakka-rage" },
    when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
    every: "turn",
    then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
  };

  test("FR-MOD-33 Divine Fury validates", () => {
    const r = TriggerRule.safeParse(divineFury);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(checkRuleForOwner(r.data, { kind: "character", values: brakka })).toBeNull();
    }
  });

  test("FR-MOD-35 Divine Fury evaluates for Barbarian 5 → 1d6+2 (crit 2d6+2)", () => {
    expect(expression(divineFury.then.formula, brakka)).toBe("1d6+2");
    expect(expression(divineFury.then.formula, brakka, true)).toBe("2d6+2");
  });
});
