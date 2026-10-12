import { describe, expect, test } from "bun:test";
import {
  CharacterStatBlock,
  CR_VALUES,
  CreateEntityBody,
  DAMAGE_RE,
  definitionOrder,
  EntityName,
  effectiveStats,
  kindRegistry,
  MonsterStatBlock,
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
    expect(paths(MonsterStatBlock.safeParse({ ...goblin, speed: 30 }))).toEqual([""]);
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

  test("FR-ENT-01 bounds: ac 0–30, hpMax 1–999, initBonus −10…+20, toHit −10…+30, 0–1 attacks", () => {
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
    expect(ok({ attacks: [goblin.attacks[0], goblin.attacks[0]] })).toBe(false);
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

  test("FR-ENT-18 list sort: name ci, then custom before imported, then id", () => {
    const rows = [
      { id: "b", name: "goblin", campaignId: null },
      { id: "c", name: "Wolf", campaignId: "x" },
      { id: "z", name: "Goblin", campaignId: "x" },
      { id: "a", name: "Goblin", campaignId: "x" },
      { id: "m", name: "Elite Goblin Warrior", campaignId: "x" },
    ];
    expect([...rows].sort(definitionOrder).map((r) => r.id)).toEqual(["m", "a", "z", "b", "c"]);
  });
});
