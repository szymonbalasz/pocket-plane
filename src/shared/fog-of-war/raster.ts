// Shape raster (FR-FOG-05): which box cells a rectangle or polygon affects, and applying an edit
// to a mask. Polygon vertices sit on grid corners: corner (i, j) is the top-left of cell (i, j),
// so cell (c, r)'s centre is (c + ½, r + ½). A cell is affected iff its centre lies inside the
// polygon or on its boundary (scanline, even-odd). Centres have half-integer `y` and vertices
// integer `y`, so a scanline never passes through a vertex; bounds are exact (integer math).
import type { FogMask } from "./mask";
import type { FogOp, FogPolygon, FogShape } from "./schemas";

type Pt = readonly [number, number];

const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const onSegment = (p: Pt, a: Pt, b: Pt) =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

/** Closed segments ab and cd share at least one point. */
function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && onSegment(a, c, d)) ||
    (d2 === 0 && onSegment(b, c, d)) ||
    (d3 === 0 && onSegment(c, a, b)) ||
    (d4 === 0 && onSegment(d, a, b))
  );
}

/** Twice the signed area (shoelace). */
function area2(points: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Pt;
    const b = points[(i + 1) % points.length] as Pt;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/**
 * FR-FOG-05: why a polygon is refused (`invalid`), or null. Crossing = two non-adjacent edges
 * touch, two adjacent edges overlap beyond their shared vertex, or a repeated vertex.
 */
export function polygonProblem(points: readonly Pt[]): "crossing" | "zero-area" | null {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = points[i] as Pt;
      const q = points[j] as Pt;
      if (p[0] === q[0] && p[1] === q[1]) return "crossing";
    }
  }
  for (let i = 0; i < n; i++) {
    const a = points[i] as Pt;
    const b = points[(i + 1) % n] as Pt;
    for (let j = i + 1; j < n; j++) {
      const c = points[j] as Pt;
      const d = points[(j + 1) % n] as Pt;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (!adjacent) {
        if (segmentsTouch(a, b, c, d)) return "crossing";
        continue;
      }
      // Adjacent: they share one vertex; collinear and pointing back = overlap.
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
  return area2(points) === 0 ? "zero-area" : null;
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const ceilDiv = (a: number, b: number) => Math.ceil(a / b);

/**
 * Cells of row `r` whose centres lie inside or on the polygon: inclusive `[cMin, cMax]` spans.
 * Exact: crossing x = P / D; `c + ½ ≥ P / D` ⟺ `c ≥ (2P − D) / 2D`.
 */
function rowSpans(points: readonly Pt[], r: number): [number, number][] {
  const y2 = 2 * r + 1; // 2 × the centre's y
  const xs: { p: number; d: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i] as Pt;
    const [bx, by] = points[(i + 1) % points.length] as Pt;
    if (ay === by) continue;
    const lo = Math.min(ay, by);
    const hi = Math.max(ay, by);
    if (y2 <= 2 * lo || y2 >= 2 * hi) continue;
    // x = ax + (y − ay)(bx − ax)/(by − ay), with y = y2 / 2 → P / D, D > 0.
    let d = 2 * (by - ay);
    let p = 2 * ax * (by - ay) + (y2 - 2 * ay) * (bx - ax);
    if (d < 0) {
      d = -d;
      p = -p;
    }
    xs.push({ p, d });
  }
  xs.sort((a, b) => a.p * b.d - b.p * a.d);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i] as { p: number; d: number };
    const b = xs[i + 1] as { p: number; d: number };
    const cMin = ceilDiv(2 * a.p - a.d, 2 * a.d);
    const cMax = floorDiv(2 * b.p - b.d, 2 * b.d);
    if (cMin <= cMax) spans.push([cMin, cMax]);
  }
  return spans;
}

/** Calls `visit(col, row)` for every cell of the shape (unclipped, FR-FOG-05). */
export function forEachShapeCell(shape: FogShape, visit: (col: number, row: number) => void): void {
  if (shape.kind === "rect") {
    const c0 = Math.min(shape.c0, shape.c1);
    const c1 = Math.max(shape.c0, shape.c1);
    const r0 = Math.min(shape.r0, shape.r1);
    const r1 = Math.max(shape.r0, shape.r1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) visit(c, r);
    return;
  }
  const pts = (shape as FogPolygon).points;
  const ys = pts.map((p) => p[1]);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  for (let r = top; r < bottom; r++) {
    for (const [cMin, cMax] of rowSpans(pts, r)) for (let c = cMin; c <= cMax; c++) visit(c, r);
  }
}

/**
 * Applies `op` over the shape's cells inside the mask's box (cells outside are ignored). Returns
 * a new mask and whether any cell changed (FR-FOG-05: no change → no event). The caller has
 * validated the polygon (`polygonProblem`) and re-based the mask to the current box.
 */
export function applyShape(
  mask: FogMask,
  op: FogOp,
  shape: FogShape,
): { mask: FogMask; changed: boolean } {
  const [col0, row0, cols, rows] = mask.box;
  const cells = mask.cells.slice();
  const v = op === "hide" ? 1 : 0;
  let changed = false;
  const clip =
    shape.kind === "rect"
      ? {
          ...shape,
          c0: Math.max(Math.min(shape.c0, shape.c1), col0),
          c1: Math.min(Math.max(shape.c0, shape.c1), col0 + cols - 1),
          r0: Math.max(Math.min(shape.r0, shape.r1), row0),
          r1: Math.min(Math.max(shape.r0, shape.r1), row0 + rows - 1),
        }
      : shape;
  if (clip.kind === "rect" && (clip.c0 > clip.c1 || clip.r0 > clip.r1)) {
    return { mask, changed: false };
  }
  forEachShapeCell(clip, (c, r) => {
    const x = c - col0;
    const y = r - row0;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const i = y * cols + x;
    if (cells[i] !== v) {
      cells[i] = v;
      changed = true;
    }
  });
  return changed ? { mask: { ...mask, cells }, changed } : { mask, changed };
}
