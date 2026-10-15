import { describe, expect, test } from "bun:test";
import { countBelow, newIds } from "./below-fold";

describe("FR-CBT-77 rows below the fold", () => {
  test("FR-CBT-77 more: rows not wholly above the fold count; none → 0", () => {
    const rows = [100, 140, 180, 220].map((top) => ({ top, bottom: top + 38 }));
    expect(countBelow(rows, 300)).toBe(0);
    expect(countBelow(rows, 200)).toBe(2); // 180–218 is cut, 220–258 is below
    expect(countBelow(rows, 258)).toBe(0);
    expect(countBelow([], 0)).toBe(0);
  });

  test("FR-CBT-77 new row → scroll target: the first id not shown before, in list order", () => {
    expect(newIds([], ["a", "b"])).toEqual(["a", "b"]);
    expect(newIds(["a", "b"], ["a", "c", "b", "d"])).toEqual(["c", "d"]);
    expect(newIds(["a", "b"], ["b"])).toEqual([]);
  });
});
