import { describe, expect, test } from "bun:test";
import { distanceFt } from "@shared/scene-tools/geometry";
import type { TemplateGeometry } from "@shared/scene-tools/schemas";
import { sprint2TemplateCells } from "@shared/scene-tools/testing";
import {
  AREA_TOL,
  type AreaShape,
  areaBox,
  type Cell,
  cellCoverage,
  cells,
  contains,
  snapAngle,
  snapPoint,
  templateArea,
} from "./area";

const key = (cs: readonly Cell[]) => cs.map(([c, r]) => `${c},${r}`);
const tpl = (t: Partial<TemplateGeometry>): TemplateGeometry => ({
  shape: "cone",
  x: 0,
  y: 0,
  size: 15,
  angle: 0,
  ...t,
});
const half = (t: Partial<TemplateGeometry>) => cells(templateArea(tpl(t)), "half");

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

/** Brute force: the share of a cell from 64 × 64 sub-cell midpoints. */
function sampled(shape: AreaShape, col: number, row: number): number {
  let n = 0;
  for (let i = 0; i < 64; i++)
    for (let j = 0; j < 64; j++)
      if (contains(shape, col + (i + 0.5) / 64, row + (j + 0.5) / 64)) n++;
  return n / 4096;
}

function shapeArea(t: TemplateGeometry): number {
  const L = t.size / 5;
  if (t.shape === "sphere" || t.shape === "cylinder") return Math.PI * L * L;
  if (t.shape === "cube") return L * L;
  if (t.shape === "cone") return (L * L) / 2;
  return (L * (t.width ?? 5)) / 5;
}

function randomTemplate(r: () => number, maxFt: number): TemplateGeometry {
  const shapes = ["cone", "sphere", "cylinder", "cube", "line"] as const;
  return {
    shape: shapes[Math.floor(r() * shapes.length)] ?? "cone",
    x: Math.round((r() * 40 - 20) * 100) / 100,
    y: Math.round((r() * 40 - 20) * 100) / 100,
    size: 5 * (1 + Math.floor(r() * (maxFt / 5))),
    width: 5 * (1 + Math.floor(r() * 4)),
    angle: Math.round(r() * 3600) / 10,
  };
}

