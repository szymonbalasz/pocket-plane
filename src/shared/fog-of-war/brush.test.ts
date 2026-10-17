// FOG §13 sprint-4 unit rows (V6): FR-FOG-26 `stroke` / `cells` zod + containment (distance ≤ r
// boundary, a single point = a circle, cells box / run caps) and their place in the static state
// (FR-FOG-01 painter order).
import { describe, expect, test } from "bun:test";
import { contains } from "@shared/scenes-map/area";
import {
  CELLS_BOX_MAX,
  CELLS_RUNS_MAX,
  cellsOf,
  decodeCells,
  mergeCells,
  paintedCells,
  STROKE_POINTS_MAX,
} from "./brush";
import { encodeRuns, uniformMask } from "./mask";
import { FogEditInput, FogPlaceDarknessInput } from "./schemas";
import { FogBrushGeom, FogLayerShape, shapeBox, shapeContains, staticState } from "./shapes";

const runsOf = (cells: number[]) => encodeRuns(Uint8Array.from(cells), "clear");

describe("FR-FOG-26 stroke / cells", () => {
  test("FR-FOG-26 stroke zod: radius 0.5–10, 1–256 points, ≤ 2 decimals; cells zod: box ≤ 128 × 128, ≤ 500 runs, covers the box, paints a cell", () => {
    const ok = [
      { stroke: [1, 2, 3] },
      { stroke: [0.5, 2, 3, 4.25, 5.5] },
      { stroke: [10, 0, 0, 1, 1] },
      { cells: { box: [2, 3, 2, 2], runs: runsOf([1, 0, 0, 1]) } },
      { cells: { box: [-4, 0, CELLS_BOX_MAX, 1], runs: CELLS_BOX_MAX.toString(36) } },
    ];
    for (const s of ok) expect(FogBrushGeom.safeParse(s).success).toBe(true);
    const bad = [
      { stroke: [0.4, 2, 3] },
      { stroke: [10.5, 2, 3] },
      { stroke: [1, 2] },
      { stroke: [1, 2, 3, 4] },
      { stroke: [1, 2.001, 3] },
      { stroke: [1, ...Array.from({ length: 2 * (STROKE_POINTS_MAX + 1) }, (_, i) => i % 50)] },
      { cells: { box: [0, 0, CELLS_BOX_MAX + 1, 1], runs: "1" } },
      { cells: { box: [0, 0, 2, 2], runs: "" } },
      { cells: { box: [0, 0, 2, 2], runs: "0,4" } },
      { cells: { box: [0, 0, 2, 2], runs: "5" } },
      { cells: { box: [0, 0, 2, 2], runs: "1,x" } },
      {
        cells: {
          box: [0, 0, 128, 128],
          runs: Array.from({ length: CELLS_RUNS_MAX + 2 }, () => "1").join(","),
        },
      },
      { cells: { box: [0, 0, 2, 2], runs: "4", extra: 1 } },
    ];
    for (const s of bad) expect(FogBrushGeom.safeParse(s).success).toBe(false);
    // In `fog.edit` (fog shapes), never in `fog.placeDarkness` (FR-FOG-57).
    expect(
      FogEditInput.safeParse({ sceneId: "s", op: "reveal", shape: { stroke: [1, 2, 3] } }).success,
    ).toBe(true);
    expect(
      FogPlaceDarknessInput.safeParse({ sceneId: "s", shape: { stroke: [1, 2, 3] } }).success,
    ).toBe(false);
    expect(
      FogPlaceDarknessInput.safeParse({
        sceneId: "s",
        shape: { cells: { box: [0, 0, 1, 1], runs: "1" } },
      }).success,
    ).toBe(false);
    expect(FogLayerShape.safeParse({ op: "fog", stroke: [1, 2, 3] }).success).toBe(true);
  });

  test("FR-FOG-26 stroke containment: distance to the polyline ≤ r, boundary-inclusive; a single point = a circle", () => {
    const line = { stroke: [1, 2, 2, 6, 2] };
    expect(shapeContains(line, 4, 2)).toBe(true);
    expect(shapeContains(line, 4, 3)).toBe(true); // exactly r from the segment
    expect(shapeContains(line, 4, 3.01)).toBe(false);
    expect(shapeContains(line, 7, 2)).toBe(true); // the round cap
    expect(shapeContains(line, 7.01, 2)).toBe(false);
    expect(shapeContains(line, 6.71, 2.71)).toBe(false);
    const dot = { stroke: [1.5, 5, 5] };
    expect(shapeContains(dot, 6.5, 5)).toBe(true);
    expect(shapeContains(dot, 6.07, 6.07)).toBe(false);
    expect(shapeContains(dot, 6.06, 6.06)).toBe(true);
    expect(shapeBox(line)).toEqual([1, 1, 7, 3]);
  });

  test("FR-FOG-26 cells containment: a point is inside iff a cell holding it is painted (cell edges belong to both cells)", () => {
    const c = {
      cells: { box: [2, 3, 2, 2] as [number, number, number, number], runs: runsOf([1, 0, 0, 1]) },
    };
    expect(decodeCells(c.cells)).toEqual(Uint8Array.from([1, 0, 0, 1]));
    expect(shapeContains(c, 2.5, 3.5)).toBe(true);
    expect(shapeContains(c, 3.5, 3.5)).toBe(false);
    expect(shapeContains(c, 3.5, 4.5)).toBe(true);
    expect(shapeContains(c, 3, 4)).toBe(true); // the shared corner of both painted cells
    expect(shapeContains(c, 3, 3.5)).toBe(true); // the edge of (2, 3)
    expect(shapeContains(c, 4, 3.5)).toBe(false); // the east edge of the unpainted (3, 3)
    expect(shapeContains(c, 1.99, 3.5)).toBe(false);
    expect(shapeBox(c)).toEqual([2, 3, 4, 5]);
  });

  test("FR-FOG-01 painter order with brush shapes: reveal stroke over the base, fog cells over it", () => {
    const base = uniformMask("fog", [0, 0, 10, 10]);
    const shapes = [
      { op: "reveal" as const, stroke: [1, 1, 1, 8, 1] },
      {
        op: "fog" as const,
        cells: { box: [4, 0, 1, 3] as [number, number, number, number], runs: "3" },
      },
    ];
    expect(staticState(base, shapes, 2.5, 1.5)).toBe("clear");
    expect(staticState(base, shapes, 4.5, 1.5)).toBe("fog");
    expect(staticState(base, shapes, 2.5, 5.5)).toBe("fog");
  });
});

