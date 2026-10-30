// Scene-tools geometry (SCN §13 unit rows): blocking, segments, template / door / prop cells,
// distance per rule. Goblin Ambush = 20 × 14 cells of 70 px.
import { describe, expect, test } from "bun:test";
import type { MapRect } from "@shared/scenes-map/geometry";
import {
  blockingSegments,
  type Cell,
  distanceFt,
  doorCells,
  doorSamplePoints,
  moveBlocked,
  propCells,
  propDrawnSides,
  pxToVertex,
  segmentKey,
  segmentProblem,
  segmentsTouch,
  sightOccluders,
  templateCells,
  vertexRange,
  vertexToPx,
  wallHint,
  wallLeftByDoor,
} from "./geometry";
import type { Door, TemplateGeometry, Wall } from "./schemas";

const AMBUSH: MapRect = {
  mapWidth: 1400,
  mapHeight: 980,
  gridCellSize: 70,
  gridOffsetX: 0,
  gridOffsetY: 0,
};

/** `scn-walls`: walls at x = 8 for y 0–5, 6–11, 12–14; d1 (8, 5)–(8, 6); d2 (8, 11)–(8, 12). */
const WALLS: Wall[] = [
  [1, 8, 0, 8, 5],
  [2, 8, 6, 8, 11],
  [3, 8, 12, 8, 14],
];
const doors = (d1: 0 | 1 | 2, d2: 0 | 1 | 2 = 2): Door[] => [
  [4, 8, 5, 8, 6, d1, 0],
  [5, 8, 11, 8, 12, d2, 0],
];
const at = (col: number, row: number) => ({ col, row });

describe("FR-SCN-10 blocking", () => {
  test("FR-SCN-10 Mira (2, 7) → (10, 7) crosses the wall at x = 8", () => {
    expect(blockingSegments(at(2, 7), at(10, 7), 1, WALLS, doors(1))).toEqual([2]);
    expect(moveBlocked(at(10, 7), at(2, 7), 1, WALLS, doors(1))).toBe(true);
  });

  test("FR-SCN-10 open door passes; closed and locked block", () => {
    expect(moveBlocked(at(7, 5), at(9, 5), 1, WALLS, doors(0))).toBe(false);
    expect(blockingSegments(at(7, 5), at(9, 5), 1, WALLS, doors(1))).toEqual([4]);
    expect(blockingSegments(at(7, 11), at(9, 11), 1, WALLS, doors(0, 2))).toEqual([5]);
    expect(moveBlocked(at(7, 11), at(9, 11), 1, WALLS, doors(0, 0))).toBe(false);
  });

  test("FR-SCN-10 diagonal through a jamb touches the wall end and blocks, door open or not", () => {
    // (7.5, 4.5) → (9.5, 6.5) passes the vertex (8, 5), the end of wall 1.
    expect(blockingSegments(at(7, 4), at(9, 6), 1, WALLS, doors(0))).toContain(1);
  });

  test("FR-SCN-10 touching an endpoint counts; a near miss does not", () => {
    const w: Wall[] = [[1, 3, 3, 3, 5]];
    // (2.5, 5.5) → (3.5, 4.5) passes (3, 5) exactly.
    expect(moveBlocked(at(2, 5), at(3, 4), 1, w, [])).toBe(true);
    // (2.5, 6.5) → (3.5, 5.5) passes (3, 6): below the wall.
    expect(moveBlocked(at(2, 6), at(3, 5), 1, w, [])).toBe(false);
  });

  test("FR-SCN-10 collinear overlap counts (Large token centre on a grid line)", () => {
    // Large at (0, 0) → (0, 2): centres (1, 1) → (1, 3), along x = 1.
    expect(moveBlocked(at(0, 0), at(0, 2), 2, [[1, 1, 2, 1, 4]], [])).toBe(true);
    expect(moveBlocked(at(0, 0), at(0, 2), 2, [[1, 1, 4, 1, 6]], [])).toBe(false);
  });

  test("FR-SCN-10 Large token centre: (6, 6) → (8, 6) crosses x = 8 at y = 7", () => {
    expect(blockingSegments(at(6, 6), at(8, 6), 2, WALLS, doors(0))).toEqual([2]);
  });

  test("FR-SCN-10 an unmoved token crosses nothing", () => {
    expect(moveBlocked(at(0, 0), at(0, 0), 2, [[1, 1, 0, 1, 4]], [])).toBe(false);
  });

  test("FR-SCN-10 segmentsTouch: crossing, parallel, T-junction", () => {
    expect(segmentsTouch([0, 0], [4, 4], [0, 4], [4, 0])).toBe(true);
    expect(segmentsTouch([0, 0], [4, 0], [0, 1], [4, 1])).toBe(false);
    expect(segmentsTouch([0, 0], [4, 0], [2, 0], [2, 3])).toBe(true);
    expect(segmentsTouch([0, 0], [4, 0], [5, 0], [6, 0])).toBe(false);
  });

  // SCN §12 benchmark (2,000 segments, p95 ≤ 1 ms per move): ./geometry.bench.ts.
});

