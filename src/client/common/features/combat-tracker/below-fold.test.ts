import { describe, expect, test } from "bun:test";
import { countBelow, listClip, newIds } from "./below-fold";

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

describe("FR-CBT-125 nothing below N more", () => {
  test("FR-CBT-125 nothing below N more: the body is capped at the window body while its rows don't fit, so the list clips and scrolls", () => {
    // DM 400 × 500 at its cap: 9 rows (≈ 620 px of body content) in a 452-px body → capped, the
    // list (not the window body) scrolls, the footer under it.
    expect(listClip(620, 452)).toBe(452);
    expect(listClip(620, 452.6)).toBe(452);
    // Everything fits (or within a px of rounding): no cap, the footer absent.
    expect(listClip(452, 452)).toBeNull();
    expect(listClip(453, 452)).toBeNull();
    expect(listClip(300, 452)).toBeNull();
  });

  test("FR-CBT-125 nothing below N more: N = rows wholly or partly below the list viewport's bottom edge", () => {
    // The fold is the list's bottom (the footer sits under it, never over the rows).
    const rows = Array.from({ length: 9 }, (_, i) => ({ bottom: 140 + 40 * (i + 1) }));
    expect(countBelow(rows, 400)).toBe(3); // the row ending at 420 cut at 400; 460, 500 below
    expect(countBelow(rows, 460)).toBe(1);
    expect(countBelow(rows, 500)).toBe(0); // scrolled to the end: the last row whole, no footer
  });
});
