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
  sceneList,
  sceneOrder,
  tokenDrawOrder,
} from "./geometry";

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

  test("FR-MAP-17 duplicate placement: right, else left, else the source cell", () => {
    expect(duplicateCell(map, { col: 12, row: 6, size: "small" })).toEqual({ col: 13, row: 6 });
    expect(duplicateCell(map, { col: 19, row: 6, size: "medium" })).toEqual({ col: 18, row: 6 });
    expect(duplicateCell(map, { col: 9, row: 10, size: "large" })).toEqual({ col: 11, row: 10 });
    const tiny = { ...map, mapWidth: 70, mapHeight: 70 };
    expect(duplicateCell(tiny, { col: 0, row: 0, size: "medium" })).toEqual({ col: 0, row: 0 });
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
    const list = sceneList(folders, scenes);
    expect(list.map((e) => [e.folder?.id ?? null, e.scenes.map((s) => s.id)])).toEqual([
      ["f1", ["s2", "s1"]],
      ["f2", []],
      [null, ["s3", "s4", "s5"]],
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
  });
});
