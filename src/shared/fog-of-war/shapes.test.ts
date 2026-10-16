// FOG v2 shapes (FOG §13 unit rows): FR-FOG-26 zod + validity + caps, FR-FOG-01 static state
// (painter order, boundary, base mask + shapes, legacy forms = sprint-2 raster cells).
import { describe, expect, test } from "bun:test";
import { cellFogged, uniformMask } from "./mask";
import { applyShape, polygonProblem } from "./raster";
import type { FogShape } from "./schemas";
import {
  circleSides,
  DARKNESS_MAX,
  DarknessShape,
  Dec2,
  FOG_ROW_BYTES_MAX,
  FOG_SHAPES_MAX,
  FogLayerShape,
  FogShapeGeom,
  inDarkness,
  legacyShape,
  normaliseShape,
  shapeBox,
  shapeContains,
  shapeEdges,
  shapeProblem,
  staticState,
} from "./shapes";

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

describe("FR-FOG-26 shapes", () => {
  test("FR-FOG-26 coordinates: ≤ 2 decimals, |v| ≤ 1,024", () => {
    expect(Dec2.safeParse(1.25).success).toBe(true);
    expect(Dec2.safeParse(-1024).success).toBe(true);
    expect(Dec2.safeParse(0.07).success).toBe(true);
    expect(Dec2.safeParse(1.255).success).toBe(false);
    expect(Dec2.safeParse(1024.01).success).toBe(false);
  });

  test("FR-FOG-26 zod: rect, polygon 3–64 vertices, circle r 0.5–60; strict", () => {
    expect(FogShapeGeom.safeParse({ rect: [0, 6, 3, 11] }).success).toBe(true);
    expect(FogShapeGeom.safeParse({ polygon: [0, 0, 1, 0, 1, 1] }).success).toBe(true);
    expect(FogShapeGeom.safeParse({ polygon: [0, 0, 1, 0] }).success).toBe(false);
    expect(FogShapeGeom.safeParse({ polygon: [0, 0, 1, 0, 1] }).success).toBe(false);
    expect(FogShapeGeom.safeParse({ polygon: Array(128).fill(1) }).success).toBe(true);
    expect(FogShapeGeom.safeParse({ polygon: Array(130).fill(1) }).success).toBe(false);
    expect(FogShapeGeom.safeParse({ circle: [12.5, 9, 1.5] }).success).toBe(true);
    expect(FogShapeGeom.safeParse({ circle: [1, 1, 0.4] }).success).toBe(false);
    expect(FogShapeGeom.safeParse({ circle: [1, 1, 60.5] }).success).toBe(false);
    expect(FogShapeGeom.safeParse({ rect: [0, 0, 1, 1], circle: [1, 1, 1] }).success).toBe(false);
    expect(FogLayerShape.safeParse({ op: "explored", rect: [0, 0, 1, 1] }).success).toBe(true);
    expect(FogLayerShape.safeParse({ op: "hide", rect: [0, 0, 1, 1] }).success).toBe(false);
    expect(DarknessShape.safeParse({ id: "d1", circle: [1, 1, 1.5] }).success).toBe(true);
    expect(DarknessShape.safeParse({ circle: [1, 1, 1.5] }).success).toBe(false);
    // `seenBy` is server-only: never valid on the wire.
    expect(DarknessShape.safeParse({ id: "d1", circle: [1, 1, 1.5], seenBy: [] }).success).toBe(
      false,
    );
  });

  test("FR-FOG-26 crossing / zero area → refused", () => {
    expect(shapeProblem({ polygon: [0, 0, 2, 2, 2, 0, 0, 2] })).toBe("crossing");
    expect(shapeProblem({ polygon: [0, 0, 1, 1, 2, 2] })).toBe("crossing");
    expect(shapeProblem({ polygon: [0, 0, 1, 0, 1, 1, 0, 0] })).toBe("crossing");
    expect(shapeProblem({ polygon: [0, 0, 2.5, 0, 0, 1.25] })).toBeNull();
    expect(shapeProblem({ polygon: [8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5] })).toBeNull();
    expect(shapeProblem({ rect: [1, 1, 1, 5] })).toBe("zero-area");
    expect(shapeProblem({ rect: [3, 5, 1, 1] })).toBeNull();
    expect(shapeProblem({ circle: [0, 0, 0.5] })).toBeNull();
  });

  test("FR-FOG-27 caps", () => {
    expect([FOG_SHAPES_MAX, DARKNESS_MAX, FOG_ROW_BYTES_MAX]).toEqual([100, 20, 16_384]);
  });

  test("FR-FOG-26 normalise, box, edges", () => {
    expect(normaliseShape({ rect: [3, 5, 1, 1] })).toEqual({ rect: [1, 1, 3, 5] });
    expect(shapeBox({ circle: [12.5, 9, 1.5] })).toEqual([11, 7.5, 14, 10.5]);
    expect(shapeBox({ polygon: [8.5, 0, 19.75, 0, 19.75, 4.5] })).toEqual([8.5, 0, 19.75, 4.5]);
    expect(shapeEdges({ rect: [0, 0, 2, 1] })).toHaveLength(4);
    // A circle's polygon circumscribes it (every edge outside), bulging ≤ 0.02 cell (+ rounding).
    for (const r of [0.5, 1.5, 3, 15, 60]) {
      const edges = shapeEdges({ circle: [12.5, 9, r] });
      expect(edges.length).toBe(circleSides(r));
      for (const [x1, y1, x2, y2] of edges) {
        const d = Math.hypot((x1 + x2) / 2 - 12.5, (y1 + y2) / 2 - 9);
        expect(d).toBeGreaterThanOrEqual(r);
        if (r <= 15) expect(Math.hypot(x1 - 12.5, y1 - 9) - r).toBeLessThan(0.04);
      }
    }
    expect([circleSides(1.5), circleSides(60)]).toEqual([20, 64]);
  });
});