describe("FR-SCN-56 wallLeftByDoor", () => {
  test("FR-SCN-56 a door mid-wall leaves two pieces, each ending exactly on the door", () => {
    expect(wallLeftByDoor([8, 4, 8, 5], [8, 0, 8, 10])).toEqual([
      [8, 0, 8, 4],
      [8, 5, 8, 10],
    ]);
    // Either direction, door or wall.
    expect(wallLeftByDoor([8, 5, 8, 4], [8, 10, 8, 0])).toEqual([
      [8, 10, 8, 5],
      [8, 4, 8, 0],
    ]);
  });

  test("FR-SCN-56 a door at a wall's end leaves one piece; a door as long or longer leaves none", () => {
    expect(wallLeftByDoor([8, 0, 8, 1], [8, 0, 8, 10])).toEqual([[8, 1, 8, 10]]);
    expect(wallLeftByDoor([8, 0, 8, 10], [8, 0, 8, 10])).toEqual([]);
    expect(wallLeftByDoor([8, -1, 8, 11], [8, 0, 8, 10])).toEqual([]);
    // Overlapping one end only: the rest stays, the door's overhang adds nothing.
    expect(wallLeftByDoor([8, 9, 8, 12], [8, 0, 8, 10])).toEqual([[8, 0, 8, 9]]);
  });

  test("FR-SCN-56 hand-placed points: a slightly off wall still counts, and pieces join the door", () => {
    expect(wallLeftByDoor([9, 5, 10, 5], [7.01, 5, 14.01, 5.02])).toEqual([
      [7.01, 5, 9, 5],
      [10, 5, 14.01, 5.02],
    ]);
    expect(wallLeftByDoor([9.02, 5.15, 10, 5.12], [7, 5, 14, 5])).toEqual([
      [7, 5, 9.02, 5.15],
      [10, 5.12, 14, 5],
    ]);
  });

  test("FR-SCN-56 not under the door: too far off, too steep, crossing, or only touching an end", () => {
    // Parallel, 0.3 cell off.
    expect(wallLeftByDoor([8, 4, 8, 5], [8.3, 0, 8.3, 10])).toBeNull();
    // Crossing at a right angle; a corner stub steeper than 30°.
    expect(wallLeftByDoor([8, 4, 8, 5], [6, 4.5, 10, 4.5])).toBeNull();
    expect(wallLeftByDoor([0, 0, 2, 0], [0, 0, 0.15, 0.15])).toBeNull();
    // A door fitted into a gap only touches the walls either side.
    expect(wallLeftByDoor([8, 5, 8, 6], [8, 0, 8, 5])).toBeNull();
    expect(wallLeftByDoor([8, 5, 8, 6], [8, 6, 8, 11])).toBeNull();
    // Beyond the door along its line; less than 0.05 cell of overlap.
    expect(wallLeftByDoor([8, 5, 8, 6], [8, 7, 8, 9])).toBeNull();
    expect(wallLeftByDoor([8, 5, 8, 6], [8, 0, 8, 5.04])).toBeNull();
    // A gap door on hand-drawn walls: touches both, replaces neither.
    expect(wallLeftByDoor([5.99, 2.5, 7.05, 2.52], [3.51, 2.49, 5.99, 2.5])).toBeNull();
    expect(wallLeftByDoor([5.99, 2.5, 7.05, 2.52], [7.05, 2.52, 7.01, 5])).toBeNull();
  });

  test("FR-SCN-56 a piece under 0.05 cell is dropped", () => {
    expect(wallLeftByDoor([8, 0.04, 8, 2], [8, 0, 8, 3])).toEqual([[8, 2, 8, 3]]);
  });
});

