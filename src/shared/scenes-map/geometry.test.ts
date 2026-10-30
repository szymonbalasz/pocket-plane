import { describe, expect, test } from "bun:test";
import {
  baseName,
  byNameThenSeq,
  cellToPx,
  copyName,
  distanceFt,
  distanceLabel,
  dropCell,
  duplicateCell,
  footprint,
  initials,
  numberedName,
  overlapsMap,
  pxToCell,
  tokenDrawOrder,
} from "./geometry";
import { sceneOrder, sceneTree } from "./list-tree";

const map = { mapWidth: 1400, mapHeight: 980, gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const cellar = {
  mapWidth: 4096,
  mapHeight: 2731,
  gridCellSize: 50,
  gridOffsetX: 25,
  gridOffsetY: 10,
};

describe("scenes-map geometry", () => {
  test("FR-MAP-14 footprint per size", () => {
    expect(
      ["tiny", "small", "medium", "large", "huge", "gargantuan"].map((s) => footprint(s as never)),
    ).toEqual([1, 1, 1, 2, 3, 4]);
  });

  test("MAP §8 cell → px with offset, px → cell", () => {
    expect(cellToPx(cellar, 0, 0)).toEqual({ x: 25, y: 10 });
    expect(cellToPx(cellar, 40, 27)).toEqual({ x: 2025, y: 1360 });
    expect(pxToCell(cellar, 25, 10)).toEqual({ col: 0, row: 0 });
    expect(pxToCell(cellar, 24, 9)).toEqual({ col: -1, row: -1 });
    expect(pxToCell(cellar, 2074.9, 1409.9)).toEqual({ col: 40, row: 27 });
  });

  test("FR-MAP-15 drop rounding of the top-left corner", () => {
    expect(dropCell(map, 5 * 70 + 34, 5 * 70 - 34)).toEqual({ col: 5, row: 5 });
    expect(dropCell(map, 5 * 70 + 36, 5 * 70 - 36)).toEqual({ col: 6, row: 4 });
    expect(dropCell(cellar, 25 + 50 * 3 + 10, 10 - 20)).toEqual({ col: 3, row: 0 });
    expect(Object.is(dropCell(map, -10, -10).col, 0)).toBe(true);
  });

  test("FR-MAP-14 valid iff the footprint overlaps the map", () => {
    expect(overlapsMap(map, 0, 0, "medium")).toBe(true);
    expect(overlapsMap(map, 19, 13, "medium")).toBe(true);
    expect(overlapsMap(map, 20, 13, "medium")).toBe(false);
    expect(overlapsMap(map, -1, 0, "medium")).toBe(false);
    expect(overlapsMap(map, -1, 0, "large")).toBe(true);
    expect(overlapsMap(map, -2, 0, "large")).toBe(false);
    // Offset: column −1 still pokes into the map.
    expect(overlapsMap(cellar, -1, -1, "medium")).toBe(true);
    expect(overlapsMap({ ...cellar, gridOffsetX: 0 }, -1, 0, "medium")).toBe(false);
  });

  test("FR-MAP-22 ruler uses 5/10/5 diagonals", () => {
    const from = { col: 0, row: 0 };
    const cases: [number, number, number][] = [
      [0, 0, 0],
      [1, 1, 5],
      [2, 2, 15],
      [3, 3, 20],
      [4, 4, 30],
      [5, 2, 30],
      [2, 5, 30],
      [3, 0, 15],
      [0, 3, 15],
    ];
    for (const [dx, dy, ft] of cases) {
      expect(distanceFt(from, { col: dx, row: dy })).toBe(ft);
      expect(distanceLabel(from, { col: dx, row: dy })).toBe(`${ft} ft`);
    }
    // Direction and origin don't matter.
    expect(distanceFt({ col: 3, row: 3 }, { col: -1, row: -1 })).toBe(30);
    expect(distanceFt({ col: 7, row: 9 }, { col: 2, row: 7 })).toBe(30);
  });

  test("FR-MAP-15 drag label uses the ruler's 5/10/5 rule", () => {
    // Straight 3-cell drag (e2e) and diagonal drags.
    expect(distanceLabel({ col: 5, row: 5 }, { col: 8, row: 5 })).toBe("15 ft");
    expect(distanceLabel({ col: 5, row: 5 }, { col: 7, row: 7 })).toBe("15 ft");
    expect(distanceLabel({ col: 5, row: 5 }, { col: 1, row: 1 })).toBe("30 ft");
  });

  test("FR-MAP-16 numbering: Goblin → Goblin 2 → Goblin 3", () => {
    expect(baseName("Goblin 2")).toBe("Goblin");
    expect(baseName("Goblin")).toBe("Goblin");
    expect(baseName("2")).toBe("2");
    expect(numberedName("Goblin", [])).toBe("Goblin");
    expect(numberedName("Goblin", ["Mira"])).toBe("Goblin");
    expect(numberedName("Goblin", ["Goblin"])).toBe("Goblin 2");
    expect(numberedName("Goblin", ["Goblin", "Goblin 2"])).toBe("Goblin 3");
    expect(numberedName("Goblin 2", ["Goblin", "Goblin 2"])).toBe("Goblin 3");
    expect(numberedName("Goblin", ["Goblin 7"])).toBe("Goblin 8");
    expect(numberedName("Goblin", ["Goblin Chief", "goblin"])).toBe("Goblin");
  });

  test("FR-MAP-16 numbering cuts the base so the result ≤ 40 chars", () => {
    const long = "A".repeat(40);
    const second = numberedName(long, [long]);
    expect(second).toBe(`${"A".repeat(38)} 2`);
    expect([...second].length).toBe(40);
    const third = numberedName(long, [long, second]);
    expect(third).toBe(`${"A".repeat(38)} 3`);
    const tenth = numberedName(long, [long, `${"A".repeat(38)} 9`]);
    expect(tenth).toBe(`${"A".repeat(37)} 10`);
    // Trailing space left by a cut is dropped.
    expect(numberedName(`${"B".repeat(37)} C`, [`${"B".repeat(37)} C`])).toBe(
      `${"B".repeat(37)} 2`,
    );
  });

  test("FR-MAP-04 copy name cut to 60", () => {
    expect(copyName("Town")).toBe("Town (copy)");
    expect([...copyName("x".repeat(60))].length).toBe(60);
  });

  describe("FR-MAP-17 duplicate placement (BL-163)", () => {
    type Size = Parameters<typeof footprint>[0];
    const at = (col: number, row: number, size: Size = "medium") => ({ col, row, size });
    /** The cell for a copy of `t`; the scene holds `t` and `others`. */
    const copyOf = (t: ReturnType<typeof at>, others: ReturnType<typeof at>[] = [], m = map) =>
      duplicateCell(m, t, [t, ...others]);
    /** Every cell of a Chebyshev ring around (col, row), top to bottom, left to right. */
    const ring = (col: number, row: number, r: number) => {
      const out: ReturnType<typeof at>[] = [];
      for (let y = row - r; y <= row + r; y++) {
        for (let x = col - r; x <= col + r; x++) {
          if (Math.max(Math.abs(x - col), Math.abs(y - row)) === r) out.push(at(x, y));
        }
      }
      return out;
    };

    test("BL-163 free right cell, else left, on an empty map", () => {
      expect(copyOf(at(12, 6, "small"))).toEqual({ col: 13, row: 6 });
      expect(copyOf(at(19, 6))).toEqual({ col: 18, row: 6 });
      expect(copyOf(at(9, 10, "large"))).toEqual({ col: 11, row: 10 });
    });

    test("BL-163 right occupied → left; another token's whole footprint counts", () => {
      expect(copyOf(at(5, 5), [at(6, 5)])).toEqual({ col: 4, row: 5 });
      expect(copyOf(at(6, 5), [at(7, 4, "large")])).toEqual({ col: 5, row: 5 });
    });

    test("BL-163 both occupied → ring 1, top to bottom, left to right", () => {
      const blocked = [at(6, 5), at(4, 5)];
      for (const cell of [
        { col: 4, row: 4 },
        { col: 5, row: 4 },
        { col: 6, row: 4 },
        { col: 4, row: 6 },
        { col: 5, row: 6 },
        { col: 6, row: 6 },
      ]) {
        expect(copyOf(at(5, 5), blocked)).toEqual(cell);
        blocked.push(at(cell.col, cell.row));
      }
    });

    test("BL-163 crowded → ring 2, then ring 3, in order", () => {
      const r1 = ring(5, 5, 1);
      const r2 = ring(5, 5, 2);
      expect(copyOf(at(5, 5), r1)).toEqual({ col: 3, row: 3 });
      expect(copyOf(at(5, 5), [...r1, at(3, 3)])).toEqual({ col: 4, row: 3 });
      // Row 4 of ring 2 has only its two ends.
      expect(copyOf(at(5, 5), [...r1, ...r2.slice(0, 5)])).toEqual({ col: 3, row: 4 });
      expect(copyOf(at(5, 5), [...r1, ...r2.slice(0, 6)])).toEqual({ col: 7, row: 4 });
      expect(copyOf(at(5, 5), [...r1, ...r2])).toEqual({ col: 2, row: 2 });
    });

    test("BL-163 full map → the source cell; a map too small for the footprint too", () => {
      const small = { ...map, mapWidth: 210, mapHeight: 140 }; // 3 × 2 cells
      const all = [at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(2, 1)];
      expect(copyOf(at(1, 1), all, small)).toEqual({ col: 1, row: 1 });
      const tiny = { ...map, mapWidth: 70, mapHeight: 70 };
      expect(copyOf(at(0, 0), [], tiny)).toEqual({ col: 0, row: 0 });
      expect(copyOf(at(0, 0, "huge"), [], small)).toEqual({ col: 0, row: 0 });
    });

    test("BL-163 Large+: the copy's whole footprint must be free and inside the map", () => {
      const ogre = at(5, 5, "large");
      expect(copyOf(ogre)).toEqual({ col: 7, row: 5 });
      // Only the copy's lower-right cell is covered.
      expect(copyOf(ogre, [at(8, 6)])).toEqual({ col: 3, row: 5 });
      // Ring 1 always overlaps the source; ring 2 starts at the top-left.
      expect(copyOf(ogre, [at(8, 6), at(3, 6)])).toEqual({ col: 3, row: 3 });
      expect(copyOf(ogre, [at(8, 6), at(3, 6), at(4, 4)])).toEqual({ col: 5, row: 3 });
      const huge = at(5, 5, "huge");
      expect(copyOf(huge)).toEqual({ col: 8, row: 5 });
      expect(copyOf(huge, [at(10, 7)])).toEqual({ col: 2, row: 5 });
    });

    test("BL-163 map edge: never hangs off the map", () => {
      // A Large copy at col + 2 = 19 would hang over the right edge (20 columns).
      expect(copyOf(at(17, 5, "large"))).toEqual({ col: 15, row: 5 });
      // Corner, left occupied: rows and columns outside the map are skipped.
      expect(copyOf(at(19, 0), [at(18, 0)])).toEqual({ col: 18, row: 1 });
      expect(copyOf(at(0, 13), [at(1, 13)])).toEqual({ col: 0, row: 12 });
      // The left cell of col 0 is off the map; rings stay on it.
      expect(copyOf(at(0, 0), [at(1, 0)])).toEqual({ col: 0, row: 1 });
      // Offset grid: column −1 only pokes into the map, so it is not "inside".
      expect(copyOf(at(0, 0), [at(1, 0)], cellar)).toEqual({ col: 0, row: 1 });
    });
  });

  test("FR-MAP-02 list order: folders then root scenes, name ci, tiebreak seq (equal createdAt)", () => {
    const folders = [
      { id: "f2", name: "act 2", seq: 2 },
      { id: "f1", name: "Act 1", seq: 1 },
    ];
    const scenes = [
      { id: "s1", name: "Town", seq: 1, folderId: "f1" },
      { id: "s2", name: "Goblin Ambush", seq: 2, folderId: "f1" },
      { id: "s3", name: "Cellar", seq: 3, folderId: null },
      { id: "s4", name: "cellar", seq: 4, folderId: null },
      { id: "s5", name: "Orphan", seq: 5, folderId: "gone" },
    ];
    const ids = (
      nodes: ReturnType<typeof sceneTree<(typeof folders)[number], (typeof scenes)[number]>>,
    ): unknown[] => nodes.map((n) => (n.folder ? [n.folder.id, ids(n.children)] : n.item?.id));
    expect(ids(sceneTree(folders, scenes))).toEqual([
      ["f1", ["s2", "s1"]],
      ["f2", []],
      "s3",
      "s4",
      "s5",
    ]);
    expect(sceneOrder(folders, scenes)[0]?.id).toBe("s2");
    expect(byNameThenSeq({ name: "a", seq: 2 }, { name: "A", seq: 1 })).toBeGreaterThan(0);
  });

  test("MAP §7 draw order: larger below smaller, then seq; initials", () => {
    const list = [
      { id: "a", size: "medium" as const, seq: 1 },
      { id: "b", size: "large" as const, seq: 3 },
      { id: "c", size: "small" as const, seq: 2 },
    ];
    expect([...list].sort(tokenDrawOrder).map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(initials("Elite Goblin Warrior")).toBe("EG");
    expect(initials("mira")).toBe("M");
    // Punctuation never counts (a pet named by FR-ENT-32's rule).
    expect(initials("Owlbear (Mira)")).toBe("OM");
    expect(initials("Owlbear (Mira) 2")).toBe("OM");
    expect(initials("— (x)")).toBe("X");
    expect(initials("()")).toBe("");
  });
});
