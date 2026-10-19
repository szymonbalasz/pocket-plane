import { describe, expect, test } from "bun:test";
import { dmg2014, formatCr, rateEncounter, totalCr } from "./difficulty";

describe("FR-CBT-03 dmg-2014", () => {
  test("FR-CBT-03 CBT §13 step 1: Goblin ×2, Wolf, Elite vs two L1 → 250 / 625, Deadly", () => {
    const r = dmg2014.rate([1, 1], ["1/4", "1/4", "1/4", "1/2"]);
    expect(r).toEqual({
      rating: "Deadly",
      baseXp: 250,
      adjustedXp: 625,
      multiplier: 2.5,
      thresholds: { easy: 50, medium: 100, hard: 150, deadly: 200 },
    });
    expect(formatCr(totalCr(["1/4", "1/4", "1/4", "1/2"]))).toBe("1.25");
  });

  test("FR-CBT-03 DMG example: four L3 vs 1 bugbear-class CR 1 + 2 CR 1/4 → ×2", () => {
    // 200 + 50 + 50 = 300 × 2 (3 monsters, 4 PCs) = 600: medium 600 ≤ 600 < hard 900.
    const r = dmg2014.rate([3, 3, 3, 3], ["1", "1/4", "1/4"]);
    expect(r.adjustedXp).toBe(600);
    expect(r.rating).toBe("Medium");
  });

  test("FR-CBT-03 ladder ends ×0.5 and ×5, clamped", () => {
    // 1 monster, 6+ PCs → one step down from ×1 → ×0.5.
    expect(dmg2014.rate([1, 1, 1, 1, 1, 1], ["1"]).multiplier).toBe(0.5);
    // 15+ monsters (×4), < 3 PCs → ×5.
    expect(dmg2014.rate([5], Array(15).fill("0")).multiplier).toBe(5);
    // 20 monsters, 1 PC: still ×5 (clamped).
    expect(dmg2014.rate([5], Array(20).fill("0")).multiplier).toBe(5);
  });

  test("FR-CBT-03 base steps by count 1 / 2 / 3–6 / 7–10 / 11–14 / 15+", () => {
    const party = [1, 1, 1, 1];
    const m = (n: number) => dmg2014.rate(party, Array(n).fill("1")).multiplier;
    expect([1, 2, 3, 6, 7, 10, 11, 14, 15].map(m)).toEqual([1, 1.5, 2, 2, 2.5, 2.5, 3, 3, 4]);
  });

  test("FR-CBT-03 CR 0 = 10 XP; no party → —; nothing → Trivial", () => {
    expect(dmg2014.rate([1, 1, 1], ["0"]).baseXp).toBe(10);
    expect(dmg2014.rate([], ["1"])).toMatchObject({ rating: "—", thresholds: null, baseXp: 200 });
    expect(dmg2014.rate([1, 1, 1], []).rating).toBe("Trivial");
    expect(dmg2014.rate([20, 20, 20, 20], ["1"]).rating).toBe("Trivial");
  });
});

describe("FR-CBT-102 difficulty counts enemies only (#252)", () => {
  const goblin = (quantity: number, side: "ally" | "enemy") => ({
    name: "Goblin",
    cr: "1/4",
    quantity,
    side,
  });

  test("FR-CBT-102 difficulty enemies only: enc-friendly rates Goblin ×2, lists the friendly one", () => {
    const r = rateEncounter(dmg2014, [1, 1], [goblin(2, "enemy"), goblin(1, "ally")]);
    // As if only Goblin ×2: 100 XP × 1.5 (2 monsters) +1 step (< 3 PCs) = ×2.
    expect(r).toMatchObject(dmg2014.rate([1, 1], ["1/4", "1/4"]));
    expect(formatCr(r.totalCr)).toBe("0.5");
    expect(r.friendly).toBe("Friendly: Goblin ×1 (CR 1/4)");
    // Friendly off (all three enemies): rating and total CR rise.
    const off = rateEncounter(dmg2014, [1, 1], [goblin(3, "enemy")]);
    expect(off.adjustedXp).toBeGreaterThan(r.adjustedXp);
    expect(formatCr(off.totalCr)).toBe("0.75");
    expect(off.friendly).toBeNull();
  });

  test("FR-CBT-102 difficulty enemies only: all friendly → '—'; several friendly entries listed", () => {
    const wolf = { name: "Wolf", cr: "1/4", quantity: 1, side: "ally" as const };
    const r = rateEncounter(dmg2014, [1, 1], [goblin(2, "ally"), wolf]);
    expect([r.rating, r.baseXp, r.totalCr]).toEqual(["—", 0, 0]);
    expect(r.friendly).toBe("Friendly: Goblin ×2 (CR 1/4), Wolf ×1 (CR 1/4)");
    // No entries at all keeps FR-CBT-03's rule (Trivial with a party).
    expect(rateEncounter(dmg2014, [1, 1], []).rating).toBe("Trivial");
  });
});
