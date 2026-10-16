// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Rule-trigger rule schema (FR-MOD-33, MOD §8.4) and the §8.7 class-feature coverage check.
import { describe, expect, test } from "bun:test";
import type { FormulaOwner } from "./formula";
import { formulaValue } from "./formula";
import { BUILT_TIER } from "./schemas";
import {
  checkRuleForOwner,
  doublesOnCrit,
  PlayerTriggerRule,
  reminderText,
  rowMatches,
  type TriggerEvent,
  TriggerRule,
} from "./triggers";

const ok = (v: unknown) => {
  const r = TriggerRule.safeParse(v);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};
const issues = (v: unknown) => {
  const r = TriggerRule.safeParse(v);
  if (r.success) throw new Error("parsed");
  return r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
};

const BASE: Record<TriggerEvent, Record<string, unknown>> = {
  hit: { on: "hit", when: [], every: "turn", then: { do: "damage", formula: "1d6", type: null } },
  roll: {
    on: "roll",
    when: [{ if: "roll", on: { roll: "damage" } }],
    every: "each",
    then: { do: "part", formula: "2" },
  },
  turnStart: {
    on: "turnStart",
    when: [],
    every: "each",
    then: { do: "remind", text: "regain {value} HP", value: "10" },
  },
};
const with_ = (event: TriggerEvent, extra: Record<string, unknown>) => ({
  ...BASE[event],
  ...extra,
});
const withFilter = (event: TriggerEvent, f: unknown) => ({
  ...BASE[event],
  when: [...(BASE[event].when as unknown[]), f],
});

/** One sample per filter kind (MOD §8.4). */
const FILTERS = {
  via: { if: "via", via: "weapon" },
  row: { if: "row", names: ["Greataxe"] },
  roll: { if: "roll", on: { roll: "attack" } },
  ownTurn: { if: "ownTurn" },
  crit: { if: "crit" },
  mode: { if: "mode", modes: ["advantage"] },
  softMode: { if: "mode", modes: ["advantage"], soft: true },
  targetMarked: { if: "targetMarked", preset: "hunters-mark" },
  targetHurt: { if: "targetHurt" },
  ask: { if: "ask", note: "an ally within 5 ft" },
} as const;

/** MOD §8.4 table, written out (not read from EVENT_FILTERS). `roll` on `roll` = a second one. */
const ALLOWED: Record<TriggerEvent, (keyof typeof FILTERS)[]> = {
  hit: ["via", "row", "ownTurn", "crit", "mode", "softMode", "targetMarked", "targetHurt", "ask"],
  roll: ["row", "ownTurn", "crit", "mode"],
  turnStart: ["ownTurn"],
};

const EFFECTS = {
  damage: { do: "damage", formula: "1d6", type: "radiant" },
  part: { do: "part", formula: "cha" },
  mode: { do: "mode", mode: "advantage" },
  remind: { do: "remind", text: "Check the gate" },
} as const;

