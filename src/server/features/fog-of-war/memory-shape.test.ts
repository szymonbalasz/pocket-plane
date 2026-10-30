// FR-FOG-37 (ADR-0076): the exact explored shape: it stops at walls, grows only for what is really
// new, drops rounding specks, survives a merge the library refuses, stops at its cap; old per-cell
// rows convert with their cells intact.
import { describe, expect, test } from "bun:test";
import { shapeArea, shapeHolds, shapeVertices } from "@shared/fog-of-war/explored";
import { encodeRuns } from "@shared/fog-of-war/mask";
import { EXPLORED_VERTICES_MAX, type ExploredShape } from "@shared/fog-of-war/schemas";
import { sightPolygon } from "@shared/fog-of-war/vision";
import { cellsToShape, growMemory } from "./memory-shape";
import { ringShape } from "./testing";

const square = (x: number, y: number, s = 2) => [x, y, x + s, y, x + s, y + s, x, y + s];
const grown = (prev: ExploredShape, ...polys: number[][]): ExploredShape => {
  const r = growMemory(prev, polys);
  if (r === null || "full" in r) throw new Error(`no growth: ${JSON.stringify(r)}`);
  return r.shape;
};

describe("FR-FOG-37 explored shape", () => {
  test("FR-FOG-37 memory stops at the wall, not at the cell edge: one cell split by a wall stays hidden behind it", () => {
    const edges: [number, number, number, number][] = [
      [0, 0, 10, 0],
      [10, 0, 10, 10],
      [10, 10, 0, 10],
      [0, 10, 0, 0],
    ];
    // A slightly off-axis wall through column 5.
    const wall: [number, number, number, number] = [5.3, 0, 5.35, 10];
    const poly = sightPolygon({ x: 2.5, y: 2.5 }, 199.8, [...edges, wall]) as number[];
    const shape = grown([], poly);
    expect(shapeHolds(shape, 5.2, 2.5)).toBe(true); // this side of the wall, cell (5, 2)
    expect(shapeHolds(shape, 5.5, 2.5)).toBe(false); // behind it, the same cell
    expect(shapeHolds(shape, 9, 9)).toBe(false);
  });

  test("FR-FOG-37 never shrinks: separate sights make pieces, overlapping ones merge", () => {
    const a = grown([], square(0, 0));
    expect(shapeArea(a)).toBeCloseTo(4, 6);
    const b = grown(a, square(10, 10));
    expect(b).toHaveLength(2);
    expect(shapeArea(b)).toBeCloseTo(8, 6);
    const c = grown(b, square(1, 0));
    expect(c).toHaveLength(2);
    expect(shapeArea(c)).toBeCloseTo(10, 6);
    for (const [x, y] of [
      [0.5, 0.5],
      [2.5, 0.5],
      [11, 11],
    ] as const) {
      expect(shapeHolds(c, x, y)).toBe(true);
    }
  });

  test("FR-FOG-37 nothing new = null, no write and no event: the same sight, one inside it, rounding noise along its edge", () => {
    const a = grown([], square(0, 0, 10));
    expect(growMemory(a, [square(0, 0, 10)])).toBeNull();
    expect(growMemory(a, [square(2, 2, 3)])).toBeNull();
    expect(growMemory(a, [[0, 0, 10.004, 0, 10.004, 10, 0, 10]])).toBeNull();
    expect(growMemory(a, [[-0.01, 3, 5, 3, 5, 4, -0.01, 4]])).toBeNull(); // a hairline past the edge
    expect(growMemory(a, [])).toBeNull();
  });

  test("FR-FOG-37 specks are dropped: a hole too small to see closes, a real hole stays", () => {
    // Two sights that leave a sliver between them, 0.01 wide.
    const left = grown([], [0, 0, 5, 0, 5, 10, 0, 10]);
    const both = grown(left, [5.01, 0, 10, 0, 10, 10, 5.01, 10], [5, 0, 5.01, 0, 5.01, 4, 5, 4]);
    expect(both.flat().every((r) => shapeArea([[r]]) > 0.05)).toBe(true);
    // A ring around a 2 × 2 room: the hole is real.
    const ring = grown(
      [],
      [0, 0, 10, 0, 10, 4, 0, 4],
      [0, 6, 10, 6, 10, 10, 0, 10],
      [0, 0, 4, 0, 4, 10, 0, 10],
      [6, 0, 10, 0, 10, 10, 6, 10],
    );
    expect(shapeHolds(ring, 5, 5)).toBe(false);
    expect(shapeHolds(ring, 1, 1)).toBe(true);
    expect(ring[0]).toHaveLength(2);
  });

  test("FR-FOG-37 a polygon the library refuses is skipped: the rest of the sight still joins, sight itself is not touched", () => {
    const bad = [Number.NaN, 0, 1, Number.NaN, 2, 2];
    const a = grown([], square(0, 0));
    const r = growMemory(a, [bad, square(5, 5)]);
    if (r === null || "full" in r) throw new Error("expected growth");
    expect(shapeHolds(r.shape, 6, 6)).toBe(true);
    expect(shapeHolds(r.shape, 1, 1)).toBe(true);
  });

  test("FR-FOG-37 at the vertex cap the memory stops growing", () => {
    const atCap = ringShape(EXPLORED_VERTICES_MAX);
    expect(shapeVertices(atCap)).toBe(EXPLORED_VERTICES_MAX);
    expect(growMemory(atCap, [square(500, 500)])).toEqual({ full: true });
    // A jagged sight that takes it over the cap: the row stays as it was.
    const saw: number[] = [];
    for (let i = 0; i <= EXPLORED_VERTICES_MAX; i++) saw.push(i / 10, i % 2);
    saw.push(EXPLORED_VERTICES_MAX / 10, 10, 0, 10);
    expect(growMemory([], [saw])).toEqual({ full: true });
  });

  test("ADR-0076 an old per-cell row converts: every explored cell stays whole, others stay out", () => {
    const m = new Uint8Array(20);
    for (const k of [1, 2, 6, 7, 18]) m[k] = 1;
    // Box at (3, 4), 5 × 4.
    const shape = cellsToShape({ box: [3, 4, 5, 4], runs: encodeRuns(m, "clear") });
    expect(shapeHolds(shape, 4.5, 4.5)).toBe(true); // index 1
    expect(shapeHolds(shape, 5.5, 5.5)).toBe(true); // index 7
    expect(shapeHolds(shape, 6.5, 7.5)).toBe(true); // index 18
    expect(shapeHolds(shape, 3.5, 4.5)).toBe(false); // index 0
    expect(shapeHolds(shape, 7.5, 7.5)).toBe(false); // index 19
    expect(shapeArea(shape)).toBeCloseTo(5, 6);
    expect(cellsToShape({ box: [0, 0, 2, 2], runs: "" })).toEqual([]);
  });
});
