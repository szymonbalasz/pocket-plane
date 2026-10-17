// CHARX §8.2 / §9 schemas, roll specs (FR-CHARX-21) and counters (FR-CHARX-17): unit level.
import { describe, expect, test } from "bun:test";
import { CharacterStatBlock, SHEET_FULL_MESSAGE } from "@shared/entities/schemas";
import { SHEET_EDIT_FIELDS } from "@shared/events/character-sheet";
import { clampCounters, counterOf, nextUsed, withUsed } from "./counters";
import { characterRolls } from "./logic";
import { SheetRollIntent } from "./schemas";
import {
  CharCreateIntent,
  CharEditIntent,
  CharEditSet,
  CharPutRowIntent,
  CharUseResourceIntent,
  CreatureSheetRecord,
  defaultSheetData,
  FeatureRow,
  ItemRow,
  ROW_LIMITS,
  SHEET_MAX_BYTES,
  SpellRow,
} from "./sheet";

const spell = (p: object = {}) => ({
  id: "s1",
  name: "Guiding Bolt",
  level: 1,
  roll: "attack",
  damage: "4d6",
  damageType: "radiant",
  ...p,
});
const record = (p: object = {}) => ({
  id: "e1",
  entityId: "e1",
  campaignId: "c1",
  ownerPlayerId: "p1",
  ...defaultSheetData(),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...p,
});
const fill = (n: number) => "x".repeat(n);

describe("CHARX §8.2 creature-sheet schema", () => {
  test("FR-CHARX-02 defaults: ready, unlocked, empty", () => {
    const r = CreatureSheetRecord.parse(record());
    expect(r).toMatchObject({ status: "ready", locked: false, spells: [], notes: "" });
  });

  test("FR-CHARX-03 bounds per field: texts, row fields, row limits, unique ids", () => {
    const ok = (p: object) => CreatureSheetRecord.safeParse(record(p)).success;
    expect(ok({ background: fill(40) })).toBe(true);
    expect(ok({ background: fill(41) })).toBe(false);
    expect(ok({ notes: fill(4000) })).toBe(true);
    expect(ok({ notes: fill(4001) })).toBe(false);
    expect(ok({ proficiencyNotes: { armor: fill(201) } })).toBe(false);
    expect(ok({ status: "approved" })).toBe(false);
    expect(ok({ extra: 1 })).toBe(false);
    const item = (i: number) => ({ id: `i${i}`, name: "Rope", qty: 1, equipped: false, notes: "" });
    expect(ok({ items: Array.from({ length: ROW_LIMITS.items }, (_, i) => item(i)) })).toBe(true);
    expect(ok({ items: Array.from({ length: ROW_LIMITS.items + 1 }, (_, i) => item(i)) })).toBe(
      false,
    );
    expect(ok({ items: [item(1), item(1)] })).toBe(false);
    expect(ItemRow.safeParse({ id: "i", name: "Rope", qty: 10_000 }).success).toBe(false);
    expect(ItemRow.safeParse({ id: "i", name: " ", qty: 1 }).success).toBe(false);
    expect(FeatureRow.safeParse({ id: "f", name: "Rage", text: fill(601) }).success).toBe(false);
    expect(FeatureRow.safeParse({ id: "f", name: "Rage", usesMax: 21 }).success).toBe(false);
    // FR-CHARX-58 (sprint 4): `used` up to `usesMax + 9` (uses left down to −9).
    expect(FeatureRow.safeParse({ id: "f", name: "Rage", usesMax: 2, used: 12 }).success).toBe(
      false,
    );
    expect(FeatureRow.safeParse({ id: "f", name: "Rage", used: 1 }).success).toBe(false);
    expect(ok({ slotsUsed: { "10": 1 } })).toBe(false);
    expect(ok({ hitDiceUsed: { d20: 1 } })).toBe(false);
  });

  test("FR-CHARX-03 a row over 48 KB → Sheet is full", () => {
    const feature = (i: number) => ({
      id: `f${i}`,
      name: fill(60),
      source: fill(40),
      text: fill(600),
    });
    const item = (i: number) => ({ id: `i${i}`, name: fill(60), qty: 1, notes: fill(120) });
    const big = record({
      spells: Array.from({ length: 40 }, (_, i) =>
        spell({ id: `s${i}`, name: fill(60), notes: fill(200) }),
      ),
      features: Array.from({ length: 30 }, (_, i) => feature(i)),
      items: Array.from({ length: 80 }, (_, i) => item(i)),
      notes: fill(4000),
    });
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(SHEET_MAX_BYTES);
    const p = CreatureSheetRecord.safeParse(big);
    expect(p.success).toBe(false);
    expect(p.error?.issues.map((i) => i.message)).toContain(SHEET_FULL_MESSAGE);
  });

  test("FR-CHARX-03 spells: saveAbility iff roll save; roll attack ⇒ effect damage; damage grammar", () => {
    expect(SpellRow.safeParse(spell()).success).toBe(true);
    expect(SpellRow.safeParse(spell({ roll: "save" })).success).toBe(false);
    expect(SpellRow.safeParse(spell({ roll: "save", saveAbility: "dex" })).success).toBe(true);
    expect(SpellRow.safeParse(spell({ saveAbility: "dex" })).success).toBe(false);
    expect(SpellRow.safeParse(spell({ effect: "healing" })).success).toBe(false);
    expect(SpellRow.safeParse(spell({ roll: "none", effect: "healing" })).success).toBe(true);
    expect(SpellRow.safeParse(spell({ damage: "4d6 + 1d8" })).success).toBe(false);
    expect(SpellRow.safeParse(spell({ level: 10 })).success).toBe(false);
  });
});

