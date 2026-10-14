// character-sheet-full core (CHARX §8.1, FR-CHARX-01–07): stat-block additions + derivation.
import { describe, expect, test } from "bun:test";
import {
  CharacterStatBlock,
  checkBonus,
  classTotals,
  concentrationSaveBonus,
  type HitDie,
  hitDice,
  isOverridden,
  MonsterStatBlock,
  OVERRIDE_KEYS,
  type OverrideKey,
  passiveScore,
  proficiencyBonus,
  SHEET_FULL_MESSAGE,
  SKILLS,
  STAT_BLOCK_MAX_BYTES,
  saveBonus,
  sheetValue,
  skillBonus,
  spellAttackBonus,
  spellSaveDc,
  withAttackIds,
  withClassTotals,
  withoutOverride,
} from "./schemas";

const abilities = { str: 14, dex: 16, con: 14, int: 10, wis: 12, cha: 8 };
const pc = {
  size: "medium",
  ac: 14,
  hpMax: 9,
  initBonus: 3,
  attacks: [{ name: "Dagger", toHit: 5, damage: "1d4+3", damageType: "piercing" }],
  abilities,
  level: 1,
  className: "Rogue",
} as const;
const goblin = {
  size: "small",
  ac: 15,
  hpMax: 7,
  initBonus: 2,
  attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2" }],
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  cr: "1/4",
} as const;

