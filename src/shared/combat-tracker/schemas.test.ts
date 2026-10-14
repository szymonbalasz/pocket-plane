import { describe, expect, test } from "bun:test";
import {
  ApplyCardTargetsInput,
  CombatantRecord,
  DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  DamageCardResolutionRead,
  DamageCardTargetsResolution,
  HpChangeRecord,
  HpChangesResult,
  PlayerMonsterCombatant,
  PlayerPcCombatant,
  PlayerRemovedCombatant,
  RollAbilityInput,
  TurnResult,
  UndoResult,
} from "./schemas";

const outcome = (n: number, nameLength = 40) => ({
  targetName: `Goblin ${n}`.padEnd(nameLength, "x"),
  hit: true,
  multiplier: "half" as const,
  applied: 999,
});

describe("combat-tracker schemas (feedback pass)", () => {
  test("FR-CBT-34 applyCard targets[]: 1–20, unique, per-target hit + multiplier", () => {
    const t = (targetId: string) => ({ targetId, hit: true, multiplier: "normal" });
    const base = { cardId: "card", toHitTotal: 17, damageTotal: 6 };
    const ok = (v: object) => ApplyCardTargetsInput.safeParse({ ...base, ...v }).success;
    expect(ok({ targets: [t("a")] })).toBe(true);
    expect(ok({ targets: [t("a"), { ...t("b"), hit: false, multiplier: "none" }] })).toBe(true);
    expect(ok({ targets: Array.from({ length: 20 }, (_, i) => t(`k${i}`)) })).toBe(true);
    expect(ok({ targets: Array.from({ length: 21 }, (_, i) => t(`k${i}`)) })).toBe(false);
    expect(ok({ targets: [] })).toBe(false);
    expect(ok({ targets: [t("a"), t("a")] })).toBe(false);
    expect(ok({ targets: [t("a")], targetId: "a" })).toBe(false);
    expect(ok({ targets: [{ ...t("a"), multiplier: "triple" }] })).toBe(false);
    // The old single-target shape is gone (protocol §28 shim switched).
    const legacy = { ...base, targetId: "a", hit: true, multiplier: "normal" };
    expect(ApplyCardTargetsInput.safeParse(legacy).success).toBe(false);
    expect(HpChangesResult.safeParse({ hpChangeIds: ["h1", "h2"] }).success).toBe(true);
    expect(HpChangesResult.safeParse({ hpChangeIds: [] }).success).toBe(false);
  });

  test("FR-CBT-42 damage-card resolution {targets}; legacy single target read as one part", () => {
    const multi = { targets: [outcome(1), { ...outcome(2), hit: false, applied: 0 }] };
    expect(DamageCardTargetsResolution.safeParse(multi).success).toBe(true);
    expect(DamageCardTargetsResolution.safeParse({ targets: [] }).success).toBe(false);
    expect(DamageCardResolutionRead.parse(multi)).toEqual(multi);
    const legacy = { targetName: null, hit: true, multiplier: "normal" as const, applied: 6 };
    expect(DamageCardTargetsResolution.safeParse(legacy).success).toBe(false);
    expect(DamageCardResolutionRead.parse(legacy)).toEqual({ targets: [legacy] });
    expect(DamageCardResolutionRead.safeParse({ ...legacy, targetId: "k" }).success).toBe(false);
  });

  // #157: 8 KB covers the worst case: 20 targets × 40-code-point names (combatant name max),
  // 4 UTF-8 bytes each.
  test("OQ-CBT-39: 20 targets need more than 256 B; worst case fits the 8 KB damage-card cap", () => {
    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    const twenty = { targets: Array.from({ length: 20 }, (_, i) => outcome(i, 16)) };
    expect(bytes(DamageCardTargetsResolution.parse(twenty))).toBeGreaterThan(256);
    const worst = {
      targets: Array.from({ length: 20 }, () => ({ ...outcome(0), targetName: "𝔊".repeat(40) })),
    };
    expect(DAMAGE_CARD_RESOLUTION_MAX_BYTES).toBe(8192);
    expect(bytes(DamageCardTargetsResolution.parse(worst))).toBeLessThanOrEqual(
      DAMAGE_CARD_RESOLUTION_MAX_BYTES,
    );
  });

  test("FR-CBT-44 cbt.rollAbility: check | save + ability; no bonus field", () => {
    const ok = (v: object) => RollAbilityInput.safeParse({ combatantId: "k", ...v }).success;
    expect(ok({ kind: "save", ability: "dex" })).toBe(true);
    expect(ok({ kind: "check", ability: "str", mode: "advantage", public: false })).toBe(true);
    expect(ok({ kind: "check", ability: "str", manual: { diceTotal: 14 } })).toBe(true);
    expect(ok({ kind: "save" })).toBe(false);
    expect(ok({ kind: "attack", ability: "str" })).toBe(false);
    expect(ok({ kind: "save", ability: "dex", bonus: 2 })).toBe(false);
  });

  test("FR-CBT-39 combatant movedFt: int 0–9,999", () => {
    const row = {
      id: "k",
      campaignId: "c",
      encounterId: "e",
      seq: 1,
      kind: "monster",
      entityId: "g",
      tokenId: null,
      name: "Goblin",
      imageAssetId: null,
      hidden: false,
      active: true,
      removed: false,
      initiative: null,
      initRollId: null,
      position: 0,
      playerPosition: 0,
      hpCurrent: 7,
      hpMax: 7,
      tempHp: 0,
    };
    expect(CombatantRecord.safeParse({ ...row, movedFt: 0 }).success).toBe(true);
    expect(CombatantRecord.safeParse({ ...row, movedFt: 9999 }).success).toBe(true);
    expect(CombatantRecord.safeParse({ ...row, movedFt: 10000 }).success).toBe(false);
    expect(CombatantRecord.safeParse(row).success).toBe(false);
  });

  test("FR-CBTX-14 combatant tempHp: int 0–999, required on the DM record", () => {
    const row = {
      id: "k",
      campaignId: "c",
      encounterId: "e",
      seq: 1,
      kind: "monster",
      entityId: "g",
      tokenId: null,
      name: "Goblin",
      imageAssetId: null,
      hidden: false,
      active: true,
      removed: false,
      initiative: null,
      initRollId: null,
      position: 0,
      playerPosition: 0,
      hpCurrent: 7,
      hpMax: 7,
      movedFt: 0,
    };
    expect(CombatantRecord.safeParse({ ...row, tempHp: 0 }).success).toBe(true);
    expect(CombatantRecord.safeParse({ ...row, tempHp: 999 }).success).toBe(true);
    expect(CombatantRecord.safeParse({ ...row, tempHp: 1000 }).success).toBe(false);
    expect(CombatantRecord.safeParse({ ...row, tempHp: -1 }).success).toBe(false);
    expect(CombatantRecord.safeParse(row).success).toBe(false);
  });

  test("FR-CBTX-32 no player combatant view has a tempHp field", () => {
    for (const s of [PlayerPcCombatant, PlayerMonsterCombatant, PlayerRemovedCombatant]) {
      expect(Object.keys(s.shape)).not.toContain("tempHp");
      expect(Object.keys(s.shape)).not.toContain("hpCurrent");
    }
  });

  test("FR-CBTX-21 hp-change record: temp before / after, death counters | null, noteIds", () => {
    const keys = Object.keys(HpChangeRecord.shape);
    for (const k of ["tempBefore", "tempAfter", "deathBefore", "deathAfter", "noteIds"]) {
      expect(keys).toContain(k);
    }
    const death = HpChangeRecord.shape.deathAfter;
    expect(death.safeParse(null).success).toBe(true);
    expect(death.safeParse({ successes: 0, failures: 2 }).success).toBe(true);
    expect(death.safeParse({ successes: 0, failures: 4 }).success).toBe(false);
  });

  test("FR-CBTX-07/22 undo and turn results gain notRestored, default []", () => {
    expect(UndoResult.parse({ hpChangeIds: ["h"] })).toEqual({
      hpChangeIds: ["h"],
      notRestored: [],
    });
    expect(
      UndoResult.parse({ hpChangeIds: ["h"], notRestored: ["Bless (Mira)"] }).notRestored,
    ).toEqual(["Bless (Mira)"]);
    expect(UndoResult.safeParse({ hpChangeIds: [], notRestored: [] }).success).toBe(false);
    expect(TurnResult.parse({})).toEqual({ notRestored: [] });
    expect(TurnResult.parse({ notRestored: ["Frightened (Goblin)"] })).toEqual({
      notRestored: ["Frightened (Goblin)"],
    });
  });
});