describe("CHARX §9 intents", () => {
  test("FR-CHARX-15 char.edit set keys = SHEET_EDIT_FIELDS; strict; non-empty; null clears optional only", () => {
    expect(Object.keys(CharEditSet.shape).sort()).toEqual([...SHEET_EDIT_FIELDS].sort());
    const ok = (set: object) => CharEditIntent.safeParse({ creatureId: "c", set }).success;
    expect(ok({ ac: 15 })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ statBlock: {} })).toBe(false);
    expect(ok({ hpCurrent: 3 })).toBe(false);
    expect(ok({ species: null, speed: null, skills: null })).toBe(true);
    expect(ok({ ac: null })).toBe(false);
    expect(ok({ hpMax: 0 })).toBe(false);
    expect(ok({ classes: [] })).toBe(false);
    expect(ok({ overrides: { "skill.stealth": { value: 41 } } })).toBe(false);
    expect(ok({ overrides: { "skill.flying": { value: 4 } } })).toBe(false);
  });

  test("FR-CHARX-08 char.create: name per FR-ENT-08; strict", () => {
    expect(CharCreateIntent.safeParse({ name: "  Brin " }).data?.name).toBe("Brin");
    expect(CharCreateIntent.safeParse({ name: "" }).success).toBe(false);
    expect(CharCreateIntent.safeParse({ name: "Brin", statBlock: {} }).success).toBe(false);
  });

  test("FR-CHARX-16 char.putRow: row schema per list; feature used accepted", () => {
    const ok = (list: string, row: object) =>
      CharPutRowIntent.safeParse({ creatureId: "c", list, row }).success;
    expect(ok("attacks", { name: "Dagger", toHit: 5, damage: "1d4+3" })).toBe(true);
    expect(ok("attacks", { name: "Dagger", toHit: 5 })).toBe(false);
    expect(ok("spells", { name: "Shield", level: 1 })).toBe(true);
    expect(ok("spells", { name: "Shield", level: 1, roll: "save" })).toBe(false);
    expect(ok("features", { name: "Rage", usesMax: 2, used: 1 })).toBe(true);
    expect(ok("items", { name: "Rope", qty: 1 })).toBe(true);
    expect(ok("items", { name: "Rope", weight: 1 })).toBe(false);
    expect(ok("notes", { name: "x" })).toBe(false);
  });

  test("FR-CHARX-17 char.useResource: exactly one of delta / reset; delta −9…9 ≠ 0", () => {
    const ok = (p: object) =>
      CharUseResourceIntent.safeParse({ characterId: "c", resource: { slot: 1 }, ...p }).success;
    expect(ok({ delta: 1 })).toBe(true);
    expect(ok({ reset: true })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ delta: 1, reset: true })).toBe(false);
    expect(ok({ delta: 0 })).toBe(false);
    expect(ok({ delta: 10 })).toBe(false);
    expect(ok({ reset: false })).toBe(false);
    const res = (resource: object) =>
      CharUseResourceIntent.safeParse({ characterId: "c", resource, delta: 1 }).success;
    expect(res({ slot: 10 })).toBe(false);
    expect(res({ hitDie: "d20" })).toBe(false);
    expect(res({ feature: "f1" })).toBe(true);
  });

  test("FR-CHARX-20 char.roll: kind + ref combinations", () => {
    const ok = (p: object) => SheetRollIntent.safeParse({ characterId: "c", ...p }).success;
    expect(ok({ kind: "skill", skill: "stealth" })).toBe(true);
    expect(ok({ kind: "skill" })).toBe(false);
    expect(ok({ kind: "check", ability: "dex", skill: "stealth" })).toBe(false);
    expect(ok({ kind: "attack" })).toBe(true);
    expect(ok({ kind: "damage", attackId: "a1" })).toBe(true);
    expect(ok({ kind: "initiative", attackId: "a1" })).toBe(false);
    expect(ok({ kind: "spellAttack", spellId: "s1" })).toBe(true);
    expect(ok({ kind: "spellAttack" })).toBe(false);
    expect(ok({ kind: "spellDamage", spellId: "s1", attackId: "a1" })).toBe(false);
    expect(ok({ kind: "attack", spellId: "s1" })).toBe(false);
    const m = { diceTotal: 4 };
    expect(ok({ kind: "skill", skill: "stealth", manual: [m] })).toBe(true);
    // FR-CHARX-55: damage 1 + n, attack 2 + n (n ≤ 2 extra parts), exact count at commit.
    expect(ok({ kind: "damage", manual: [m, m] })).toBe(true);
    expect(ok({ kind: "damage", manual: [m, m, m, m] })).toBe(false);
    expect(ok({ kind: "attack", manual: [m] })).toBe(false);
    expect(ok({ kind: "attack", manual: [m, m, m, m] })).toBe(true);
    expect(ok({ kind: "toHit", manual: [m, m] })).toBe(false);
    // spellAttack: 1 or 2, checked against the spell at commit.
    expect(ok({ kind: "spellAttack", spellId: "s1", manual: [m, m] })).toBe(true);
  });
});