describe("FR-MOD-33 rule schema", () => {
  test("FR-MOD-33 rule schema: event × filter table", () => {
    for (const event of ["hit", "roll", "turnStart"] as const) {
      for (const [kind, f] of Object.entries(FILTERS)) {
        const parsed = TriggerRule.safeParse(withFilter(event, f)).success;
        expect([event, kind, parsed]).toEqual([
          event,
          kind,
          ALLOWED[event].includes(kind as keyof typeof FILTERS),
        ]);
      }
    }
  });

  test("FR-MOD-33 rule schema: event × effect table; mode is tier 2", () => {
    const allowed: Record<TriggerEvent, string[]> = {
      hit: ["damage"],
      roll: ["part", ...(BUILT_TIER >= 2 ? ["mode"] : [])],
      turnStart: ["remind"],
    };
    for (const event of ["hit", "roll", "turnStart"] as const) {
      for (const [kind, then] of Object.entries(EFFECTS)) {
        const parsed = TriggerRule.safeParse(with_(event, { then })).success;
        expect([event, kind, parsed]).toEqual([event, kind, allowed[event].includes(kind)]);
      }
    }
    if (BUILT_TIER < 2) {
      expect(issues(with_("roll", { then: EFFECTS.mode }))).toEqual([
        { path: "then.do", message: "This effect is not available yet" },
      ]);
    }
    expect(issues(with_("roll", { then: EFFECTS.damage }))).toEqual([
      { path: "then.do", message: "No damage effect on roll triggers" },
    ]);
  });

  test("FR-MOD-33 rule schema: roll triggers need exactly one roll filter", () => {
    expect(issues(with_("roll", { when: [] }))).toEqual([
      { path: "when", message: "Roll triggers need exactly one roll filter" },
    ]);
    expect(issues(withFilter("roll", FILTERS.roll))).toEqual([
      { path: "when", message: "Roll triggers need exactly one roll filter" },
    ]);
  });

  test("FR-MOD-33 rule schema: filter misuse names the field", () => {
    expect(issues(withFilter("hit", FILTERS.roll))).toEqual([
      { path: "when.0.if", message: "No roll filter on hit triggers" },
    ]);
    expect(issues(withFilter("roll", FILTERS.softMode))).toEqual([
      { path: "when.1.soft", message: "Soft filters on hit triggers only" },
    ]);
    const critOnAttack = { ...BASE.roll, when: [FILTERS.roll, FILTERS.crit] };
    expect(issues(critOnAttack)).toEqual([
      { path: "when", message: "Crit filters on damage rolls only" },
    ]);
    expect(issues({ ...BASE.hit, when: [FILTERS.row, FILTERS.row] })).toEqual([
      { path: "when", message: "At most one row filter" },
    ]);
  });

  test("FR-MOD-33 rule schema: turnStart fires every time only (review R6)", () => {
    for (const every of ["turn", "round", "encounter", { feature: "f-1" }]) {
      expect(issues(with_("turnStart", { every }))).toEqual([
        { path: "every", message: "Turn start reminders fire every time (each)" },
      ]);
    }
  });

  test("FR-MOD-33 rule schema: frequencies", () => {
    for (const every of ["each", "turn", "round", "encounter", { feature: "feat-rage" }]) {
      ok(with_("hit", { every }));
    }
    for (const every of ["day", { feature: "" }, { feature: "x", extra: 1 }, null]) {
      expect(TriggerRule.safeParse(with_("hit", { every })).success).toBe(false);
    }
  });

  test("FR-MOD-33 rule schema: caps and strictness", () => {
    const six = Array.from({ length: 6 }, () => FILTERS.ask);
    ok(with_("hit", { when: six }));
    expect(TriggerRule.safeParse(with_("hit", { when: [...six, FILTERS.ask] })).success).toBe(
      false,
    );
    const bad = (v: unknown) => expect(TriggerRule.safeParse(v).success).toBe(false);
    bad(withFilter("hit", { if: "ask", note: "x".repeat(61) }));
    ok(withFilter("hit", { if: "ask", note: "x".repeat(60) }));
    bad(withFilter("hit", { if: "ask", note: "" }));
    bad(withFilter("hit", { if: "row", names: [] }));
    bad(withFilter("hit", { if: "row", names: ["a", "b", "c", "d", "e"] }));
    bad(withFilter("hit", { if: "row", names: ["x".repeat(41)] }));
    ok(withFilter("hit", { if: "row", names: ["a", "b", "c", "x".repeat(40)] }));
    bad(withFilter("hit", { if: "mode", modes: [] }));
    bad(withFilter("hit", { if: "mode", modes: ["advantage", "advantage"] }));
    bad(withFilter("hit", { if: "mode", modes: ["advantage"], soft: false }));
    bad(withFilter("hit", { if: "via", via: "melee" }));
    bad(withFilter("hit", { if: "flanking" }));
    bad(withFilter("hit", { if: "ownTurn", extra: true }));
    bad(withFilter("hit", { if: "targetMarked", name: "Hex" }));
    bad(with_("hit", { requires: { preset: "x".repeat(41) } }));
    ok(with_("hit", { requires: { preset: "rage" } }));
    bad(with_("hit", { requires: { name: "Rage" } }));
    bad(with_("hit", { script: "x" }));
    bad(with_("hit", { on: "damageTaken" }));
    bad(with_("hit", { then: { do: "damage", formula: "1d6", type: "holy" } }));
    bad(with_("hit", { then: { do: "damage", formula: "1d6" } }));
    bad(with_("turnStart", { then: { do: "remind", text: "x".repeat(121) } }));
    ok(with_("turnStart", { then: { do: "remind", text: "x".repeat(120) } }));
    bad(with_("turnStart", { then: { do: "remind", text: "" } }));
  });

  test("FR-MOD-33 rule schema: formulas parse with the §8.5 grammar", () => {
    expect(
      issues(with_("hit", { then: { do: "damage", formula: "1d6 + foo", type: null } })),
    ).toEqual([{ path: "then.formula", message: "Unknown name ‘foo’ at 7" }]);
    expect(issues(with_("roll", { then: { do: "part", formula: "__proto__" } }))).toEqual([
      { path: "then.formula", message: "Unknown name ‘__proto__’ at 1" },
    ]);
    expect(
      issues(with_("turnStart", { then: { do: "remind", text: "x", value: "constructor" } })),
    ).toEqual([{ path: "then.value", message: "Unknown name ‘constructor’ at 1" }]);
  });

  test("FR-MOD-47 player copy: requires and targetMarked may carry a preset name", () => {
    const copy = {
      ...BASE.hit,
      requires: { name: "Rage" },
      when: [{ if: "targetMarked", name: "Hex" }, FILTERS.via],
    };
    expect(PlayerTriggerRule.safeParse(copy).success).toBe(true);
    expect(TriggerRule.safeParse(copy).success).toBe(false);
    expect(
      PlayerTriggerRule.safeParse(with_("hit", { requires: { preset: "rage" } })).success,
    ).toBe(true);
    expect(PlayerTriggerRule.safeParse(withFilter("roll", FILTERS.softMode)).success).toBe(false);
  });
});