const char = (p: object = {}) => CharacterStatBlock.parse({ ...pc, ...p });
const okChar = (p: object) => CharacterStatBlock.safeParse({ ...pc, ...p }).success;
const okMon = (p: object) => MonsterStatBlock.safeParse({ ...goblin, ...p }).success;
const messages = (r: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  (r.error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`);

describe("CHARX stat block (§8.1)", () => {
  test("FR-CHARX-01 optional skills, overrides, spellcasting (both kinds); classes, species (character)", () => {
    const sheet = {
      skills: { stealth: "expertise", sleightOfHand: "proficient" },
      overrides: { "skill.stealth": { value: 8, note: "Test" }, spellDc: { value: 13 } },
      spellcasting: { ability: "wis", slots: { "1": 2, "9": 0 } },
    };
    expect(okChar(sheet)).toBe(true);
    expect(okMon(sheet)).toBe(true);
    expect(
      okChar({ classes: [{ name: "Rogue", level: 1, hitDie: "d8" }], species: "Halfling" }),
    ).toBe(true);
    expect(okMon({ classes: [{ name: "Rogue", level: 1, hitDie: "d8" }] })).toBe(false);
    expect(okMon({ species: "Goblin" })).toBe(false);
    // Additive: MVP blocks (no new field) stay valid.
    const { abilities: _a, ...bare } = pc;
    expect(okChar(bare)).toBe(true);
  });

  test("FR-CHARX-01 bounds: 18 skill keys, proficient | expertise; override keys + value −20…40, note ≤ 60", () => {
    expect(SKILLS).toHaveLength(18);
    expect(okChar({ skills: { stealth: "half" } })).toBe(false);
    expect(okChar({ skills: { sleight_of_hand: "proficient" } })).toBe(false);
    const o = (key: string, v: object) => okChar({ overrides: { [key]: v } });
    expect(o("skill.stealth", { value: -20 })).toBe(true);
    expect(o("skill.stealth", { value: 40, note: "x".repeat(60) })).toBe(true);
    expect(o("skill.stealth", { value: 41 })).toBe(false);
    expect(o("skill.stealth", { value: -21 })).toBe(false);
    expect(o("skill.stealth", { value: 1.5 })).toBe(false);
    expect(o("skill.stealth", { value: 1, note: "x".repeat(61) })).toBe(false);
    expect(o("skill.stealth", { value: 1, extra: 1 })).toBe(false);
    expect(o("ac", { value: 1 })).toBe(false);
    expect(o("passive.stealth", { value: 1 })).toBe(false);
    expect(OVERRIDE_KEYS).toHaveLength(1 + 6 + 6 + 18 + 3 + 2);
  });

  test("FR-CHARX-01 spellcasting: ability + slots 1–9 (int 0–9); skills and spellcasting need abilities", () => {
    const sc = (slots: object) => okChar({ spellcasting: { ability: "int", slots } });
    expect(sc({})).toBe(true);
    expect(sc({ "1": 4, "9": 1 })).toBe(true);
    expect(sc({ "0": 1 })).toBe(false);
    expect(sc({ "10": 1 })).toBe(false);
    expect(sc({ "1": 10 })).toBe(false);
    expect(okChar({ spellcasting: { ability: "luck", slots: {} } })).toBe(false);
    const { abilities: _a, ...bare } = pc;
    const r = CharacterStatBlock.safeParse({
      ...bare,
      skills: { stealth: "proficient" },
      spellcasting: { ability: "int", slots: {} },
    });
    expect(messages(r)).toEqual([
      "skills: Skills need ability scores",
      "spellcasting: Spellcasting needs ability scores",
    ]);
  });

  test("FR-CHARX-01 attacks: 0–20 rows, optional unique id", () => {
    const atk = pc.attacks[0];
    expect(okChar({ attacks: [{ ...atk, id: "a1" }, { ...atk, id: "a2" }, atk] })).toBe(true);
    expect(
      okChar({
        attacks: [
          { ...atk, id: "a1" },
          { ...atk, id: "a1" },
        ],
      }),
    ).toBe(false);
    expect(okChar({ attacks: [{ ...atk, id: "" }] })).toBe(false);
    expect(okChar({ attacks: Array.from({ length: 21 }, () => atk) })).toBe(false);
  });

  test("FR-CHARX-16 withAttackIds gives legacy rows ids, keeps existing ones, no-op when all set", () => {
    let n = 0;
    const next = () => `id-${++n}`;
    const s = char({ attacks: [pc.attacks[0], { ...pc.attacks[0], id: "keep" }] });
    const out = withAttackIds(s, next);
    expect(out.attacks.map((a) => a.id)).toEqual(["id-1", "keep"]);
    expect(withAttackIds(out, next)).toBe(out);
    expect(n).toBe(1);
  });

  test("FR-CHARX-03 serialized stat block ≤ 12 KB, else 'Sheet is full'", () => {
    // Max-length fields in a 3-byte script: the only way past 12 KB with valid fields.
    const note = "語".repeat(60);
    const big = Object.fromEntries(
      OVERRIDE_KEYS.map((k) => [k, { value: 1, note }] as const),
    ) as Record<OverrideKey, { value: number; note: string }>;
    const atk = { ...pc.attacks[0], name: "語".repeat(40) };
    const attacks = Array.from({ length: 20 }, (_, i) => ({ ...atk, id: "z".repeat(62) + i }));
    const r = CharacterStatBlock.safeParse({ ...pc, overrides: big, attacks });
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...pc, overrides: big, attacks }),
    ).length;
    expect(bytes).toBeGreaterThan(STAT_BLOCK_MAX_BYTES);
    expect(messages(r)).toEqual([`: ${SHEET_FULL_MESSAGE}`]);
    expect(CharacterStatBlock.safeParse({ ...pc, overrides: big }).success).toBe(true);
  });

  test("FR-CHARX-04 classes: 1–4 rows; Σ levels ≤ 20; names joined '/' ≤ 40; server writes level + className", () => {
    const row = (name: string, level: number, hitDie: HitDie = "d8") => ({ name, level, hitDie });
    expect(okChar({ classes: [] })).toBe(false);
    expect(okChar({ classes: [1, 2, 3, 4].map((i) => row(`C${i}`, 1)) })).toBe(true);
    expect(okChar({ classes: [1, 2, 3, 4, 5].map((i) => row(`C${i}`, 1)) })).toBe(false);
    expect(okChar({ classes: [row("Fighter", 0)] })).toBe(false);
    expect(okChar({ classes: [{ ...row("Fighter", 1), hitDie: "d20" }] })).toBe(false);
    expect(okChar({ classes: [{ ...row("Fighter", 1), subclass: "x".repeat(31) }] })).toBe(false);
    expect(okChar({ classes: [row("x".repeat(31), 1)] })).toBe(false);
    const over = CharacterStatBlock.safeParse({
      ...pc,
      classes: [row("Fighter", 15), row("Rogue", 6)],
    });
    expect(messages(over)).toEqual(["classes: Total level must be at most 20"]);
    const long = CharacterStatBlock.safeParse({
      ...pc,
      classes: [row("x".repeat(20), 1), row("y".repeat(20), 1)],
    });
    expect(messages(long)).toEqual(["classes: Class names together must be at most 40 characters"]);
    const multi = [row("Fighter", 3, "d10"), row("Rogue", 2)];
    expect(classTotals(multi)).toEqual({ level: 5, className: "Fighter/Rogue" });
    const s = withClassTotals(char({ classes: multi }));
    expect([s.level, s.className]).toEqual([5, "Fighter/Rogue"]);
    const legacy = char();
    expect(withClassTotals(legacy)).toBe(legacy);
  });
});

describe("CHARX derivation (FR-CHARX-05–07, ADR-0036)", () => {
  test("FR-CHARX-05 skill = mod + PB × {none 0, proficient 1, expertise 2}; null without scores", () => {
    const s = char({ level: 5, skills: { stealth: "expertise", athletics: "proficient" } });
    expect(proficiencyBonus(s)).toBe(3);
    expect(skillBonus(s, "stealth")).toBe(3 + 6);
    expect(skillBonus(s, "athletics")).toBe(2 + 3);
    expect(skillBonus(s, "arcana")).toBe(0);
    expect(skillBonus(s, "deception")).toBe(-1);
    const { abilities: _a, ...bare } = pc;
    expect(skillBonus(CharacterStatBlock.parse(bare), "stealth")).toBeNull();
    // Monsters use the same functions (CR table PB).
    const gob = MonsterStatBlock.parse({ ...goblin, skills: { stealth: "expertise" } });
    expect(skillBonus(gob, "stealth")).toBe(2 + 4);
  });

  test("FR-CHARX-05 passive = 10 + skill bonus; spell attack = PB + mod; DC = 8 + PB + mod", () => {
    const s = char({
      abilities: { ...abilities, wis: 16 },
      skills: { perception: "proficient", insight: "expertise" },
      spellcasting: { ability: "wis", slots: { "1": 2 } },
    });
    expect(passiveScore(s, "perception")).toBe(10 + 3 + 2);
    expect(passiveScore(s, "insight")).toBe(10 + 3 + 4);
    expect(passiveScore(s, "investigation")).toBe(10);
    expect(spellAttackBonus(s)).toBe(5);
    expect(spellSaveDc(s)).toBe(13);
    expect(spellAttackBonus(char())).toBeNull();
    expect(spellSaveDc(char())).toBeNull();
  });

  test("FR-CHARX-05 hit dice = Σ class levels per die size; none without classes", () => {
    const s = char({
      classes: [
        { name: "Fighter", level: 3, hitDie: "d10" },
        { name: "Paladin", level: 2, hitDie: "d10" },
        { name: "Rogue", level: 1, hitDie: "d8" },
      ],
    });
    expect(hitDice(s)).toEqual({ d10: 5, d8: 1 });
    expect(hitDice(char())).toEqual({});
  });

  test("FR-CHARX-06 every override key replaces its derived value; clearing returns to derived", () => {
    const s = char({ spellcasting: { ability: "int", slots: {} } });
    for (const key of OVERRIDE_KEYS) {
      const derived = sheetValue(s, key);
      expect({ key, derived: typeof derived }).toEqual({ key, derived: "number" });
      const o = { ...s, overrides: { [key]: { value: 33, note: "Bracers" } } };
      expect({ key, v: sheetValue(o, key) }).toEqual({ key, v: 33 });
      expect(isOverridden(o, key)).toBe(true);
      const cleared = withoutOverride(o, key);
      expect({ key, v: sheetValue(cleared, key) }).toEqual({ key, v: derived });
      expect(isOverridden(cleared, key)).toBe(false);
    }
  });

  test("FR-CHARX-06 a proficiency override feeds saves, skills, passives and spell numbers", () => {
    const s = char({
      saveProficiencies: ["dex"],
      skills: { stealth: "expertise", perception: "proficient" },
      spellcasting: { ability: "int", slots: {} },
      overrides: { proficiency: { value: 5 } },
    });
    expect(proficiencyBonus(s)).toBe(5);
    expect(saveBonus(s, "dex")).toBe(3 + 5);
    expect(saveBonus(s, "str")).toBe(2);
    expect(skillBonus(s, "stealth")).toBe(3 + 10);
    expect(passiveScore(s, "perception")).toBe(10 + 1 + 5);
    expect(spellAttackBonus(s)).toBe(5);
    expect(spellSaveDc(s)).toBe(13);
    expect(checkBonus(s, "dex")).toBe(3);
  });

  test("FR-CHARX-06 leaves: a skill override feeds its passive; a passive override wins; null without scores", () => {
    const s = char({
      skills: { perception: "proficient" },
      overrides: { "skill.perception": { value: 6 } },
    });
    expect(passiveScore(s, "perception")).toBe(16);
    const p = { ...s, overrides: { ...s.overrides, "passive.perception": { value: 14 } } };
    expect(passiveScore(p, "perception")).toBe(14);
    expect(skillBonus(p, "perception")).toBe(6);
    const { abilities: _a, ...bare } = pc;
    const noScores = CharacterStatBlock.parse({
      ...bare,
      overrides: { "check.dex": { value: 4 }, "save.con": { value: 4 } },
    });
    expect(checkBonus(noScores, "dex")).toBeNull();
    expect(saveBonus(noScores, "con")).toBeNull();
  });

  test("FR-CHARX-07 signatures unchanged; CBTX concentration save = saveBonus(stats, 'con'), save.con override wins", () => {
    const s = char({ saveProficiencies: ["con"] });
    expect(saveBonus(s, "con")).toBe(4);
    expect(concentrationSaveBonus(s)).toBe(4);
    const o = { ...s, overrides: { "save.con": { value: 9, note: "Ring of protection" } } };
    expect(saveBonus(o, "con")).toBe(9);
    expect(concentrationSaveBonus(o)).toBe(9);
    // Monsters: the ADR-0032 deviation is fixable by an override on a custom definition.
    const gob = MonsterStatBlock.parse({ ...goblin, overrides: { "save.dex": { value: 6 } } });
    expect(saveBonus(gob, "dex")).toBe(6);
  });
});