// Brin (CHARX §13 E2E): Rogue 1, DEX 16, Stealth expertise.
const brin = CharacterStatBlock.parse({
  size: "medium",
  ac: 14,
  hpMax: 9,
  initBonus: 3,
  attacks: [
    { id: "a1", name: "Dagger", toHit: 5, damage: "1d4+3", damageType: "piercing" },
    { id: "a2", name: "Shortbow", toHit: 5, damage: "1d6+3" },
  ],
  abilities: { str: 8, dex: 16, con: 12, int: 10, wis: 16, cha: 10 },
  skills: { stealth: "expertise", perception: "proficient" },
  spellcasting: { ability: "wis", slots: { "1": 2 } },
  level: 1,
  className: "Rogue",
});
const sheet = {
  spells: [
    SpellRow.parse(spell({ id: "gb" })),
    SpellRow.parse(
      spell({
        id: "sf",
        name: "Sacred Flame",
        level: 0,
        roll: "save",
        saveAbility: "dex",
        damage: "1d8",
      }),
    ),
    SpellRow.parse({ id: "cw", name: "Cure Wounds", level: 1, damage: "1d8+3", effect: "healing" }),
    SpellRow.parse({ id: "sh", name: "Shield", level: 1 }),
  ],
};
const specs = (kind: Parameters<typeof characterRolls>[2], ref: object, stats = brin) => {
  const r = characterRolls(stats, sheet, kind, ref);
  return r.ok ? r.specs.map((s) => [s.expression, s.category, s.label, s.d20]) : r;
};

