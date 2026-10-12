import { expect, test } from "bun:test";
import { backoffDelay } from "./backoff";

test("FR-SYNC-05 backoff: 0.5 s doubling to 5 s, ±20 % jitter", () => {
  const mid = () => 0.5;
  expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoffDelay(n, mid))).toEqual([
    500, 1000, 2000, 4000, 5000, 5000, 5000,
  ]);
  expect(backoffDelay(0, () => 0)).toBe(400);
  expect(backoffDelay(0, () => 1)).toBe(600);
  expect(backoffDelay(9, () => 1)).toBe(6000);
});
