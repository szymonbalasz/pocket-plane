import { describe, expect, test } from "bun:test";
import {
  ApplyCardInput,
  ApplyCardTargetsInput,
  CombatantRecord,
  DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  DamageCardResolution,
  DamageCardResolutionRead,
  DamageCardTargetsResolution,
  HpChangesResult,
  RollAbilityInput,
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
    // Legacy single-target shape still parses for today's server.
    const legacy = { ...base, targetId: "a", hit: true, multiplier: "normal" };
    expect(ApplyCardInput.safeParse(legacy).success).toBe(true);
    expect(HpChangesResult.safeParse({ hpChangeIds: ["h1", "h2"] }).success).toBe(true);
    expect(HpChangesResult.safeParse({ hpChangeIds: [] }).success).toBe(false);
  });

  test("FR-CBT-42 damage-card resolution {targets}; legacy single target read as one part", () => {
    const multi = { targets: [outcome(1), { ...outcome(2), hit: false, applied: 0 }] };
    expect(DamageCardTargetsResolution.safeParse(multi).success).toBe(true);
    expect(DamageCardTargetsResolution.safeParse({ targets: [] }).success).toBe(false);
    expect(DamageCardResolutionRead.parse(multi)).toEqual(multi);
    const legacy = { targetName: null, hit: true, multiplier: "normal" as const, applied: 6 };
    expect(DamageCardResolution.safeParse(legacy).success).toBe(true);
    expect(DamageCardResolutionRead.parse(legacy)).toEqual({ targets: [legacy] });
    expect(DamageCardResolutionRead.safeParse({ ...legacy, targetId: "k" }).success).toBe(false);
  });

  // #155 picked 2 KB. Typical cards fit; the worst case does not (20 × 60-code-point names,
  // up to 4 UTF-8 bytes each, ≈ 6 KB): raised to the orchestrator, combat build must decide.
  test("OQ-CBT-39: 20 typical targets need more than 256 B and fit the damage-card cap", () => {
    const twenty = { targets: Array.from({ length: 20 }, (_, i) => outcome(i, 16)) };
    const bytes = new TextEncoder().encode(
      JSON.stringify(DamageCardTargetsResolution.parse(twenty)),
    ).length;
    expect(bytes).toBeGreaterThan(256);
    expect(bytes).toBeLessThanOrEqual(DAMAGE_CARD_RESOLUTION_MAX_BYTES);
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
    };
    expect(CombatantRecord.safeParse({ ...row, movedFt: 0 }).success).toBe(true);
    expect(CombatantRecord.safeParse({ ...row, movedFt: 9999 }).success).toBe(true);
    expect(CombatantRecord.safeParse({ ...row, movedFt: 10000 }).success).toBe(false);
    expect(CombatantRecord.safeParse(row).success).toBe(false);
  });
});