describe("FR-SCN-41 coverage", () => {
  test("FR-SCN-41 coverage 49 / 50 / 51 %: a 5-ft line east from (0, y0)", () => {
    expect(key(half({ shape: "line", size: 5, y: 6.99 }))).toEqual(["0,6"]);
    expect(key(half({ shape: "line", size: 5, y: 7.01 }))).toEqual(["0,7"]);
    // Both rows at exactly 50 %: only the one right of east (south) counts.
    const shares = cellCoverage(templateArea(tpl({ shape: "line", size: 5, y: 7 })));
    expect(shares.map((s) => s.share)).toEqual([0.5, 0.5]);
    expect(key(half({ shape: "line", size: 5, y: 7 }))).toEqual(["0,7"]);
    // The same line west: right of west is north.
    expect(key(half({ shape: "line", size: 5, x: 1, y: 7, angle: 180 }))).toEqual(["0,6"]);
  });

  test("FR-SCN-41 a sphere never takes a tie", () => {
    // A circle of area ½ inside one cell: exactly 50 % (closed form), not counted.
    const shape: AreaShape = { kind: "circle", x: 2.5, y: 3.5, r: Math.sqrt(0.5 / Math.PI) };
    const [only] = cellCoverage(shape);
    expect(only?.share).toBeCloseTo(0.5, 12);
    expect(cells(shape, "half")).toEqual([]);
  });

  test("FR-SCN-41 cube ties: the 10-ft cube at (0.5, 0.5), 0° = 3 squares", () => {
    const shape = templateArea(tpl({ shape: "cube", x: 0.5, y: 0.5, size: 10 }));
    const shares = cellCoverage(shape).map((s) => s.share);
    expect(shares.filter((s) => s === 1)).toHaveLength(1);
    expect(shares.filter((s) => s === 0.5)).toHaveLength(4);
    expect(shares.filter((s) => s === 0.25)).toHaveLength(4);
    expect(key(cells(shape, "half"))).toEqual(["0,1", "1,1", "1,2"]);
  });

  test("FR-SCN-41 cube ties: all 144 snapped cubes (5–30 ft × 24 angles), right of a centre line", () => {
    let ties = 0;
    let counted = 0;
    let squares = 0;
    let err = 0;
    for (let size = 5; size <= 30; size += 5)
      for (let angle = 0; angle < 360; angle += 15) {
        const shape = templateArea(tpl({ shape: "cube", size, angle }));
        const got = new Set(key(cells(shape, "half")));
        const s = size / 5;
        const a = (angle * Math.PI) / 180;
        const [ux, uy] = [Math.cos(a), Math.sin(a)];
        const [cx, cy] = [(s / 2) * (ux - uy), (s / 2) * (uy + ux)];
        for (const c of cellCoverage(shape)) {
          const k = `${c.col},${c.row}`;
          if (Math.abs(c.share - 0.5) > AREA_TOL) {
            expect(got.has(k)).toBe(c.share > 0.5);
            continue;
          }
          ties++;
          const px = c.col + 0.5 - cx;
          const py = c.row + 0.5 - cy;
          const right = ux * py - uy * px > 1e-9 || -uy * py - ux * px > 1e-9;
          expect(got.has(k)).toBe(right);
          if (right) counted++;
        }
        squares += got.size;
        err += Math.abs(got.size - s * s);
      }
    // Measured (the spec's prototype quoted 136 ties; see the build report).
    expect({ ties, counted, squares }).toEqual({ ties: 96, counted: 76, squares: 2200 });
    expect(err / 144).toBeCloseTo(0.444, 3);
  });

  test("FR-SCN-41 goldens", () => {
    // Thunderwave (mt-templates): 15-ft cube at (1.5, 10.5), 300°.
    expect(key(half({ shape: "cube", x: 1.5, y: 10.5, size: 15, angle: 300 }))).toEqual([
      "3,8",
      "2,9",
      "3,9",
      "4,9",
      "2,10",
      "3,10",
      "4,10",
      "3,11",
    ]);
    expect(key(half({ shape: "cone", x: 3.37, y: 7.64, size: 15, angle: 37.5 }))).toEqual([
      "4,8",
      "5,8",
      "4,9",
      "5,9",
    ]);
    // A snapped 30-ft line along a grid line: exactly 1 row (6 squares).
    expect(key(half({ shape: "line", x: 10, y: 7, size: 30 }))).toEqual([
      "10,7",
      "11,7",
      "12,7",
      "13,7",
      "14,7",
      "15,7",
    ]);
    expect(half({ shape: "sphere", x: 6.5, y: 9.25, size: 20 })).toHaveLength(48);
    // A 5-ft cone is half a cell: "0 squares".
    expect(half({ shape: "cone", x: 4, y: 4, size: 5 })).toEqual([]);
  });

  test("FR-SCN-41 exact area: shares sum to the area for 200 seeded freeform templates incl. 300 ft", () => {
    const r = rng(41);
    for (let i = 0; i < 200; i++) {
      const t = i < 10 ? { ...randomTemplate(r, 300), size: 300 } : randomTemplate(r, 300);
      const cov = cellCoverage(templateArea(t));
      const sum = cov.reduce((a, c) => a + c.share, 0);
      expect(Math.abs(sum - shapeArea(t))).toBeLessThan(1e-9 * Math.max(1, shapeArea(t)));
      expect(cov.every((c) => c.share > 0 && c.share <= 1)).toBe(true);
    }
  });

  test("FR-SCN-41 exact area matches a 64×64 sampled reference within 1/64 per cell", () => {
    const r = rng(7);
    for (let i = 0; i < 25; i++) {
      const shape = templateArea(randomTemplate(r, 20));
      const cov = new Map(cellCoverage(shape).map((c) => [`${c.col},${c.row}`, c.share]));
      const [x0, y0, x1, y1] = areaBox(shape);
      for (let row = Math.floor(y0) - 1; row <= Math.ceil(y1); row++)
        for (let col = Math.floor(x0) - 1; col <= Math.ceil(x1); col++) {
          const exact = cov.get(`${col},${row}`) ?? 0;
          expect(Math.abs(exact - sampled(shape, col, row))).toBeLessThanOrEqual(1 / 64);
        }
    }
  });

  test("FR-SCN-41 fully-inside fast path = clipping (the same outline as a polygon)", () => {
    const r = rng(11);
    for (let i = 0; i < 40; i++) {
      const t = randomTemplate(r, 60);
      if (t.shape === "sphere" || t.shape === "cylinder") continue;
      const shape = templateArea(t);
      const outline = polygonOf(t);
      const a = cellCoverage(shape);
      const b = new Map(
        cellCoverage({ polygon: outline }).map((c) => [`${c.col},${c.row}`, c.share]),
      );
      expect(a.length).toBe(b.size);
      for (const c of a)
        expect(Math.abs(c.share - (b.get(`${c.col},${c.row}`) ?? 0))).toBeLessThan(1e-9);
    }
  });
});

