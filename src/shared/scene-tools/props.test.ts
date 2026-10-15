// Pure prop rules (FR-SCN-16–18): overlap, duplicate cell, draw order + hit test, corner resize
// (1–20 cells, opposite corner fixed), to front / to back, rotate.
import { describe, expect, test } from "bun:test";
import {
  backZ,
  duplicatePropCell,
  frontZ,
  nextRotation,
  propAt,
  propDrawOrder,
  propOverlapsMap,
  resizeFromHandle,
} from "./props";
import type { PropView } from "./schemas";

/** Goblin Ambush: 20 × 14 cells at 70 px. */
const MAP = { mapWidth: 1400, mapHeight: 980, gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };

const prop = (id: string, f: Partial<PropView> = {}): PropView => ({
  id,
  sceneId: "s",
  seq: 1,
  assetId: "a",
  col: 0,
  row: 0,
  w: 1,
  h: 1,
  rotation: 0,
  z: 0,
  hidden: false,
  ...f,
});

describe("FR-SCN-16 / -17 prop placement", () => {
  test("FR-SCN-16 the footprint must overlap the map", () => {
    expect(propOverlapsMap(MAP, { col: 19, row: 13, w: 1, h: 1 })).toBe(true);
    expect(propOverlapsMap(MAP, { col: 20, row: 0, w: 1, h: 1 })).toBe(false);
    expect(propOverlapsMap(MAP, { col: -2, row: 0, w: 2, h: 1 })).toBe(false);
    expect(propOverlapsMap(MAP, { col: -2, row: -2, w: 3, h: 3 })).toBe(true);
    expect(propOverlapsMap({ ...MAP, gridOffsetX: 35 }, { col: 19, row: 0, w: 1, h: 1 })).toBe(
      true,
    );
    expect(propOverlapsMap({ ...MAP, gridOffsetX: 35 }, { col: 20, row: 0, w: 1, h: 1 })).toBe(
      false,
    );
  });

  test("FR-SCN-17 duplicate: col + w, else col − w, else the source cell", () => {
    expect(duplicatePropCell(MAP, { col: 4, row: 11, w: 2, h: 1 })).toEqual({ col: 6, row: 11 });
    expect(duplicatePropCell(MAP, { col: 19, row: 2, w: 1, h: 1 })).toEqual({ col: 18, row: 2 });
    expect(duplicatePropCell(MAP, { col: 0, row: 2, w: 20, h: 1 })).toEqual({ col: 0, row: 2 });
  });
});

describe("FR-SCN-18 draw order and hit test", () => {
  test("FR-SCN-18 ordered by z, then seq; the topmost prop under a cell wins", () => {
    const a = prop("a", { seq: 1, w: 3, h: 3 });
    const b = prop("b", { seq: 2, col: 1, row: 1 });
    const c = prop("c", { seq: 3, z: -1, col: 1, row: 1, w: 2, h: 2 });
    expect([b, c, a].sort(propDrawOrder).map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(propAt([a, b, c], { col: 1, row: 1 })?.id).toBe("b");
    expect(propAt([a, b, c], { col: 2, row: 2 })?.id).toBe("a");
    expect(propAt([a, b, c], { col: 3, row: 0 })).toBeNull();
    // Rotation doesn't change the footprint (FR-SCN-18).
    const t = prop("t", { col: 4, row: 11, w: 2, rotation: 90 });
    expect(propAt([t], { col: 5, row: 11 })?.id).toBe("t");
    expect(propAt([t], { col: 4, row: 12 })).toBeNull();
  });
});

describe("FR-SCN-17 resize, reorder, rotate", () => {
  test("FR-SCN-17 a corner handle snaps to cells, keeps the opposite corner, 1–20 per side", () => {
    const p = { col: 6, row: 12, w: 1, h: 1 };
    expect(resizeFromHandle(p, "se", { col: 7, row: 13 })).toEqual({ col: 6, row: 12, w: 2, h: 2 });
    expect(resizeFromHandle(p, "nw", { col: 5, row: 11 })).toEqual({ col: 5, row: 11, w: 2, h: 2 });
    expect(resizeFromHandle(p, "ne", { col: 8, row: 10 })).toEqual({ col: 6, row: 10, w: 3, h: 3 });
    expect(resizeFromHandle(p, "sw", { col: 4, row: 12 })).toEqual({ col: 4, row: 12, w: 3, h: 1 });
    // Past the opposite corner → 1 cell; past 20 → 20.
    expect(resizeFromHandle(p, "se", { col: 0, row: 0 })).toEqual({ col: 6, row: 12, w: 1, h: 1 });
    expect(resizeFromHandle(p, "nw", { col: 40, row: 40 })).toEqual({
      col: 6,
      row: 12,
      w: 1,
      h: 1,
    });
    expect(resizeFromHandle(p, "se", { col: 60, row: 12 })).toMatchObject({ col: 6, w: 20, h: 1 });
    expect(resizeFromHandle(p, "nw", { col: -60, row: 12 })).toMatchObject({ col: -13, w: 20 });
  });

  test("FR-SCN-17 to front / to back: one past the others' top / bottom z; already there → null", () => {
    const ps = [
      { id: "a", z: 0 },
      { id: "b", z: 3 },
      { id: "c", z: -2 },
    ];
    expect(frontZ(ps, "a")).toBe(4);
    expect(backZ(ps, "a")).toBe(-3);
    expect(frontZ(ps, "b")).toBeNull();
    expect(backZ(ps, "c")).toBeNull();
    // Equal z: still moves (seq may draw it below).
    expect(
      frontZ(
        [
          { id: "a", z: 0 },
          { id: "b", z: 0 },
        ],
        "a",
      ),
    ).toBe(1);
    expect(frontZ([{ id: "a", z: 0 }], "a")).toBeNull();
    expect(frontZ(ps, "x")).toBeNull();
  });

  test("FR-SCN-17 rotate 90° clockwise steps 0 → 90 → 180 → 270 → 0", () => {
    expect([0, 90, 180, 270].map(nextRotation)).toEqual([90, 180, 270, 0]);
  });
});
