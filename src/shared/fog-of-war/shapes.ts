// FOG v2 shapes (FR-FOG-01, -05, -26, -27, -28): fog-layer shapes and magical darkness in grid
// units (corner (i, j) = map point `offset + (i, j) × cellSize`; cell (c, r) covers
// [c, c + 1) × [r, r + 1), centre (c + ½, r + ½)). Numbers carry ≤ 2 decimals; containment tests
// run on 1/100-cell integers, so they are exact. Pure; shared by server and clients.
// Leaf module: imports only types (`./schemas` imports these zod shapes for the `fog` record).
import { z } from "zod";
import type { FogMask } from "./mask";

/** FR-FOG-26: |coord| ≤ 1,024. */
export const SHAPE_COORD_MAX = 1024;
/** FR-FOG-26: polygon 3–64 vertices. */
export const SHAPE_VERTICES_MIN = 3;
export const SHAPE_VERTICES_MAX = 64;
/** FR-FOG-26: circle radius 0.5–60 cells. */
export const CIRCLE_R_MIN = 0.5;
export const CIRCLE_R_MAX = 60;
/** FR-FOG-27 (OQ-FOG-35): ≤ 100 fog shapes, ≤ 20 darkness shapes, serialized row ≤ 16 KiB. */
export const FOG_SHAPES_MAX = 100;
export const DARKNESS_MAX = 20;
export const FOG_ROW_BYTES_MAX = 16 * 1024;
/** Most sides of the polygon a circle's edges are drawn as (occlusion, FR-FOG-33). */
export const CIRCLE_SIDES = 64;

/** ≤ 2 decimals (1/100 cell). */
export const isDec2 = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

/** FR-FOG-26: a coordinate, |v| ≤ 1,024, ≤ 2 decimals. */
export const Dec2 = z
  .number()
  .min(-SHAPE_COORD_MAX)
  .max(SHAPE_COORD_MAX)
  .refine(isDec2, "At most 2 decimals");

const Radius = z.number().min(CIRCLE_R_MIN).max(CIRCLE_R_MAX).refine(isDec2, "At most 2 decimals");

const rectField = { rect: z.tuple([Dec2, Dec2, Dec2, Dec2]) };
const polygonField = {
  polygon: z
    .array(Dec2)
    .min(2 * SHAPE_VERTICES_MIN)
    .max(2 * SHAPE_VERTICES_MAX)
    .refine((a) => a.length % 2 === 0, "Pairs of x, y"),
};
const circleField = { circle: z.tuple([Dec2, Dec2, Radius]) };

/** FR-FOG-26: `rect [x0, y0, x1, y1]` | `polygon [x, y, …]` | `circle [cx, cy, r]`. */
export const FogShapeGeom = z.union([
  z.strictObject(rectField),
  z.strictObject(polygonField),
  z.strictObject(circleField),
]);
export type FogShapeGeom = z.infer<typeof FogShapeGeom>;

/** FR-FOG-01: what a fog-layer shape paints. */
export const FOG_SHAPE_OPS = ["reveal", "fog", "explored"] as const;
export const FogShapeOp = z.enum(FOG_SHAPE_OPS);
export type FogShapeOp = z.infer<typeof FogShapeOp>;

/** FR-FOG-26: a fog-layer shape `{op, <shape>}`. */
export const FogLayerShape = z.union([
  z.strictObject({ op: FogShapeOp, ...rectField }),
  z.strictObject({ op: FogShapeOp, ...polygonField }),
  z.strictObject({ op: FogShapeOp, ...circleField }),
]);
export type FogLayerShape = z.infer<typeof FogLayerShape>;

const DarknessId = z.string().min(1).max(64);

/** FR-FOG-28: a darkness shape on the wire `{id, <shape>}` (never `seenBy`, FR-FOG-44). */
export const DarknessShape = z.union([
  z.strictObject({ id: DarknessId, ...rectField }),
  z.strictObject({ id: DarknessId, ...polygonField }),
  z.strictObject({ id: DarknessId, ...circleField }),
]);
export type DarknessShape = z.infer<typeof DarknessShape>;

/** FR-FOG-44: the stored darkness shape: + server-only `seenBy` (player ids). */
export type DarknessRow = DarknessShape & { seenBy?: string[] };

/** Any object carrying one shape key (fog shape, darkness shape, bare geometry). */
export type ShapeLike =
  | { rect: readonly number[] }
  | { polygon: readonly number[] }
  | { circle: readonly number[] };

/** `[x0, y0, x1, y1]`, x0 ≤ x1, y0 ≤ y1. */
export type Box = [x0: number, y0: number, x1: number, y1: number];

const S = (v: number) => Math.round(v * 100);

/** The geometry alone, rect corners normalised (x0 ≤ x1, y0 ≤ y1). */
export function normaliseShape(s: ShapeLike): FogShapeGeom {
  if ("rect" in s) {
    const [a, b, c, d] = s.rect as [number, number, number, number];
    return { rect: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)] };
  }
  if ("polygon" in s) return { polygon: [...s.polygon] };
  const [cx, cy, r] = s.circle as [number, number, number];
  return { circle: [cx, cy, r] };
}