/** The template's outline, built independently of `area.ts` (FR-SCN-20). */
function polygonOf(t: TemplateGeometry): number[] {
  const L = t.size / 5;
  const a = (t.angle * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-uy, ux];
  const P = (along: number, across: number) => [
    t.x + along * ux + across * nx,
    t.y + along * uy + across * ny,
  ];
  if (t.shape === "cone") return [...P(0, 0), ...P(L, L / 2), ...P(L, -L / 2)];
  if (t.shape === "cube") return [...P(0, 0), ...P(L, 0), ...P(L, L), ...P(0, L)];
  const h = (t.width ?? 5) / 10;
  return [...P(0, h), ...P(L, h), ...P(L, -h), ...P(0, -h)];
}

describe("FR-SCN-42 helper", () => {
  test("FR-SCN-42 snapPoint: nearest vertex, or 0.01 cell with Ctrl", () => {
    expect(snapPoint({ x: 3.37, y: 7.64 }, false)).toEqual({ x: 3, y: 8 });
    expect(snapPoint({ x: 3.374, y: 7.6451 }, true)).toEqual({ x: 3.37, y: 7.65 });
    expect(Object.is(snapPoint({ x: -0.2, y: -0.001 }, false).x, 0)).toBe(true);
    expect(Object.is(snapPoint({ x: -0.2, y: -0.001 }, true).y, 0)).toBe(true);
  });

  test("FR-SCN-42 snapAngle: 15° steps, or 0.1° with Ctrl, in [0, 360)", () => {
    expect(snapAngle(37.4, false)).toBe(30);
    expect(snapAngle(37.5, false)).toBe(45);
    expect(snapAngle(353, false)).toBe(0);
    expect(snapAngle(-20, false)).toBe(345);
    expect(snapAngle(37.46, true)).toBe(37.5);
    expect(snapAngle(359.96, true)).toBe(0);
    expect(snapAngle(-0.04, true)).toBe(0);
    expect(snapAngle(359.94, true)).toBe(359.9);
  });

  test("FR-SCN-42 templateArea per shape", () => {
    expect(templateArea(tpl({ shape: "sphere", x: 1, y: 2, size: 20 }))).toEqual({
      kind: "circle",
      x: 1,
      y: 2,
      r: 4,
    });
    expect(templateArea(tpl({ shape: "cylinder", size: 10 }))).toMatchObject({
      kind: "circle",
      r: 2,
    });
    expect(templateArea(tpl({ shape: "cone", size: 15, angle: 37.5 }))).toMatchObject({
      kind: "cone",
      length: 3,
      angle: 37.5,
    });
    expect(templateArea(tpl({ shape: "line", size: 60 }))).toMatchObject({
      kind: "line",
      length: 12,
      width: 1,
    });
    expect(templateArea(tpl({ shape: "line", size: 60, width: 10 }))).toMatchObject({ width: 2 });
    expect(templateArea(tpl({ shape: "cube", size: 15, angle: 90 }))).toMatchObject({
      kind: "square",
      side: 3,
    });
  });

  test("FR-SCN-42 cube 0 / 90 / 180 / 270 = sprint 2's quadrants (SE / SW / NW / NE)", () => {
    const quad = (angle: number) => key(half({ shape: "cube", x: 12, y: 12, size: 10, angle }));
    expect(quad(0)).toEqual(["12,12", "13,12", "12,13", "13,13"]);
    expect(quad(90)).toEqual(["10,12", "11,12", "10,13", "11,13"]);
    expect(quad(180)).toEqual(["10,10", "11,10", "10,11", "11,11"]);
    expect(quad(270)).toEqual(["12,10", "13,10", "12,11", "13,11"]);
  });

  test("FR-SCN-42 centre mode = sprint 2's templateCells on every snapped template", () => {
    for (const shape of ["cone", "sphere", "cylinder", "line", "cube"] as const)
      for (let size = 5; size <= 60; size += 5)
        for (let angle = 0; angle < 360; angle += shape === "cube" ? 90 : 15)
          for (const width of shape === "line" ? [5, 10, 15] : [5]) {
            const t = tpl({ shape, x: 7, y: 9, size, angle, width });
            const old = key(sprint2TemplateCells(t));
            expect(key(cells(templateArea(t), "centre"))).toEqual(old);
          }
  });

  test("FR-SCN-42 distance = distanceFt ≤ r for both rules; radius 0 = its own cell", () => {
    for (const rule of ["5-10-5", "5"] as const)
      for (let ft = 0; ft <= 50; ft += 5) {
        const got = key(
          cells({ kind: "circle", x: 10.5, y: 4.5, r: ft / 5 }, "distance", { rule }),
        );
        const want: string[] = [];
        for (let row = -10; row <= 20; row++)
          for (let col = 0; col <= 21; col++)
            if (distanceFt({ col, row }, { col: 10, row: 4 }, rule) <= ft)
              want.push(`${col},${row}`);
        expect(got).toEqual(want);
      }
    expect(key(cells({ kind: "circle", x: 3.2, y: 4.9, r: 0 }, "distance"))).toEqual(["3,4"]);
    expect(cells({ kind: "circle", x: 3.5, y: 4.5, r: 1 }, "distance")).toHaveLength(9);
    expect(cells({ kind: "circle", x: 3.5, y: 4.5, r: 2 }, "distance")).toHaveLength(21);
    expect(cells({ kind: "circle", x: 3.5, y: 4.5, r: 2 }, "distance", { rule: "5" })).toHaveLength(
      25,
    );
    // FOG's circle geometry as is.
    expect(cells({ circle: [3.5, 4.5, 2] }, "distance")).toEqual(
      cells({ kind: "circle", x: 3.5, y: 4.5, r: 2 }, "distance"),
    );
  });

  test("FR-SCN-42 a stroke in distance mode = the union of its points' results", () => {
    const pts = [2.5, 2.5, 3.5, 2.5, 4.5, 3.5, 4.5, 4.5];
    const union = new Set<string>();
    for (let i = 0; i < pts.length; i += 2) {
      for (const k of key(
        cells({ kind: "circle", x: pts[i] ?? 0, y: pts[i + 1] ?? 0, r: 2 }, "distance"),
      )) {
        union.add(k);
      }
    }
    const got = key(cells({ stroke: [2, ...pts] }, "distance"));
    expect([...got].sort()).toEqual([...union].sort());
    expect(new Set(got).size).toBe(got.length);
  });

  test("FR-SCN-42 a stroke in centre mode = the union of its sampled points' circles", () => {
    const pts = [1.2, 1.3, 6.7, 2.1, 7.4, 6.9];
    const r = 1.5;
    const got = new Set(key(cells({ stroke: [r, ...pts] }, "centre")));
    const union = new Set<string>();
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [ax, ay, bx, by] = pts.slice(i, i + 4) as [number, number, number, number];
      for (let s = 0; s <= 1000; s++) {
        const c = {
          kind: "circle",
          x: ax + ((bx - ax) * s) / 1000,
          y: ay + ((by - ay) * s) / 1000,
          r,
        } as const;
        for (const k of key(cells(c, "centre"))) union.add(k);
      }
    }
    expect([...got].sort()).toEqual([...union].sort());
    // A single point = a circle.
    expect(cells({ stroke: [1.5, 4.2, 4.7] }, "centre")).toEqual(
      cells({ circle: [4.2, 4.7, 1.5] }, "centre"),
    );
  });

  test("FR-SCN-42 FOG geometry as is: rect, circle, non-convex polygon", () => {
    // Rect [0, 0, 1.5, 1]: (0, 0) full, (1, 0) a tie → counts only with an axis putting it right.
    expect(key(cells({ rect: [1.5, 1, 0, 0] }, "half"))).toEqual(["0,0"]);
    expect(
      key(cells({ rect: [0, 0, 1.5, 1] }, "half", { axis: { x: 0, y: 0, angle: 270 } })),
    ).toEqual(["0,0", "1,0"]);
    // Centre mode is boundary-inclusive (FR-FOG-26): (1.5, 0.5) lies on the edge.
    expect(key(cells({ rect: [0, 0, 1.5, 1] }, "centre"))).toEqual(["0,0", "1,0"]);
    expect(cells({ circle: [6.5, 9.25, 4] }, "half")).toEqual(
      half({ shape: "sphere", x: 6.5, y: 9.25, size: 20 }),
    );
    // An L-shaped (non-convex) polygon with a notch through cells.
    const L = { polygon: [0.5, 0.5, 6.25, 0.5, 6.25, 2.5, 2.5, 2.5, 2.5, 5.75, 0.5, 5.75] };
    const cov = cellCoverage(L);
    const area = 5.75 * 2 + 2 * 3.25;
    expect(Math.abs(cov.reduce((a, c) => a + c.share, 0) - area)).toBeLessThan(1e-9);
    for (const c of cov)
      expect(Math.abs(c.share - sampled(L, c.col, c.row))).toBeLessThanOrEqual(1 / 64);
    expect(key(cells(L, "half"))).not.toContain("3,3");
    expect(key(cells(L, "half"))).toContain("1,4");
    expect(key(cells(L, "centre"))).toContain("5,1");
    expect(key(cells(L, "centre"))).not.toContain("6,1");
  });

  test("FR-SCN-42 a stroke has no half mode; distance needs a circle or a stroke", () => {
    expect(() => cells({ stroke: [1, 0, 0, 3, 3] }, "half")).toThrow();
    expect(() => cellCoverage({ stroke: [1, 0, 0, 3, 3] })).toThrow();
    expect(() => cells(templateArea(tpl({ shape: "cone" })), "distance")).toThrow();
  });

  // "FR-SCN-42 coverage benchmark: a 300-ft sphere ≤ 3 ms (p95)": ./area.bench.ts.
});
