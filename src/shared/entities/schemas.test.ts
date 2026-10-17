import { describe, expect, test } from "bun:test";
import {
  abilityMod,
  CharacterStatBlock,
  CR_VALUES,
  CREATURE_TYPES,
  CreateEntityBody,
  checkBonus,
  creatureTypeOf,
  DAMAGE_RE,
  definitionOrder,
  EntityName,
  effectiveStats,
  kindRegistry,
  MonsterStatBlock,
  proficiencyBonus,
  saveBonus,
  TokenShape,
  UpdateEntityBody,
  XP_BY_CR,
  xpForCr,
} from "./schemas";

const goblin = {
  size: "small",
  ac: 15,
  hpMax: 7,
  initBonus: 2,
  attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
  cr: "1/4",
};
const mira = {
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 2,
  attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" }],
  level: 1,
  className: "Fighter",
};

const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (r.error?.issues ?? []).map((i) => i.path.join("."));

describe("entities schemas", () => {
  test("FR-ENT-01 kind registry: character + monster, strict (unknown key → field path)", () => {
    expect(Object.keys(kindRegistry).sort()).toEqual(["character", "monster"]);
    expect(MonsterStatBlock.safeParse(goblin).success).toBe(true);
    expect(CharacterStatBlock.safeParse(mira).success).toBe(true);
    expect(paths(MonsterStatBlock.safeParse({ ...goblin, fly: 30 }))).toEqual([""]);
    const bad = MonsterStatBlock.safeParse({
      ...goblin,
      attacks: [{ ...goblin.attacks[0], x: 1 }],
    });
    expect(paths(bad)).toEqual(["attacks.0"]);
    const unknownKind = CreateEntityBody.safeParse({ kind: "npc", name: "X", statBlock: goblin });
    expect(unknownKind.success).toBe(false);
    expect(paths(unknownKind)).toContain("kind");
  });

  test("FR-ENT-02 shared creature core; monster adds cr, character adds level + className", () => {
    expect(MonsterStatBlock.safeParse({ ...goblin, level: 1 }).success).toBe(false);
    expect(CharacterStatBlock.safeParse({ ...mira, cr: "1" }).success).toBe(false);
    const { cr: _cr, ...core } = goblin;
    expect(CharacterStatBlock.safeParse({ ...core, level: 1, className: "" }).success).toBe(true);
  });

  test("FR-ENT-01 bounds: ac 0–30, hpMax 1–999, initBonus −10…+20, toHit −10…+30, 0–20 attacks (FR-CHARX-01)", () => {
    const ok = (p: object) => MonsterStatBlock.safeParse({ ...goblin, ...p }).success;
    expect(ok({ ac: 0 })).toBe(true);
    expect(ok({ ac: 31 })).toBe(false);
    expect(ok({ hpMax: 0 })).toBe(false);
    expect(ok({ hpMax: 999 })).toBe(true);
    expect(ok({ hpMax: 1000 })).toBe(false);
    expect(ok({ initBonus: -10 })).toBe(true);
    expect(ok({ initBonus: 21 })).toBe(false);
    expect(ok({ ac: 1.5 })).toBe(false);
    expect(ok({ attacks: [] })).toBe(true);
    expect(ok({ attacks: [goblin.attacks[0], goblin.attacks[0]] })).toBe(true);
    expect(ok({ attacks: Array.from({ length: 20 }, () => goblin.attacks[0]) })).toBe(true);
    expect(ok({ attacks: Array.from({ length: 21 }, () => goblin.attacks[0]) })).toBe(false);
    const atk = (p: object) => ok({ attacks: [{ ...goblin.attacks[0], ...p }] });
    expect(atk({ toHit: 30 })).toBe(true);
    expect(atk({ toHit: 31 })).toBe(false);
    expect(atk({ name: "" })).toBe(false);
    expect(atk({ name: "x".repeat(41) })).toBe(false);
    expect(atk({ damageType: "sonic" })).toBe(false);
    expect(atk({ damageType: undefined })).toBe(true);
    expect(CharacterStatBlock.safeParse({ ...mira, level: 21 }).success).toBe(false);
    expect(CharacterStatBlock.safeParse({ ...mira, className: "x".repeat(41) }).success).toBe(
      false,
    );
  });

  test("FR-ENT-01 dice grammar: NdM, +K, −K, bounds", () => {
    for (const d of ["1d4", "1d6+2", "1d4-1", "20d100+30", "2d4+2", "1d20-0"]) {
      expect(DAMAGE_RE.test(d)).toBe(true);
    }
    for (const d of ["0d6", "21d6", "1d7", "1d6+31", "d6", "1d6 + 2", "1d6+-2", "2x4", "1d6−1"]) {
      expect(DAMAGE_RE.test(d)).toBe(false);
    }
  });

  test("FR-ENT-01 CR enum: 0, 1/8, 1/4, 1/2, 1…30", () => {
    expect(CR_VALUES).toHaveLength(34);
    expect(MonsterStatBlock.safeParse({ ...goblin, cr: "1/3" }).success).toBe(false);
    expect(MonsterStatBlock.safeParse({ ...goblin, cr: "31" }).success).toBe(false);
    expect(MonsterStatBlock.safeParse({ ...goblin, cr: 1 }).success).toBe(false);
  });

  test("FR-ENT-03 XP from CR by the SRD table; CR 0 → 10", () => {
    expect(xpForCr("0")).toBe(10);
    expect(xpForCr("1/4")).toBe(50);
    expect(xpForCr("1/2")).toBe(100);
    expect(xpForCr("5")).toBe(1800);
    expect(xpForCr("30")).toBe(155000);
    expect(CR_VALUES.every((c) => XP_BY_CR[c] !== undefined)).toBe(true);
  });

  test("FR-ENT-08 name: trimmed, 1–60, no control chars", () => {
    expect(EntityName.parse("  Goblin ")).toBe("Goblin");
    expect(EntityName.safeParse("   ").success).toBe(false);
    expect(EntityName.safeParse("x".repeat(60)).success).toBe(true);
    expect(EntityName.safeParse("x".repeat(61)).success).toBe(false);
    expect(EntityName.safeParse("Gob\u0007lin").success).toBe(false);
  });

  test("FR-ENT-04 no request field sets campaign or provenance (strict bodies)", () => {
    const base = { kind: "monster", name: "Boss", statBlock: goblin };
    expect(CreateEntityBody.safeParse(base).success).toBe(true);
    for (const extra of [{ campaignId: "c" }, { source: "srd" }, { hpCurrent: 3 }]) {
      expect(CreateEntityBody.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(CreateEntityBody.safeParse({ ...base, ownerPlayerId: "p" }).success).toBe(false);
    expect(
      CreateEntityBody.safeParse({ kind: "character", name: "Mira", statBlock: mira }).success,
    ).toBe(false);
    expect(
      UpdateEntityBody.safeParse({ name: "X", statBlock: goblin, kind: "character" }).success,
    ).toBe(false);
  });

  test("FR-ENT-13 effectiveStats returns the definition's stat block", () => {
    const def = { statBlock: MonsterStatBlock.parse(goblin) };
    expect(effectiveStats(def, { id: "token-1" })).toBe(def.statBlock);
  });

  test("FR-ENT-18 order: name ci, then custom, then imported by source rank (srd-5.1 before fixture), then id", () => {
    const rows = [
      { id: "b", name: "goblin", campaignId: null, source: "fixture" },
      { id: "c", name: "Wolf", campaignId: "x" },
      { id: "z", name: "Goblin", campaignId: "x" },
      { id: "a", name: "Goblin", campaignId: "x" },
      { id: "m", name: "Elite Goblin Warrior", campaignId: "x" },
      { id: "s", name: "Goblin", campaignId: null, source: "srd-5.1" },
      { id: "o", name: "Goblin", campaignId: null, source: "open5e-x" },
      { id: "f", name: "Goblin", campaignId: null, source: "fixture" },
    ];
    expect([...rows].sort(definitionOrder).map((r) => r.id)).toEqual([
      "m",
      "a",
      "z",
      "s",
      "o",
      "b",
      "f",
      "c",
    ]);
  });

  test("FR-ENT-21 optional speed: int 0–200, multiple of 5, both kinds", () => {
    const ok = (p: object) => MonsterStatBlock.safeParse({ ...goblin, ...p }).success;
    expect(ok({ speed: 30 })).toBe(true);
    expect(ok({ speed: 0 })).toBe(true);
    expect(ok({ speed: 200 })).toBe(true);
    expect(ok({ speed: 35 })).toBe(true);
    expect(ok({ speed: 33 })).toBe(false);
    expect(ok({})).toBe(true);
    expect(ok({ speed: 205 })).toBe(false);
    expect(ok({ speed: 32 })).toBe(false);
    expect(ok({ speed: -5 })).toBe(false);
    expect(CharacterStatBlock.safeParse({ ...mira, speed: 25 }).success).toBe(true);
  });

  test("FR-ENT-22 token shape: round | square | none", () => {
    for (const v of ["round", "square", "none"]) expect(TokenShape.safeParse(v).success).toBe(true);
    expect(TokenShape.safeParse("hex").success).toBe(false);
    // REST bodies: optional, nullable; anything else → invalid.
    const body = { kind: "monster", name: "G", statBlock: goblin };
    for (const tokenShape of [undefined, null, "square"]) {
      expect(CreateEntityBody.safeParse({ ...body, tokenShape }).success).toBe(true);
    }
    expect(CreateEntityBody.safeParse({ ...body, tokenShape: "hex" }).success).toBe(false);
    const put = { name: "G", statBlock: goblin };
    expect(UpdateEntityBody.safeParse({ ...put, tokenShape: "none" }).success).toBe(true);
    expect(UpdateEntityBody.safeParse({ ...put, tokenShape: "hex" }).success).toBe(false);
  });

  test("FR-ENT-26 type: the 14 SRD types on monsters only; absent parses", () => {
    expect(CREATURE_TYPES).toHaveLength(14);
    for (const type of CREATURE_TYPES) {
      expect(MonsterStatBlock.safeParse({ ...goblin, type }).success).toBe(true);
    }
    expect(MonsterStatBlock.safeParse(goblin).success).toBe(true);
    for (const type of ["swarm", "Humanoid", ""]) {
      expect(paths(MonsterStatBlock.safeParse({ ...goblin, type }))).toEqual(["type"]);
    }
    // Characters have none (strict block): `invalid`.
    expect(CharacterStatBlock.safeParse({ ...mira, type: "humanoid" }).success).toBe(false);
    const body = { kind: "monster", name: "G", statBlock: { ...goblin, type: "Humanoid" } };
    expect(paths(CreateEntityBody.safeParse(body))).toEqual(["statBlock.type"]);
    const typed = MonsterStatBlock.parse({ ...goblin, type: "humanoid" });
    expect(creatureTypeOf({ kind: "monster", statBlock: typed })).toBe("humanoid");
    expect(creatureTypeOf({ kind: "monster", statBlock: MonsterStatBlock.parse(goblin) })).toBe(
      null,
    );
    expect(creatureTypeOf({ kind: "character" })).toBe(null);
  });

  test("FR-ENT-23 abilities all six (1–30), save proficiencies unique and need abilities", () => {
    const abilities = { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 };
    const ok = (p: object) => MonsterStatBlock.safeParse({ ...goblin, ...p }).success;
    expect(ok({ abilities })).toBe(true);
    expect(ok({ abilities, saveProficiencies: ["dex", "wis"] })).toBe(true);
    expect(ok({ abilities, saveProficiencies: [] })).toBe(true);
    expect(ok({ abilities: { ...abilities, cha: undefined } })).toBe(false);
    expect(ok({ abilities: { ...abilities, str: 0 } })).toBe(false);
    expect(ok({ abilities: { ...abilities, str: 31 } })).toBe(false);
    expect(ok({ abilities: { ...abilities, luck: 10 } })).toBe(false);
    expect(ok({ abilities, saveProficiencies: ["dex", "dex"] })).toBe(false);
    expect(ok({ abilities, saveProficiencies: ["per"] })).toBe(false);
    const noScores = MonsterStatBlock.safeParse({ ...goblin, saveProficiencies: ["dex"] });
    expect(paths(noScores)).toEqual(["saveProficiencies"]);
    expect(CharacterStatBlock.safeParse({ ...mira, saveProficiencies: ["str"] }).success).toBe(
      false,
    );
  });

  test("FR-ENT-24 abilityMod = floor((score − 10) / 2)", () => {
    const cases: [number, number][] = [
      [1, -5],
      [8, -1],
      [9, -1],
      [10, 0],
      [11, 0],
      [12, 1],
      [15, 2],
      [20, 5],
      [30, 10],
    ];
    for (const [score, mod] of cases) expect(abilityMod(score)).toBe(mod);
  });

  test("FR-ENT-24 proficiencyBonus: level for characters, SRD CR table for monsters", () => {
    const pc = (level: number) => proficiencyBonus({ ...mira, level });
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(pc)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    const cr = (c: string) => proficiencyBonus({ ...goblin, cr: c });
    expect(["0", "1/8", "1/4", "1/2", "1", "4"].map(cr)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(["5", "8", "9", "12", "13", "16", "17", "20"].map(cr)).toEqual([3, 3, 4, 4, 5, 5, 6, 6]);
    expect(["21", "24", "25", "28", "29", "30"].map(cr)).toEqual([7, 7, 8, 8, 9, 9]);
  });

  test("FR-ENT-24 checkBonus = mod; saveBonus = mod + PB if proficient; null without scores", () => {
    const abilities = { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 };
    const gob = MonsterStatBlock.parse({ ...goblin, abilities });
    expect(checkBonus(gob, "dex")).toBe(2);
    expect(checkBonus(gob, "str")).toBe(-1);
    expect(saveBonus(gob, "dex")).toBe(2);
    const elite = MonsterStatBlock.parse({
      ...goblin,
      cr: "1",
      abilities,
      saveProficiencies: ["dex"],
    });
    expect(saveBonus(elite, "dex")).toBe(4);
    expect(saveBonus(elite, "wis")).toBe(-1);
    expect(checkBonus(elite, "dex")).toBe(2);
    const pc = CharacterStatBlock.parse({
      ...mira,
      level: 5,
      abilities: { ...abilities, str: 16 },
      saveProficiencies: ["str", "con"],
    });
    expect(saveBonus(pc, "str")).toBe(6);
    expect(saveBonus(pc, "con")).toBe(3);
    expect(saveBonus(pc, "dex")).toBe(2);
    const bare = MonsterStatBlock.parse(goblin);
    expect(checkBonus(bare, "dex")).toBeNull();
    expect(saveBonus(bare, "dex")).toBeNull();
  });
});