type IP = readonly [number, number];
const cross = (o: IP, a: IP, b: IP) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const within = (p: IP, a: IP, b: IP) =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

function touch(a: IP, b: IP, c: IP, d: IP): boolean {
  const d1 = Math.sign(cross(c, d, a));
  const d2 = Math.sign(cross(c, d, b));
  const d3 = Math.sign(cross(a, b, c));
  const d4 = Math.sign(cross(a, b, d));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (
    (d1 === 0 && within(a, c, d)) ||
    (d2 === 0 && within(b, c, d)) ||
    (d3 === 0 && within(c, a, b)) ||
    (d4 === 0 && within(d, a, b))
  );
}

/** A flat polygon as 1/100-cell integer points. */
function scaledPoints(flat: readonly number[]): IP[] {
  const out: IP[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([S(flat[i] ?? 0), S(flat[i + 1] ?? 0)]);
  return out;
}

/**
 * FR-FOG-26: why a shape is refused (`invalid`), or null. Polygon: crossing = two non-adjacent
 * edges touch, adjacent edges fold back, or a repeated vertex; zero area. Rect: zero width or
 * height. Circles are valid by zod (r 0.5–60). Exact on 1/100-cell integers.
 */
export function shapeProblem(s: ShapeLike): "crossing" | "zero-area" | null {
  if ("rect" in s) {
    const [a, b, c, d] = s.rect.map(S) as [number, number, number, number];
    return a === c || b === d ? "zero-area" : null;
  }
  if ("circle" in s) return null;
  const pts = scaledPoints(s.polygon);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = pts[i] as IP;
      const q = pts[j] as IP;
      if (p[0] === q[0] && p[1] === q[1]) return "crossing";
    }
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i] as IP;
    const b = pts[(i + 1) % n] as IP;
    for (let j = i + 1; j < n; j++) {
      const c = pts[j] as IP;
      const d = pts[(j + 1) % n] as IP;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (!adjacent) {
        if (touch(a, b, c, d)) return "crossing";
        continue;
      }
      const shared = j === i + 1 ? b : a;
      const u = j === i + 1 ? a : b;
      const w = j === i + 1 ? d : c;
      if (
        cross(shared, u, w) === 0 &&
        (u[0] - shared[0]) * (w[0] - shared[0]) + (u[1] - shared[1]) * (w[1] - shared[1]) > 0
      ) {
        return "crossing";
      }
    }
  }
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as IP;
    const b = pts[(i + 1) % n] as IP;
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  return area2 === 0 ? "zero-area" : null;
}

/** A shape on 1/100-cell integers, normalised, for repeated containment tests. */
export interface PreparedShape {
  /** 0 rect `[x0, y0, x1, y1]`, 1 circle `[cx, cy, r]`, 2 polygon flat. */
  kind: 0 | 1 | 2;
  v: Float64Array;
  /** Bounding box in grid units. */
  box: Box;
}

export function prepareShape(s: ShapeLike): PreparedShape {
  if ("rect" in s) {
    const [a, b, c, d] = s.rect.map(S) as [number, number, number, number];
    const v = Float64Array.of(Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d));
    return { kind: 0, v, box: shapeBox(s) };
  }
  if ("circle" in s) return { kind: 1, v: Float64Array.from(s.circle, S), box: shapeBox(s) };
  return { kind: 2, v: Float64Array.from(s.polygon, S), box: shapeBox(s) };
}