describe("FR-SCN-07 segments", () => {
  test("FR-SCN-07 dedupe key is the same in both directions", () => {
    expect(segmentKey([1, 2, 3, 4])).toBe(segmentKey([3, 4, 1, 2]));
    expect(segmentKey([1, 4, 1, 2])).toBe(segmentKey([1, 2, 1, 4]));
    expect(segmentKey([1, 2, 3, 4])).not.toBe(segmentKey([1, 2, 3, 5]));
  });

  test("FR-SCN-07 length 0 and bounds (vertex range ± 1)", () => {
    expect(vertexRange(AMBUSH)).toEqual({ x0: 0, y0: 0, x1: 20, y1: 14 });
    expect(segmentProblem([3, 3, 3, 3], AMBUSH)).toBe("length");
    expect(segmentProblem([-1, -1, 21, 15], AMBUSH)).toBeNull();
    expect(segmentProblem([0, 0, 22, 0], AMBUSH)).toBe("bounds");
    expect(segmentProblem([0, -2, 0, 3], AMBUSH)).toBe("bounds");
    // An offset grid shifts the range: cells overlapping the map.
    expect(vertexRange({ ...AMBUSH, gridOffsetX: 30, gridOffsetY: -20 })).toEqual({
      x0: -1,
      y0: 0,
      x1: 20,
      y1: 15,
    });
  });

  test("vertex ↔ px snapping", () => {
    expect(vertexToPx({ ...AMBUSH, gridOffsetX: 10 }, { x: 2, y: 3 })).toEqual({ x: 150, y: 210 });
    expect(pxToVertex(AMBUSH, 104, 106)).toEqual({ x: 1, y: 2 });
    expect(pxToVertex(AMBUSH, -20, 0)).toEqual({ x: 0, y: 0 });
  });
});

const key = (cells: readonly Cell[]) => cells.map(([c, r]) => `${c},${r}`).sort();
const tpl = (t: Partial<TemplateGeometry> & Pick<TemplateGeometry, "shape">): TemplateGeometry => ({
  x: 0,
  y: 0,
  size: 15,
  angle: 0,
  ...t,
});
const all = (t: TemplateGeometry) => templateCells(t, AMBUSH, { cut: false });