describe("FR-FOG-01 static state", () => {
  const fogged = uniformMask("fog", [0, 0, 20, 14]);

  test("FR-FOG-01 boundary-inclusive containment; polygons even-odd", () => {
    expect(shapeContains({ rect: [0, 6, 3, 11] }, 3, 11)).toBe(true);
    expect(shapeContains({ rect: [0, 6, 3, 11] }, 3.01, 11)).toBe(false);
    expect(shapeContains({ circle: [12.5, 9, 1.5] }, 12.5, 10.5)).toBe(true);
    expect(shapeContains({ circle: [12.5, 9, 1.5] }, 12.5, 10.51)).toBe(false);
    const tri = { polygon: [8, 9, 13, 9, 8, 14] };
    expect(shapeContains(tri, 10.5, 11.5)).toBe(true); // on the diagonal
    expect(shapeContains(tri, 8, 9)).toBe(true); // a vertex
    expect(shapeContains(tri, 11, 12.01)).toBe(false);
    // Even-odd: a "C" shape's notch is outside.
    const c = { polygon: [0, 0, 4, 0, 4, 1, 1, 1, 1, 3, 4, 3, 4, 4, 0, 4] };
    expect(shapeContains(c, 2.5, 2)).toBe(false);
    expect(shapeContains(c, 0.5, 2)).toBe(true);
  });

  test("FR-FOG-01 painter order: base mask, then shapes in list order", () => {
    const shapes = [
      { op: "reveal" as const, rect: [0, 0, 10, 10] as [number, number, number, number] },
      { op: "explored" as const, rect: [2, 2, 4, 4] as [number, number, number, number] },
      { op: "fog" as const, circle: [3, 3, 0.5] as [number, number, number] },
    ];
    expect(staticState(fogged, [], 5.5, 5.5)).toBe("fog");
    expect(staticState(fogged, shapes, 5.5, 5.5)).toBe("clear");
    expect(staticState(fogged, shapes, 2.5, 2.5)).toBe("explored");
    expect(staticState(fogged, shapes, 3, 3)).toBe("fog");
    expect(staticState(fogged, shapes.slice(0, 2).reverse(), 2.5, 2.5)).toBe("clear");
    // Outside the box: the fill.
    expect(staticState(fogged, [], -3.5, 40.5)).toBe("fog");
    expect(staticState(uniformMask("clear", [0, 0, 2, 2]), [], 9.5, 9.5)).toBe("clear");
    // No row = every point clear (`maskOf(null)`'s empty clear mask).
    expect(staticState(uniformMask("clear", [0, 0, 0, 0]), [], 1.5, 1.5)).toBe("clear");
  });

  test("FR-FOG-28 in darkness iff inside any darkness shape", () => {
    const d = [
      { circle: [12.5, 9, 1.5] as [number, number, number] },
      { rect: [0, 0, 1, 1] as [number, number, number, number] },
    ];
    expect(inDarkness(d, 12.5, 8.5)).toBe(true);
    expect(inDarkness(d, 12.5, 6.5)).toBe(false);
    expect(inDarkness(d, 1, 1)).toBe(true);
    expect(inDarkness([], 1, 1)).toBe(false);
  });

  /** Sprint-2 raster vs v2 shape on cell centres, over a 30 × 30 box. */
  function sameCells(shape: FogShape) {
    const box: [number, number, number, number] = [-2, -2, 30, 30];
    const raster = applyShape(uniformMask("clear", box), "hide", shape).mask;
    const geom = legacyShape(shape);
    for (let r = -2; r < 28; r++)
      for (let c = -2; c < 28; c++) {
        const v2 = staticState(
          uniformMask("clear", box),
          [{ op: "fog", ...geom }],
          c + 0.5,
          r + 0.5,
        );
        expect([c, r, v2 === "fog"]).toEqual([c, r, cellFogged(raster, c, r)]);
      }
  }

  test("FR-FOG-01 legacy forms = sprint-2 cells (fog-ambush-partial edits)", () => {
    sameCells({ kind: "rect", c0: 0, r0: 3, c1: 7, r1: 11 });
    sameCells({
      kind: "polygon",
      points: [
        [8, 9],
        [13, 9],
        [8, 14],
      ],
    });
    // Whole fog-ambush-partial sequence on the Goblin Ambush mask (20 × 14, Fog all first).
    const edits: FogShape[] = [
      { kind: "rect", c0: 0, r0: 3, c1: 7, r1: 11 },
      {
        kind: "polygon",
        points: [
          [8, 9],
          [13, 9],
          [8, 14],
        ],
      },
    ];
    let mask = uniformMask("fog", [0, 0, 20, 14]);
    for (const e of edits) mask = applyShape(mask, "reveal", e).mask;
    const shapes = edits.map((e) => ({ op: "reveal" as const, ...legacyShape(e) }));
    const base = uniformMask("fog", [0, 0, 20, 14]);
    for (let r = 0; r < 14; r++)
      for (let c = 0; c < 20; c++) {
        const v2 = staticState(base, shapes, c + 0.5, r + 0.5);
        expect([c, r, v2 === "fog"]).toEqual([c, r, cellFogged(mask, c, r)]);
      }
  });

  test("FR-FOG-01 legacy forms = sprint-2 cells (random rects and simple polygons)", () => {
    const rand = rng(11);
    const int = (n: number) => Math.floor(rand() * n);
    for (let k = 0; k < 40; k++) {
      sameCells({ kind: "rect", c0: int(25), r0: int(25), c1: int(25), r1: int(25) });
    }
    let polys = 0;
    while (polys < 60) {
      const n = 3 + int(5);
      const points = Array.from({ length: n }, () => [int(26), int(26)] as [number, number]);
      if (polygonProblem(points) !== null) continue;
      expect(shapeProblem(legacyShape({ kind: "polygon", points }))).toBeNull();
      sameCells({ kind: "polygon", points });
      polys++;
    }
  });
});
