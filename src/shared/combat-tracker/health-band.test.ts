import { describe, expect, test } from "bun:test";
import { healthBand, isCritical } from "./rules";

describe("FR-CBT-26 health band", () => {
  test("FR-CBT-26 healthy > 50 %, bloodied ≤ 50 %, critical < 15 %, down at 0", () => {
    expect([20, 11, 10, 4, 3, 2, 1, 0].map((hp) => healthBand(hp, 20))).toEqual([
      "healthy",
      "healthy",
      "bloodied",
      "bloodied",
      "bloodied", // 15 % exactly is not under 15 %
      "critical",
      "critical",
      "down",
    ]);
  });

  test("FR-CBT-26 critical never at 0 and works on tiny maxima", () => {
    expect(isCritical(0, 7)).toBe(false);
    expect(healthBand(1, 7)).toBe("critical"); // 14.3 %
    expect(healthBand(1, 6)).toBe("bloodied"); // 16.7 %
    expect(healthBand(1, 1)).toBe("healthy");
  });
});
