// Scene-tools geometry (SCN §13 unit rows): blocking, segments, template / door / prop cells,
// distance per rule. Goblin Ambush = 20 × 14 cells of 70 px.
import { describe, expect, test } from "bun:test";
import type { MapRect } from "@shared/scenes-map/geometry";
import {
  blockingSegments,
  type Cell,
  distanceFt,
  doorCells,
  moveBlocked,
  propCells,
  propDrawnSides,
  pxToVertex,
  segmentKey,
  segmentProblem,
  segmentsTouch,
  templateCells,
  vertexRange,
  vertexToPx,
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

  test("SCN §12 benchmark: 2,000 segments, p95 ≤ 1 ms per move", () => {
    const walls: Wall[] = Array.from({ length: 2000 }, (_, i) => [
      i + 1,
      (i * 7) % 200,
      (i * 13) % 140,
      ((i * 7) % 200) + 1,
      ((i * 13) % 140) + 2,
    ]);
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      blockingSegments(at(i % 200, 3), at((i * 3) % 200, 130), 1, walls, []);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)] as number).toBeLessThan(1);
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

  test("FR-SCN-21 line: length × width, centres on the edge count", () => {
    const line = all(tpl({ shape: "line", size: 30 }));
    expect(line).toHaveLength(12);
    expect(key(line)).toEqual(
      key(
        [0, 1, 2, 3, 4, 5].flatMap((c): Cell[] => [
          [c, -1],
          [c, 0],
        ]),
      ),
    );
    expect(all(tpl({ shape: "line", size: 30, width: 15 }))).toHaveLength(24);
    expect(all(tpl({ shape: "line", size: 30, width: null }))).toHaveLength(12);
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