describe("FR-FOG-26 brush containment via area.ts (review A13)", () => {
  test("FR-FOG-26 stroke containment is area.ts's: same verdict on a 0.01 lattice around a stroke", () => {
    const stroke = [1.5, 2.25, 3.5, 6.75, 4, 7, 8.5];
    for (let x = 0; x <= 1000; x += 7) {
      for (let y = 100; y <= 1050; y += 7) {
        expect(shapeContains({ stroke }, x / 100, y / 100)).toBe(
          contains({ stroke }, x / 100, y / 100),
        );
      }
    }
  });

  test("FR-FOG-57 cellsOf / mergeCells: tight box, union, caps → null", () => {
    expect(cellsOf([])).toBeNull();
    const a = cellsOf([
      [3, 4],
      [4, 4],
    ]);
    expect(a).toEqual({ box: [3, 4, 2, 1], runs: "2" });
    const b = cellsOf([[5, 6]]);
    expect(b).toEqual({ box: [5, 6, 1, 1], runs: "1" });
    const m = mergeCells(a as NonNullable<typeof a>, b as NonNullable<typeof b>);
    expect(m?.box).toEqual([3, 4, 3, 3]);
    expect(paintedCells(m as NonNullable<typeof m>)).toEqual([
      [3, 4],
      [4, 4],
      [5, 6],
    ]);
    // Box over 128 → null (the server appends instead).
    expect(
      cellsOf([
        [0, 0],
        [CELLS_BOX_MAX, 0],
      ]),
    ).toBeNull();
    expect(
      cellsOf([
        [0, 0],
        [CELLS_BOX_MAX - 1, 0],
      ])?.box,
    ).toEqual([0, 0, CELLS_BOX_MAX, 1]);
    // Runs over 500 → null: a checkerboard row.
    const sparse = Array.from({ length: 64 }, (_, r) =>
      Array.from({ length: 8 }, (_, k) => [2 * k + (r % 2), r] as [number, number]),
    ).flat();
    expect(cellsOf(sparse)).toBeNull();
    expect(cellsOf(sparse.slice(0, 200))).not.toBeNull();
    expect(CELLS_RUNS_MAX).toBe(500);
  });
});
