// FR-CMP-38 unit: source rank. The matcher's own tests are `@shared/search/match.test.ts`.
import { describe, expect, test } from "bun:test";
import { sourceRank } from "./match";

describe("FR-CMP-38 source rank", () => {
  test("FR-CMP-38 sourceRank: homebrew / custom 0, srd-5.1 1, other imports 2, fixture 3", () => {
    expect(sourceRank(null)).toBe(0);
    expect(sourceRank("srd-5.1")).toBe(1);
    expect(sourceRank("open5e-x")).toBe(2);
    expect(sourceRank("fixture")).toBe(3);
  });
});