describe("FR-MOD-34 save-time checks against the owner", () => {
  const def = { kind: "definition" as const, values: { cr: 3, prof: 2 } };
  const char = (values: FormulaOwner) => ({ kind: "character" as const, values });

  test("FR-MOD-33 feature frequency on characters only", () => {
    const rule = ok(with_("hit", { every: { feature: "feat-1" } }));
    expect(checkRuleForOwner(rule, char({}))).toBeNull();
    expect(checkRuleForOwner(rule, def)).toEqual({
      path: ["every"],
      message: "Feature uses: characters only",
    });
  });

  test("FR-MOD-34 dice cap and die-size formula for this owner", () => {
    const rule = ok(
      with_("hit", { then: { do: "damage", formula: "(level)d6 + (level)d8", type: null } }),
    );
    expect(checkRuleForOwner(rule, char({ level: 12 }))).toBeNull();
    expect(checkRuleForOwner(rule, char({ level: 15 }))).toEqual({
      path: ["then", "formula"],
      message: "Too many dice: 30 > 25",
    });
    const size = ok(with_("roll", { then: { do: "part", formula: "1d(level)" } }));
    expect(checkRuleForOwner(size, char({ level: 7 }))?.message).toBe("Die size 7 at 3");
    const remind = ok(with_("turnStart", { then: { do: "remind", text: "x", value: "1d(cr)" } }));
    expect(checkRuleForOwner(remind, def)).toEqual({
      path: ["then", "value"],
      message: "Die size 3 at 3",
    });
  });
});

describe("FR-MOD-37 / -43 rule helpers", () => {
  test("FR-MOD-37 crit doubling unless a crit filter (§8.4)", () => {
    expect(doublesOnCrit(ok(BASE.hit))).toBe(true);
    expect(doublesOnCrit(ok(withFilter("hit", FILTERS.crit)))).toBe(false);
  });

  test("FR-MOD-13 row filter: case-insensitive, no row on the subject → no match", () => {
    expect(rowMatches(["Eldritch Blast"], "eldritch blast")).toBe(true);
    expect(rowMatches(["Greataxe", "Handaxe"], " HANDAXE ")).toBe(true);
    expect(rowMatches(["Greataxe"], "Greatsword")).toBe(false);
    expect(rowMatches(["Greataxe"], undefined)).toBe(false);
  });

  test("FR-MOD-44 reminder text interpolates the value", () => {
    const v = formulaValue("10", {});
    expect(reminderText("regain {value} HP", v.ok ? v.value : null)).toBe("regain 10 HP");
    expect(reminderText("regain {value} HP", null)).toBe("regain 0 HP");
  });
});

