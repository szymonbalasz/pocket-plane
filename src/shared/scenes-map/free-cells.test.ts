// FR-MAP-48: `freeCellsNear` (pure; combat's created tokens, FR-CBT-65 / FR-CBTX-44).
import { describe, expect, test } from "bun:test";
import { distanceFt, footprint, freeCellsNear, insideMap } from "./geometry";
import type { TokenSize } from "./schemas";

/** 20 × 14 cells. */
const map = { mapWidth: 1400, mapHeight: 980, gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
/** Offsets: col 0 starts at x 25; last whole cells col 80, row 53. */
const cellar = {
  mapWidth: 4096,
  mapHeight: 2731,
  gridCellSize: 50,
  gridOffsetX: 25,
  gridOffsetY: 10,
};
const tiny2x2 = { ...map, mapWidth: 140, mapHeight: 140 };
const t = (col: number, row: number, size: TokenSize = "medium") => ({ col, row, size });

describe("FR-MAP-48 freeCellsNear", () => {
  test("empty map: `at` first, then distance, ties by row then col", () => {
    expect(freeCellsNear(map, [], { col: 10, row: 7 }, "medium", 1)).toEqual([{ col: 10, row: 7 }]);
    expect(freeCellsNear(map, [], { col: 10, row: 7 }, "medium", 9)).toEqual([
      { col: 10, row: 7 },
      { col: 9, row: 6 },
      { col: 10, row: 6 },
      { col: 11, row: 6 },
      { col: 9, row: 7 },
      { col: 11, row: 7 },
      { col: 9, row: 8 },
      { col: 10, row: 8 },
      { col: 11, row: 8 },
    ]);
    // 5/10/5 distance: the 10 ft ring starts with row 5's cols 9–11; (8, 5) is 15 ft.
    const ring = freeCellsNear(map, [], { col: 10, row: 7 }, "medium", 25);
    expect(ring.slice(9, 12)).toEqual([
      { col: 9, row: 5 },
      { col: 10, row: 5 },
      { col: 11, row: 5 },
    ]);
    expect(ring.findIndex((c) => c.col === 8 && c.row === 5)).toBeGreaterThan(20);
  });

  test("occupied cells (any token footprint) are skipped", () => {
    expect(freeCellsNear(map, [t(10, 7)], { col: 10, row: 7 }, "medium", 1)).toEqual([
      { col: 9, row: 6 },
    ]);
    // A large token at (9, 6) covers (9..10, 6..7).
    expect(freeCellsNear(map, [t(9, 6, "large")], { col: 10, row: 7 }, "medium", 2)).toEqual([
      { col: 11, row: 6 },
      { col: 11, row: 7 },
    ]);
  });

  test("large footprints stay inside the map and never overlap an earlier result", () => {
    expect(freeCellsNear(map, [], { col: 19, row: 13 }, "large", 2)).toEqual([
      { col: 18, row: 12 },
      { col: 18, row: 10 },
    ]);
  });

  test("full map → fewer (or none)", () => {
    const all = [t(0, 0), t(1, 0), t(0, 1), t(1, 1)];
    expect(freeCellsNear(tiny2x2, all, { col: 0, row: 0 }, "medium", 3)).toEqual([]);
    expect(freeCellsNear(tiny2x2, all.slice(1), { col: 1, row: 1 }, "medium", 3)).toEqual([
      { col: 0, row: 0 },
    ]);
    expect(freeCellsNear(tiny2x2, [], { col: 0, row: 0 }, "large", 2)).toEqual([
      { col: 0, row: 0 },
    ]);
    expect(freeCellsNear(tiny2x2, [], { col: 0, row: 0 }, "huge", 1)).toEqual([]);
  });

  test("grid offsets: only whole cells inside the map; `at` outside the map still works", () => {
    expect(insideMap(cellar, 0, 0, "medium")).toBe(true);
    expect(insideMap(cellar, -1, 0, "medium")).toBe(false);
    expect(insideMap(cellar, 80, 53, "medium")).toBe(true);
    expect(insideMap(cellar, 81, 53, "medium")).toBe(false);
    expect(freeCellsNear(cellar, [], { col: -3, row: -3 }, "medium", 1)).toEqual([
      { col: 0, row: 0 },
    ]);
    // (79, 53) and (80, 53) are both 1035 ft away (5/10/5): the tie goes to the lower col.
    expect(freeCellsNear(cellar, [], { col: 200, row: 200 }, "medium", 2)).toEqual([
      { col: 79, row: 53 },
      { col: 80, row: 53 },
    ]);
  });

  test("property: inside, disjoint, free and in non-decreasing distance", () => {
    let seed = 7;
    const rnd = (k: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % k;
    };
    const sizes: TokenSize[] = ["medium", "large", "huge"];
    for (let i = 0; i < 40; i++) {
      const tokens = Array.from({ length: rnd(30) }, () =>
        t(rnd(20), rnd(14), sizes[rnd(3)] as TokenSize),
      );
      const at = { col: rnd(20), row: rnd(14) };
      const size = sizes[rnd(3)] as TokenSize;
      const out = freeCellsNear(map, tokens, at, size, 1 + rnd(12));
      const cells = new Set<string>();
      const mark = (c: { col: number; row: number }, n: number) => {
        const keys: string[] = [];
        for (let dc = 0; dc < n; dc++)
          for (let dr = 0; dr < n; dr++) keys.push(`${c.col + dc},${c.row + dr}`);
        return keys;
      };
      for (const tok of tokens) for (const k of mark(tok, footprint(tok.size))) cells.add(k);
      let last = -1;
      for (const c of out) {
        expect(insideMap(map, c.col, c.row, size)).toBe(true);
        for (const k of mark(c, footprint(size))) {
          expect(cells.has(k)).toBe(false);
          cells.add(k);
        }
        const d = distanceFt(at, c);
        expect(d).toBeGreaterThanOrEqual(last);
        last = d;
      }
    }
  });
});