describe("FR-CHARX-21 characterRolls(stats, sheet, kind, ref)", () => {
  test("FR-CHARX-21 skill: d20 + skill bonus, skill-check, 'Stealth check'; override wins", () => {
    expect(specs("skill", { skill: "stealth" })).toEqual([
      ["1d20+7", "skill-check", "Stealth check", true],
    ]);
    expect(specs("skill", { skill: "athletics" })).toEqual([
      ["1d20-1", "skill-check", "Athletics check", true],
    ]);
    const o = { ...brin, overrides: { "skill.stealth": { value: 8 } } };
    expect(specs("skill", { skill: "stealth" }, o)).toEqual([
      ["1d20+8", "skill-check", "Stealth check", true],
    ]);
    const { abilities: _a, skills: _s, spellcasting: _c, ...bare } = brin;
    expect(characterRolls(bare, sheet, "skill", { skill: "stealth" })).toEqual({
      ok: false,
      code: "conflict",
      message: "No ability scores",
    });
  });

  test("FR-CHARX-20 attack / damage: attackId picks the row; absent = the first; unknown → not_found", () => {
    expect(specs("attack", {})).toEqual([
      ["1d20+5", "attack", "Dagger attack", true],
      ["1d4+3", "damage", "Dagger damage (piercing)", false],
    ]);
    expect(specs("attack", { attackId: "a2" })).toEqual([
      ["1d20+5", "attack", "Shortbow attack", true],
      ["1d6+3", "damage", "Shortbow damage", false],
    ]);
    expect(specs("damage", { attackId: "a1" })).toEqual([
      ["1d4+3", "damage", "Dagger damage (piercing)", false],
    ]);
    expect(specs("damage", { attackId: "gone" })).toMatchObject({ ok: false, code: "not_found" });
    expect(specs("attack", {}, { ...brin, attacks: [] })).toMatchObject({
      ok: false,
      code: "conflict",
      message: "No weapon attack",
    });
  });

  test("FR-CHARX-21 spellAttack: d20 + spell attack (+ damage, one entry); no attack roll → conflict", () => {
    expect(specs("spellAttack", { spellId: "gb" })).toEqual([
      ["1d20+5", "attack", "Guiding Bolt attack", true],
      ["4d6", "damage", "Guiding Bolt damage (radiant)", false],
    ]);
    expect(
      specs(
        "spellAttack",
        { spellId: "gb" },
        { ...brin, overrides: { spellAttack: { value: 9 } } },
      ),
    ).toEqual([
      ["1d20+9", "attack", "Guiding Bolt attack", true],
      ["4d6", "damage", "Guiding Bolt damage (radiant)", false],
    ]);
    expect(specs("spellAttack", { spellId: "sh" })).toEqual({
      ok: false,
      code: "conflict",
      message: "No attack roll for Shield",
    });
    expect(specs("spellAttack", { spellId: "nope" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    const noDamage = {
      spells: [SpellRow.parse({ id: "x", name: "Ray", level: 1, roll: "attack" })],
    };
    const r = characterRolls(brin, noDamage, "spellAttack", { spellId: "x" });
    expect(r.ok && r.specs.map((s) => s.label)).toEqual(["Ray attack"]);
  });

  test("FR-CHARX-21 spellDamage: damage / healing only; DC appended iff roll save", () => {
    expect(specs("spellDamage", { spellId: "sf" })).toEqual([
      ["1d8", "damage", "Sacred Flame damage (radiant), DC 13 DEX", false],
    ]);
    expect(specs("spellDamage", { spellId: "cw" })).toEqual([
      ["1d8+3", "healing", "Cure Wounds healing", false],
    ]);
    expect(specs("spellDamage", { spellId: "gb" })).toEqual([
      ["4d6", "damage", "Guiding Bolt damage (radiant)", false],
    ]);
    expect(specs("spellDamage", { spellId: "sh" })).toEqual({
      ok: false,
      code: "conflict",
      message: "No damage roll for Shield",
    });
  });

  test("FR-CHARX-42 toHit specs: d20 + to-hit only, category attack, labels; spellToHit needs roll attack", () => {
    expect(specs("toHit", {})).toEqual([["1d20+5", "attack", "Dagger attack", true]]);
    expect(specs("toHit", { attackId: "a2" })).toEqual([
      ["1d20+5", "attack", "Shortbow attack", true],
    ]);
    expect(specs("toHit", { attackId: "gone" })).toMatchObject({ ok: false, code: "not_found" });
    expect(specs("toHit", {}, { ...brin, attacks: [] })).toMatchObject({
      ok: false,
      code: "conflict",
      message: "No weapon attack",
    });
    // Guiding Bolt has damage: spellToHit still rolls the d20 alone (spellAttack keeps both).
    expect(specs("spellToHit", { spellId: "gb" })).toEqual([
      ["1d20+5", "attack", "Guiding Bolt attack", true],
    ]);
    expect(specs("spellToHit", { spellId: "sf" })).toEqual({
      ok: false,
      code: "conflict",
      message: "No attack roll for Sacred Flame",
    });
    expect(specs("spellToHit", { spellId: "nope" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    // Unchanged meaning: attack / spellAttack = to-hit + damage (FR-CHARX-42, S1).
    expect(specs("attack", { attackId: "a1" })).toHaveLength(2);
    expect(specs("spellAttack", { spellId: "gb" })).toHaveLength(2);
  });

  test("FR-CHARX-42 toHit intent: manual 1; attackId only on toHit, spellId required on spellToHit", () => {
    const ok = (p: object) => SheetRollIntent.safeParse({ characterId: "c", ...p }).success;
    const m = { diceTotal: 14 };
    expect(ok({ kind: "toHit" })).toBe(true);
    expect(ok({ kind: "toHit", attackId: "a1", manual: [m] })).toBe(true);
    expect(ok({ kind: "toHit", manual: [m, m] })).toBe(false);
    expect(ok({ kind: "toHit", spellId: "s1" })).toBe(false);
    expect(ok({ kind: "spellToHit", spellId: "s1", manual: [m] })).toBe(true);
    expect(ok({ kind: "spellToHit", spellId: "s1", manual: [m, m] })).toBe(false);
    expect(ok({ kind: "spellToHit" })).toBe(false);
    expect(ok({ kind: "spellToHit", spellId: "s1", attackId: "a1" })).toBe(false);
  });

  test("FR-CHARX-07 MVP signature unchanged: characterRolls(stats, kind[, ability])", () => {
    expect(characterRolls(brin, "initiative")?.[0]?.expression).toBe("1d20+3");
    expect(characterRolls(brin, "save", "dex")?.[0]?.label).toBe("Dexterity save");
    expect(characterRolls({ ...brin, attacks: [] }, "attack")).toBeNull();
  });
});

describe("FR-CHARX-17 counters", () => {
  const stats = {
    spellcasting: { ability: "wis" as const, slots: { "1": 2, "2": 1 } },
    classes: [
      { name: "Fighter", level: 3, hitDie: "d10" as const },
      { name: "Wizard", level: 2, hitDie: "d6" as const },
    ],
  };
  const s = {
    slotsUsed: { "1": 2, "2": 1 },
    hitDiceUsed: { d10: 3, d6: 2 },
    features: [FeatureRow.parse({ id: "f", name: "Rage", usesMax: 2, used: 1 })],
  };

  test("FR-CHARX-17 counterOf + nextUsed: clamp 0…max, reset → 0, unknown feature → null", () => {
    expect(counterOf(s, stats, { slot: 1 })).toEqual({ used: 2, max: 2 });
    expect(counterOf(s, stats, { slot: 3 })).toEqual({ used: 0, max: 0 });
    expect(counterOf(s, stats, { hitDie: "d10" })).toEqual({ used: 3, max: 3 });
    expect(counterOf(s, stats, { feature: "f" })).toEqual({ used: 1, max: 2 });
    expect(counterOf(s, stats, { feature: "x" })).toBeNull();
    expect(nextUsed(1, 2, { delta: 5 })).toBe(2);
    expect(nextUsed(1, 2, { delta: -5 })).toBe(0);
    expect(nextUsed(2, 2, { reset: true })).toBe(0);
    expect(withUsed(s, { slot: 1 }, 0).slotsUsed).toEqual({ "2": 1 });
    expect(withUsed(s, { feature: "f" }, 2).features[0]?.used).toBe(2);
  });

  test("FR-CHARX-17 lowering a maximum clamps used", () => {
    const lowered = {
      spellcasting: { ability: "wis" as const, slots: { "1": 1 } },
      classes: [{ name: "Fighter", level: 2, hitDie: "d10" as const }],
    };
    expect(clampCounters(s, lowered)).toEqual({ slotsUsed: { "1": 1 }, hitDiceUsed: { d10: 2 } });
    expect(clampCounters(s, {})).toEqual({ slotsUsed: {}, hitDiceUsed: {} });
  });
});