// §8.7 coverage (#209): every E / ask row that needs only the rule + formula validates and
// evaluates for a sample owner. Toggle-preset rows (Great Weapon Master, Sharpshooter) and the
// built-ins (Sneak Attack, Hunter's Mark, Colossus Slayer) are covered elsewhere; gaps are out.
describe("FR-MOD-34 §8.7 coverage", () => {
  const value = (rule: TriggerRule, owner: FormulaOwner, crit = false) => {
    expect(checkRuleForOwner(rule, { kind: "character", values: owner })).toBeNull();
    const f = rule.then.do === "damage" || rule.then.do === "part" ? rule.then.formula : "";
    const v = formulaValue(f, owner, { crit: crit && doublesOnCrit(rule) });
    if (!v.ok) throw new Error(v.error.message);
    return v.value.expression;
  };
  const classes = (name: string, level: number): FormulaOwner => ({
    level,
    classes: [{ name, level }],
  });

  test("FR-MOD-34 §8.7 Divine Smite (ask): 2d8 radiant", () => {
    const rule = ok({
      on: "hit",
      when: [
        { if: "via", via: "weapon" },
        { if: "ask", note: "Smite? slot over 1st / undead: +1d8 each" },
      ],
      every: "each",
      then: { do: "damage", formula: "2d8", type: "radiant" },
    });
    expect(value(rule, classes("Paladin", 2))).toBe("2d8");
    expect(value(rule, classes("Paladin", 2), true)).toBe("4d8");
  });

  test("FR-MOD-34 §8.7 Improved Divine Smite: 1d8 radiant", () => {
    const rule = ok({
      on: "hit",
      when: [{ if: "via", via: "weapon" }],
      every: "each",
      then: { do: "damage", formula: "1d8", type: "radiant" },
    });
    expect(value(rule, classes("Paladin", 11))).toBe("1d8");
  });

  test("FR-MOD-34 §8.7 Hex: targetMarked a campaign mark, 1d6 necrotic", () => {
    const rule = ok({
      on: "hit",
      when: [{ if: "targetMarked", preset: "pre-hex" }],
      every: "each",
      then: { do: "damage", formula: "1d6", type: "necrotic" },
    });
    expect(value(rule, classes("Warlock", 3))).toBe("1d6");
  });

  test("FR-MOD-34 §8.7 Agonizing Blast: roll part `cha` on the Eldritch Blast row", () => {
    const rule = ok({
      on: "roll",
      when: [
        { if: "roll", on: { roll: "damage", via: "spell" } },
        { if: "row", names: ["Eldritch Blast"] },
      ],
      every: "each",
      then: { do: "part", formula: "cha" },
    });
    expect(value(rule, { ...classes("Warlock", 2), abilities: { cha: 3 } })).toBe("3");
  });

  test("FR-MOD-34 §8.7 Dread Ambusher (ask): once per encounter, 1d8", () => {
    const rule = ok({
      on: "hit",
      when: [
        { if: "via", via: "weapon" },
        { if: "ownTurn" },
        { if: "ask", note: "the extra attack, first turn only" },
      ],
      every: "encounter",
      then: { do: "damage", formula: "1d8", type: null },
    });
    expect(value(rule, classes("Ranger", 3))).toBe("1d8");
  });

  test("FR-MOD-34 §8.7 Favored Foe: die-size formula d4 / d6 / d8", () => {
    const rule = ok({
      on: "hit",
      when: [{ if: "targetMarked", preset: "pre-favored-foe" }],
      every: "turn",
      then: { do: "damage", formula: "1d(4 + 2 * steps(level(ranger), 6, 14))", type: null },
    });
    expect([5, 6, 14].map((l) => value(rule, classes("Ranger", l)))).toEqual(["1d4", "1d6", "1d8"]);
  });

  test("FR-MOD-34 §8.7 Brutal Critical: crit-filtered roll part, not doubled", () => {
    const rule = ok({
      on: "roll",
      when: [
        { if: "roll", on: { roll: "damage", via: "weapon" } },
        { if: "crit" },
        { if: "row", names: ["Greataxe"] },
      ],
      every: "each",
      then: { do: "part", formula: "(steps(level(barbarian), 9, 13, 17))d12" },
    });
    expect(value(rule, classes("Barbarian", 9), true)).toBe("1d12");
    expect(value(rule, classes("Barbarian", 13), true)).toBe("2d12");
    expect(value(rule, classes("Barbarian", 8), true)).toBeNull();
  });

  test("FR-MOD-34 §8.7 Rage damage as a roll trigger: 2 + steps(level, 9, 16)", () => {
    const rule = ok({
      on: "roll",
      requires: { preset: "rage" },
      when: [{ if: "roll", on: { roll: "damage", via: "weapon" } }],
      every: "each",
      then: { do: "part", formula: "2 + steps(level(barbarian), 9, 16)" },
    });
    expect([5, 9, 16].map((l) => value(rule, classes("Barbarian", l)))).toEqual(["2", "3", "4"]);
  });

  test("FR-MOD-34 §8.7 Sacred Weapon: roll attack part max(1, cha)", () => {
    const rule = ok({
      on: "roll",
      requires: { preset: "pre-sacred-weapon" },
      when: [{ if: "roll", on: { roll: "attack", via: "weapon" } }],
      every: "each",
      then: { do: "part", formula: "max(1, cha)" },
    });
    expect(value(rule, { abilities: { cha: 0 } })).toBe("1");
    expect(value(rule, { abilities: { cha: 4 } })).toBe("4");
  });

  test("FR-MOD-34 §8.7 Booming Blade (ask): nothing below level 5", () => {
    const rule = ok({
      on: "hit",
      when: [{ if: "row", names: ["Booming Blade"] }],
      every: "each",
      then: { do: "damage", formula: "(steps(level, 5, 11, 17))d8", type: "thunder" },
    });
    expect(value(rule, { level: 4 })).toBeNull();
    expect(value(rule, { level: 5 })).toBe("1d8");
    expect(value(rule, { level: 17 })).toBe("3d8");
  });

  test("FR-MOD-34 §8.7 die size 1d(3 + 4) is invalid", () => {
    expect(
      issues(with_("hit", { then: { do: "damage", formula: "1d(3 + 4)", type: null } })),
    ).toEqual([{ path: "then.formula", message: "Die size 7 at 3" }]);
  });
});