describe("FR-SCN-21 templateCells", () => {
  test("FR-SCN-21 sphere / cylinder 15 ft: 32 cells, centre within 3 cells", () => {
    const s = all(tpl({ shape: "sphere", x: 3, y: 8 }));
    expect(s).toHaveLength(32);
    expect(key(s)).toContain("3,8");
    expect(key(s)).toContain("0,8");
    expect(key(s)).not.toContain("0,5");
    expect(key(all(tpl({ shape: "cylinder", x: 3, y: 8 })))).toEqual(key(s));
    expect(all(tpl({ shape: "sphere", size: 5 }))).toHaveLength(4);
  });

  test("FR-SCN-21 cube: the origin is a corner, the angle picks the quadrant", () => {
    const cube = (angle: number) => key(all(tpl({ shape: "cube", x: 12, y: 12, size: 10, angle })));
    expect(cube(0)).toEqual(
      key([
        [12, 12],
        [13, 12],
        [12, 13],
        [13, 13],
      ]),
    );
    expect(cube(90)).toEqual(
      key([
        [10, 12],
        [11, 12],
        [10, 13],
        [11, 13],
      ]),
    );
    expect(cube(180)).toEqual(
      key([
        [10, 10],
        [11, 10],
        [10, 11],
        [11, 11],
      ]),
    );
    expect(cube(270)).toEqual(
      key([
        [12, 10],
        [13, 10],
        [12, 11],
        [13, 11],
      ]),
    );
  });

  test("FR-SCN-21 cone 15 ft: width at distance d = d", () => {
    expect(key(all(tpl({ shape: "cone" })))).toEqual(
      key([
        [1, 0],
        [1, -1],
        [2, 0],
        [2, -1],
      ]),
    );
    expect(key(all(tpl({ shape: "cone", angle: 90 })))).toEqual(
      key([
        [0, 1],
        [-1, 1],
        [0, 2],
        [-1, 2],
      ]),
    );
    expect(all(tpl({ shape: "cone", size: 30 })).length).toBeGreaterThan(4);
  });

  test("FR-SCN-21 line: length × width; a row at exactly 50 % counts right of the direction only", () => {
    const line = all(tpl({ shape: "line", size: 30 }));
    // East along the grid line y = 0: rows -1 and 0 are each 50 % covered; south (right) wins.
    expect(key(line)).toEqual(key([0, 1, 2, 3, 4, 5].map((c): Cell => [c, 0])));
    const west = all(tpl({ shape: "line", size: 30, angle: 180 }));
    expect(key(west)).toEqual(key([-1, -2, -3, -4, -5, -6].map((c): Cell => [c, -1])));
    // 15 ft wide: rows -1, 0 full; -2 and 1 at 50 % → only row 1 (right of east).
    expect(all(tpl({ shape: "line", size: 30, width: 15 }))).toHaveLength(18);
    expect(all(tpl({ shape: "line", size: 30, width: null }))).toHaveLength(6);
  });

  test("FR-SCN-21 every angle step: +90° rotates the cells about the origin vertex", () => {
    for (const shape of ["cone", "line"] as const) {
      for (let angle = 0; angle < 360; angle += 15) {
        const t = tpl({ shape, x: 5, y: 5, size: 30, width: 10, angle });
        const cells = all(t);
        expect(cells.length).toBeGreaterThan(0);
        const rotated = cells.map(([c, r]): Cell => [t.x - (r - t.y) - 1, t.y + (c - t.x)]);
        expect(key(all({ ...t, angle: (angle + 90) % 360 }))).toEqual(key(rotated));
      }
    }
  });

  test("FR-SCN-41 goldens through templateCells (exact area, one-side ties)", () => {
    const cut = (t: TemplateGeometry) => key(templateCells(t, AMBUSH, { cut: true }));
    const thunderwave = tpl({ shape: "cube", x: 1.5, y: 10.5, size: 15, angle: 300 });
    expect(cut(thunderwave)).toEqual(
      key([
        [3, 8],
        [2, 9],
        [3, 9],
        [4, 9],
        [2, 10],
        [3, 10],
        [4, 10],
        [3, 11],
      ]),
    );
    expect(cut(tpl({ shape: "cone", x: 3.37, y: 7.64, size: 15, angle: 37.5 }))).toEqual(
      key([
        [4, 8],
        [5, 8],
        [4, 9],
        [5, 9],
      ]),
    );
    expect(cut(tpl({ shape: "line", x: 10, y: 7, size: 30 }))).toEqual(
      key([10, 11, 12, 13, 14, 15].map((c): Cell => [c, 7])),
    );
    expect(cut(tpl({ shape: "sphere", x: 6.5, y: 9.25, size: 20 }))).toHaveLength(48);
    expect(cut(tpl({ shape: "cube", x: 0.5, y: 0.5, size: 10 }))).toEqual(
      key([
        [1, 1],
        [0, 1],
        [1, 2],
      ]),
    );
    // Row-major order (the client's `cells` attr).
    expect(templateCells(thunderwave, AMBUSH, { cut: true })[0]).toEqual([3, 8]);
  });

  test("FR-SCN-46 a template covering no cell: 0 squares drawn; uncut (derive) samples its origin's cell", () => {
    const cone5 = tpl({ shape: "cone", x: 3.37, y: 7.64, size: 5, angle: 37.5 });
    expect(templateCells(cone5, AMBUSH, { cut: true })).toEqual([]);
    expect(templateCells(cone5, AMBUSH, { cut: false })).toEqual([[3, 7]]);
    const snapped = tpl({ shape: "cone", x: 4, y: 7, size: 5 });
    expect(templateCells(snapped, AMBUSH, { cut: false })).toEqual([[4, 7]]);
    // Off the map: still the origin's cell (fog keeps a copy after a map change).
    expect(templateCells({ ...cone5, x: -3.5, y: -0.25 }, AMBUSH, { cut: false })).toEqual([
      [-4, -1],
    ]);
  });

  test("FR-SCN-21 cut keeps cells on the map; uncut keeps all", () => {
    const t = tpl({ shape: "sphere", x: 0, y: 0 });
    expect(templateCells(t, AMBUSH, { cut: false })).toHaveLength(32);
    const cut = templateCells(t, AMBUSH, { cut: true });
    expect(cut).toHaveLength(8);
    expect(cut.every(([c, r]) => c >= 0 && r >= 0)).toBe(true);
  });
});

