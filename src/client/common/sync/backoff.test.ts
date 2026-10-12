import { expect, test } from "bun:test";
import { backoffDelay } from "./backoff";

test("FR-SYNC-05 backoff: 0.5 s doubling to a 1.5 s cap (#131), ±20 % jitter", () => {
  const mid = () => 0.5;
  expect([0, 1, 2, 3, 4, 5, 10, 50].map((n) => backoffDelay(n, mid))).toEqual([
    500, 1000, 1500, 1500, 1500, 1500, 1500, 1500,
  ]);
  expect(backoffDelay(0, () => 0)).toBe(400);
  expect(backoffDelay(0, () => 1)).toBe(600);
  expect(backoffDelay(9, () => 0)).toBe(1200);
  expect(backoffDelay(9, () => 1)).toBe(1800);
});

test("FR-SYNC-05 cap: no delay ever exceeds 1.8 s (1.5 s + 20 %), any attempt, any jitter", () => {
  for (let attempt = 0; attempt < 200; attempt++) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999, 1]) {
      const d = backoffDelay(attempt, () => r);
      expect(d).toBeGreaterThanOrEqual(400);
      expect(d).toBeLessThanOrEqual(1800);
    }
  }
});