/** `shapeContains` on a prepared shape, the point already on 1/100-cell integers. Exact. */
export function preparedContains(p: PreparedShape, px: number, py: number): boolean {
  const v = p.v;
  if (p.kind === 0) {
    return (
      (v[0] as number) <= px &&
      px <= (v[2] as number) &&
      (v[1] as number) <= py &&
      py <= (v[3] as number)
    );
  }
  if (p.kind === 1) {
    const dx = px - (v[0] as number);
    const dy = py - (v[1] as number);
    const r = v[2] as number;
    return dx * dx + dy * dy <= r * r;
  }
  const n = v.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = v[2 * i] as number;
    const ay = v[2 * i + 1] as number;
    const bx = v[2 * j] as number;
    const by = v[2 * j + 1] as number;
    // On the edge (boundary-inclusive).
    if (
      (bx - ax) * (py - ay) - (by - ay) * (px - ax) === 0 &&
      Math.min(ax, bx) <= px &&
      px <= Math.max(ax, bx) &&
      Math.min(ay, by) <= py &&
      py <= Math.max(ay, by)
    ) {
      return true;
    }
    if (ay > py !== by > py) {
      // x of the edge at py, compared exactly: px < ax + (py − ay)(bx − ax)/(by − ay).
      const lhs = (px - ax) * (by - ay);
      const rhs = (py - ay) * (bx - ax);
      if (by - ay > 0 ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside;
}

/**
 * FR-FOG-01: the point lies inside or on the shape (boundary-inclusive; polygons even-odd).
 * The point is compared at 1/100-cell resolution (cell centres and 2-decimal points are exact).
 */
export function shapeContains(s: ShapeLike | PreparedShape, x: number, y: number): boolean {
  const p = "kind" in s ? s : prepareShape(s);
  return preparedContains(p, S(x), S(y));
}

/** Bounding box `[x0, y0, x1, y1]` of a shape (FR-FOG-44 darkness filter). */
export function shapeBox(s: ShapeLike): Box {
  if ("rect" in s) {
    const [a, b, c, d] = s.rect as [number, number, number, number];
    return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  }
  if ("circle" in s) {
    const [cx, cy, r] = s.circle as [number, number, number];
    return [cx - r, cy - r, cx + r, cy + r];
  }
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < s.polygon.length; i += 2) {
    const x = s.polygon[i] as number;
    const y = s.polygon[i + 1] as number;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Segment `[x1, y1, x2, y2]` in grid units. */
export type ShapeEdge = [x1: number, y1: number, x2: number, y2: number];

/**
 * Sides of a circle's occluding polygon: enough that it bulges ≤ 0.02 cell past the circle
 * (`R (1 / cos(π / n) − 1) ≈ R π² / 2n²`), 16–64, a multiple of 4.
 */
export function circleSides(r: number): number {
  const n = Math.ceil(Math.PI * Math.sqrt(r / 0.04));
  return Math.min(CIRCLE_SIDES, Math.max(16, Math.ceil(n / 4) * 4));
}

/**
 * A shape's boundary as segments (FR-FOG-33: darkness edges occlude sources without
 * see-through). A circle is the regular polygon (`circleSides`) **circumscribing** it, rounded
 * outward to 1/100 cell, so the edges never let sight into the circle (fail closed).
 */
export function shapeEdges(s: ShapeLike): ShapeEdge[] {
  const ring = (pts: [number, number][]): ShapeEdge[] =>
    pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length] as [number, number];
      return [p[0], p[1], q[0], q[1]];
    });
  if ("rect" in s) {
    const [a, b, c, d] = shapeBox(s);
    return ring([
      [a, b],
      [c, b],
      [c, d],
      [a, d],
    ]);
  }
  if ("circle" in s) {
    const [cx, cy, r] = s.circle as [number, number, number];
    const n = circleSides(r);
    const R = r / Math.cos(Math.PI / n) + 0.01;
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      pts.push([
        Math.round((cx + R * Math.cos(a)) * 100) / 100,
        Math.round((cy + R * Math.sin(a)) * 100) / 100,
      ]);
    }
    return ring(pts);
  }
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < s.polygon.length; i += 2) {
    pts.push([s.polygon[i] as number, s.polygon[i + 1] as number]);
  }
  return ring(pts);
}

/** Sprint-2 `fog.edit` shapes (FR-FOG-05 legacy forms): cells and grid-corner polygons. */
export type LegacyShape =
  | { kind: "rect"; c0: number; r0: number; c1: number; r1: number }
  | { kind: "polygon"; points: readonly (readonly [number, number])[] };

/**
 * FR-FOG-05: a legacy form as a v2 shape. `{kind: rect, c0, r0, c1, r1}` (cells, inclusive) =
 * `rect [c0, r0, c1 + 1, r1 + 1]` (normalised first); `{kind: polygon, points}` = that polygon.
 * Same cells result: a cell's state is its centre's (FR-FOG-34).
 */
export function legacyShape(s: LegacyShape): FogShapeGeom {
  if (s.kind === "rect") {
    return {
      rect: [
        Math.min(s.c0, s.c1),
        Math.min(s.r0, s.r1),
        Math.max(s.c0, s.c1) + 1,
        Math.max(s.r0, s.r1) + 1,
      ],
    };
  }
  return { polygon: s.points.flat() };
}

/** FR-FOG-01: a point's static state. */
export type StaticState = "clear" | "fog" | "explored";

/** The base mask value of a cell (outside the box: `fill`), as `mask.ts` `cellFogged`. */
function baseFogged(mask: FogMask, col: number, row: number): boolean {
  const [col0, row0, cols, rows] = mask.box;
  const c = col - col0;
  const r = row - row0;
  if (c < 0 || r < 0 || c >= cols || r >= rows) return mask.fill === "fog";
  return mask.cells[r * cols + c] === 1;
}

/**
 * FR-FOG-01: the base mask value of the cell containing the point, then every shape containing
 * the point, in list order, overrides it (`reveal` → clear, `fog` → fog, `explored` → explored).
 */
export function staticState(
  mask: FogMask,
  shapes: readonly (ShapeLike & { op: FogShapeOp })[],
  x: number,
  y: number,
): StaticState {
  let state: StaticState = baseFogged(mask, Math.floor(x), Math.floor(y)) ? "fog" : "clear";
  for (const s of shapes) {
    if (!shapeContains(s, x, y)) continue;
    state = s.op === "reveal" ? "clear" : s.op;
  }
  return state;
}

/** FR-FOG-28: a point is in darkness iff inside (or on) any darkness shape. */
export function inDarkness(darkness: readonly ShapeLike[], x: number, y: number): boolean {
  return darkness.some((d) => shapeContains(d, x, y));
}