describe("FR-SCN-36 doorCells", () => {
  test("FR-SCN-36 axis-aligned: the cells on either side", () => {
    expect(doorCells([8, 5, 8, 6])).toEqual([
      [7, 5],
      [8, 5],
    ]);
    expect(doorCells([4, 3, 2, 3])).toEqual([
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ]);
  });

  test("FR-SCN-36 diagonal: the cells it passes through (not a corner touch)", () => {
    expect(doorCells([0, 0, 2, 2])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(doorCells([2, 1, 0, 0])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
});

describe("FR-SCN-18 prop footprint", () => {
  test("FR-SCN-18 footprint = w × h; 90° / 270° swap the drawn sides only", () => {
    const p = { col: 4, row: 11, w: 2, h: 1 };
    for (const rotation of [0, 90, 180, 270]) {
      expect(propCells(p)).toEqual({ col: 4, row: 11, w: 2, h: 1 });
      expect(propDrawnSides({ ...p, rotation })).toEqual(
        rotation % 180 === 0 ? { w: 2, h: 1 } : { w: 1, h: 2 },
      );
    }
  });
});

describe("FR-SCN-30 distance per rule", () => {
  test("FR-SCN-30 5/10/5 (default) and 5 ft", () => {
    expect(distanceFt(at(2, 7), at(5, 9))).toBe(20);
    expect(distanceFt(at(2, 7), at(5, 9), "5-10-5")).toBe(20);
    expect(distanceFt(at(2, 7), at(5, 9), "5")).toBe(15);
    expect(distanceFt(at(0, 0), at(4, 4), "5-10-5")).toBe(30);
    expect(distanceFt(at(0, 0), at(4, 4), "5")).toBe(20);
    expect(distanceFt(at(3, 3), at(3, 3), "5")).toBe(0);
  });
});

// ---------- sprint 3 (SCN §13 unit, sprint 3 row) ----------

/** `vision-crypt`'s freeform wall. */
const FREE: Wall = [6, 4.5, 3.25, 6.75, 5.5];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type V = readonly [bigint, bigint];

/** Rational reference: the segments touch, exact in BigInt on 1/200-cell units. */
function touchRef(
  from: { col: number; row: number },
  to: { col: number; row: number },
  n: number,
  s: readonly number[],
): boolean {
  const B = (v: number) => BigInt(Math.round(v * 200));
  const p: V = [BigInt(200 * from.col + 100 * n), BigInt(200 * from.row + 100 * n)];
  const q: V = [BigInt(200 * to.col + 100 * n), BigInt(200 * to.row + 100 * n)];
  const r: V = [B(s[0] as number), B(s[1] as number)];
  const t: V = [B(s[2] as number), B(s[3] as number)];
  const o = (a: V, b: V, c: V) => {
    const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return v > 0n ? 1 : v < 0n ? -1 : 0;
  };
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const max = (a: bigint, b: bigint) => (a > b ? a : b);
  const on = (a: V, b: V, c: V) =>
    min(a[0], b[0]) <= c[0] &&
    c[0] <= max(a[0], b[0]) &&
    min(a[1], b[1]) <= c[1] &&
    c[1] <= max(a[1], b[1]);
  const o1 = o(p, q, r);
  const o2 = o(p, q, t);
  const o3 = o(r, t, p);
  const o4 = o(r, t, q);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    (o1 === 0 && on(p, q, r)) ||
    (o2 === 0 && on(p, q, t)) ||
    (o3 === 0 && on(r, t, p)) ||
    (o4 === 0 && on(r, t, q))
  );
}

/** The sprint-2 rule (doubled integer coordinates), for integer data. */
function sprint2Blocked(
  from: { col: number; row: number },
  to: { col: number; row: number },
  n: number,
  w: Wall,
): boolean {
  if (from.col === to.col && from.row === to.row) return false;
  return segmentsTouch(
    [2 * from.col + n, 2 * from.row + n],
    [2 * to.col + n, 2 * to.row + n],
    [2 * w[1], 2 * w[2]],
    [2 * w[3], 2 * w[4]],
  );
}

describe("FR-SCN-07 decimals (sprint 3)", () => {
  test("FR-SCN-07 decimals: min length 0.05; integers unchanged", () => {
    expect(segmentProblem([4.5, 3.25, 6.75, 5.5], AMBUSH)).toBeNull();
    expect(segmentProblem([1, 1, 1.05, 1], AMBUSH)).toBeNull();
    expect(segmentProblem([1, 1, 1.04, 1], AMBUSH)).toBe("length");
    expect(segmentProblem([1, 1, 1.03, 1.04], AMBUSH)).toBeNull(); // length 0.05
    expect(segmentProblem([1, 1, 1.03, 1.03], AMBUSH)).toBe("length");
    expect(segmentProblem([3, 3, 3, 3], AMBUSH)).toBe("length");
  });

  test("FR-SCN-07 dedupe with decimals, both directions", () => {
    expect(segmentKey([4.5, 3.25, 6.75, 5.5])).toBe(segmentKey([6.75, 5.5, 4.5, 3.25]));
    expect(segmentKey([4.5, 3.25, 6.75, 5.5])).not.toBe(segmentKey([4.5, 3.25, 6.75, 5.51]));
  });
});

describe("FR-SCN-10 blocking on freeform segments (sprint 3)", () => {
  test("FR-SCN-10 crossing at a decimal point; touching a free endpoint; collinear", () => {
    // Mira (2, 7) → (6, 3): (2.5, 7.5) → (6.5, 3.5) crosses the freeform wall at (5.625, 4.375).
    expect(blockingSegments(at(2, 7), at(6, 3), 1, [FREE], [])).toEqual([6]);
    // Mira (2, 7) → (7, 5): the line meets the freeform wall's line at x 6.96, past its end.
    expect(blockingSegments(at(2, 7), at(7, 5), 1, [FREE], [])).toEqual([]);
    // A free endpoint exactly on the path: (0.5, 0.5) → (4.5, 0.5) touches (2.25, 0.5).
    expect(blockingSegments(at(0, 0), at(4, 0), 1, [[1, 2.25, 0.5, 2.75, 1.75]], [])).toEqual([1]);
    expect(blockingSegments(at(0, 0), at(4, 0), 1, [[1, 2.25, 0.51, 2.75, 1.75]], [])).toEqual([]);
    // Collinear free segment on the path, and one past its end.
    expect(blockingSegments(at(0, 0), at(4, 0), 1, [[1, 1.25, 0.5, 2.75, 0.5]], [])).toEqual([1]);
    expect(blockingSegments(at(0, 0), at(4, 0), 1, [[1, 4.75, 0.5, 6.75, 0.5]], [])).toEqual([]);
  });

  test("FR-SCN-10 scaled integer math = rational reference on 10k random cases", () => {
    const rand = rng(2026);
    const dec = (span: number) => Math.round((rand() * 2 - 1) * span * 100) / 100;
    const cell = (span: number) => Math.floor((rand() * 2 - 1) * span);
    let blocked = 0;
    for (let k = 0; k < 10_000; k++) {
      // Wide-range cases and dense local ones (half-cell points: touches and collinear cases).
      const span = k % 2 === 0 ? 1000 : 6;
      const from = at(cell(span), cell(span));
      const to = at(cell(span), cell(span));
      const n = 1 + Math.floor(rand() * 4);
      const half = () => Math.round(dec(span) * 2) / 2;
      const w: Wall =
        k % 4 === 1
          ? [1, half(), half(), half(), half()]
          : [1, dec(span), dec(span), dec(span), dec(span)];
      const want =
        from.col === to.col && from.row === to.row ? false : touchRef(from, to, n, w.slice(1));
      if (want) blocked++;
      expect([k, blockingSegments(from, to, n, [w], []).length > 0]).toEqual([k, want]);
    }
    expect(blocked).toBeGreaterThan(500);
  });

  test("FR-SCN-10 same result as the sprint-2 rule on integer data", () => {
    const rand = rng(7);
    const int = (n: number) => Math.floor(rand() * n);
    for (let k = 0; k < 5000; k++) {
      const from = at(int(20), int(14));
      const to = at(int(20), int(14));
      const n = 1 + int(3);
      const w: Wall = [1, int(21), int(15), int(21), int(15)];
      expect(blockingSegments(from, to, n, [w], []).length > 0).toBe(
        sprint2Blocked(from, to, n, w),
      );
    }
  });
});

describe("FR-SCN-37 sightOccluders", () => {
  test("FR-SCN-37 walls + doors not open; open doors excluded", () => {
    expect(sightOccluders({ walls: WALLS, doors: doors(0, 1) })).toEqual([
      [8, 0, 8, 5],
      [8, 6, 8, 11],
      [8, 12, 8, 14],
      [8, 11, 8, 12],
    ]);
    expect(sightOccluders({ walls: [], doors: doors(1, 2) })).toEqual([
      [8, 5, 8, 6],
      [8, 11, 8, 12],
    ]);
  });
});

describe("FR-SCN-38 wall hint", () => {
  const ALL = [...WALLS, FREE];
  test("FR-SCN-38 Mira (2, 7) → (10, 7): one piece [8, 7, 8, 8] (±0.5 around (8, 7.5))", () => {
    expect(wallHint(at(2, 7), at(10, 7), 1, ALL, doors(1))).toEqual([8, 7, 8, 8]);
  });

  test("FR-SCN-38 several crossings → only the first from `from`", () => {
    // (2.5, 7.5) → (9.5, 1.5) meets the freeform wall at ≈ (5.87, 4.62), then x = 8 at ≈ 2.79.
    const piece = wallHint(at(2, 7), at(9, 1), 1, ALL, doors(1));
    expect(piece).not.toBeNull();
    const [x1, y1, x2, y2] = piece as [number, number, number, number];
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(1, 1);
    expect((x1 + x2) / 2).toBeCloseTo(5.87, 1);
    expect((y1 + y2) / 2).toBeCloseTo(4.62, 1);
    // On the freeform wall's line.
    expect(Math.abs((x1 - 4.5) * (5.5 - 3.25) - (y1 - 3.25) * (6.75 - 4.5))).toBeLessThan(0.03);
  });

  test("FR-SCN-38 clipped to the segment's ends; nothing crossed → null; open door → null", () => {
    // Crossing the door d1 (8, 5)–(8, 6) at (8, 5.5): the piece is the whole door.
    expect(wallHint(at(7, 5), at(9, 5), 1, WALLS, doors(1))).toEqual([8, 5, 8, 6]);
    expect(wallHint(at(7, 5), at(9, 5), 1, WALLS, doors(0))).toBeNull();
    expect(wallHint(at(2, 7), at(7, 5), 1, ALL, doors(1))).toBeNull();
    expect(wallHint(at(2, 7), at(2, 7), 1, ALL, doors(1))).toBeNull();
    // Crossing (8, 0.5) of the wall (8, 0)–(8, 5): clipped at its end.
    expect(wallHint(at(7, 0), at(9, 0), 1, [[1, 8, 0, 8, 5]], [])).toEqual([8, 0, 8, 1]);
  });

  test("FR-SCN-38 collinear overlap: the overlap point nearest `from`", () => {
    expect(wallHint(at(0, 0), at(4, 0), 1, [[1, 2.25, 0.5, 6.75, 0.5]], [])).toEqual([
      2.25, 0.5, 2.75, 0.5,
    ]);
  });
});

describe("FR-SCN-36 door sample points (sprint 3)", () => {
  test("FR-SCN-36 integer doors = doorCells centres (axis and diagonal)", () => {
    expect(doorSamplePoints([8, 5, 8, 6])).toEqual([
      [7.5, 5.5],
      [8.5, 5.5],
    ]);
    expect(doorSamplePoints([0, 0, 2, 2])).toEqual([
      [0.5, 0.5],
      [1.5, 1.5],
    ]);
  });

  test("FR-SCN-36 freeform: 2 points per cell-length piece, 0.5 cell either side", () => {
    const pts = doorSamplePoints([12.4, 3.65, 13.1, 4.8]);
    // Length ≈ 1.35 → 2 pieces → 4 points.
    expect(pts).toHaveLength(4);
    const [a, b] = pts as [[number, number], [number, number]];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(1, 9);
    // The pair's midpoint = the first piece's midpoint (t = 0.25).
    expect((a[0] + b[0]) / 2).toBeCloseTo(12.4 + 0.25 * 0.7, 9);
    expect((a[1] + b[1]) / 2).toBeCloseTo(3.65 + 0.25 * 1.15, 9);
    expect(doorSamplePoints([1.5, 1, 2, 1])).toHaveLength(2);
  });
});
