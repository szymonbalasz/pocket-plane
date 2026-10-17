// Shared area / coverage helper (SCN FR-SCN-41, -42; FOG FR-FOG-55; seams S2): which grid cells a
// shape covers. Grid units throughout: cell (c, r) covers [c, c + 1) × [r, r + 1), centre
// (c + ½, r + ½); angles are screen angles (0 = east, 90 = south). Modes: `half` (> 50 % of the
// cell by exact area; a tie counts on one side only), `centre` (cell centre inside or on the
// shape), `distance` (cells within a radius of a cell by the campaign's diagonal rule: the
// snapped fog brush). Pure, hand-rolled, no dependency (OQ-SCN-32); server and both clients.
import {
  type DiagonalRule,
  FT_PER_CELL,
  TEMPLATE_WIDTH,
  type TemplateGeometry,
} from "@shared/scene-tools/schemas";
import { distanceFt } from "./geometry";

export type Cell = readonly [col: number, row: number];

/**
 * A shape in grid units. Template kinds (`templateArea`): `circle` (sphere / cylinder), `cone`
 * (width at distance d = d), `line` (width `width`), `square` (a cube: the origin is a corner,
 * sides along `angle` and `angle + 90°`). FOG geometry as is (FR-FOG-26): `rect [x0, y0, x1, y1]`,
 * `polygon [x, y, …]` (simple, even-odd), `circle [cx, cy, r]`, `stroke [r, x0, y0, …]` (points
 * within r of the polyline).
 */
export type AreaShape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "cone"; x: number; y: number; length: number; angle: number }
  | { kind: "line"; x: number; y: number; length: number; width: number; angle: number }
  | { kind: "square"; x: number; y: number; side: number; angle: number }
  | { rect: readonly number[] }
  | { polygon: readonly number[] }
  | { circle: readonly number[] }
  | { stroke: readonly number[] };

export type AreaMode = "half" | "centre" | "distance";

export interface CellShare {
  col: number;
  row: number;
  /** Covered fraction of the cell, (0, 1]. */
  share: number;
}

export interface CellsOptions {
  /**
   * `half`, FOG geometry only: a tied cell (exactly 50 %) counts iff its centre lies strictly
   * right of this axis (through `(x, y)` along `angle`). Absent → ties never count. Template
   * kinds carry their own rule (FR-SCN-41).
   */
  axis?: { x: number; y: number; angle: number };
  /** `distance`: the campaign's diagonal rule (FR-SCN-30); default `5-10-5`. */
  rule?: DiagonalRule;
}

/** FR-SCN-41: tolerance for "exactly 50 %" and for on-the-boundary tests, in cells. */
export const AREA_TOL = 1e-9;
/** Shares below this are float noise from a boundary touch, not coverage. */
const SHARE_MIN = 1e-12;

// ---------- template → shape, snapping (FR-SCN-20, -42, -43) ----------

/** FR-SCN-42: a template's shape in grid units (sizes in ft / 5). */
export function templateArea(t: TemplateGeometry): AreaShape {
  const L = t.size / FT_PER_CELL;
  const { x, y, angle } = t;
  switch (t.shape) {
    case "sphere":
    case "cylinder":
      return { kind: "circle", x, y, r: L };
    case "cube":
      return { kind: "square", x, y, side: L, angle };
    case "cone":
      return { kind: "cone", x, y, length: L, angle };
    case "line": {
      const width = (t.width ?? TEMPLATE_WIDTH.default) / FT_PER_CELL;
      return { kind: "line", x, y, length: L, width, angle };
    }
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** FR-SCN-43: the nearest grid vertex, or (free, Ctrl) the point rounded to 0.01 cell. */
export function snapPoint(p: { x: number; y: number }, free: boolean): { x: number; y: number } {
  if (free) return { x: round2(p.x), y: round2(p.y) };
  return { x: Math.round(p.x) + 0, y: Math.round(p.y) + 0 };
}

/** FR-SCN-43: 15° steps, or (free, Ctrl) 0.1°; in [0, 360). */
export function snapAngle(deg: number, free: boolean): number {
  const v = free ? Math.round(deg * 10) / 10 : Math.round(deg / 15) * 15;
  const n = ((v % 360) + 360) % 360;
  return free ? Math.round(n * 10) / 10 + 0 : n + 0;
}

// ---------- internal geometry ----------

/** Unit vector of a screen angle; exact at multiples of 90°. */
function dir(deg: number): [number, number] {
  const a = ((deg % 360) + 360) % 360;
  if (a === 0) return [1, 0];
  if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0];
  if (a === 270) return [0, -1];
  const rad = (a * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/** Template kinds as a convex polygon (flat, positive shoelace orientation). */
function convexOf(s: Extract<AreaShape, { kind: "cone" | "line" | "square" }>): number[] {
  const [ux, uy] = dir(s.angle);
  // Right-hand normal on screen (east → south).
  const nx = -uy;
  const ny = ux;
  const { x, y } = s;
  let pts: number[];
  if (s.kind === "cone") {
    const L = s.length;
    const h = L / 2;
    pts = [
      x,
      y,
      x + L * ux + h * nx,
      y + L * uy + h * ny,
      x + L * ux - h * nx,
      y + L * uy - h * ny,
    ];
  } else if (s.kind === "line") {
    const L = s.length;
    const h = s.width / 2;
    pts = [
      x + h * nx,
      y + h * ny,
      x + L * ux + h * nx,
      y + L * uy + h * ny,
      x + L * ux - h * nx,
      y + L * uy - h * ny,
      x - h * nx,
      y - h * ny,
    ];
  } else {
    const d = s.side;
    pts = [
      x,
      y,
      x + d * ux,
      y + d * uy,
      x + d * (ux + nx),
      y + d * (uy + ny),
      x + d * nx,
      y + d * ny,
    ];
  }
  return signedArea2(pts) < 0 ? reverse(pts) : pts;
}

function signedArea2(pts: readonly number[]): number {
  let a = 0;
  const n = pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += (pts[2 * j] as number) * (pts[2 * i + 1] as number);
    a -= (pts[2 * i] as number) * (pts[2 * j + 1] as number);
  }
  return a;
}

function reverse(pts: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i] as number, pts[i + 1] as number);
  return out;
}

function boxOf(pts: readonly number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i] as number;
    const y = pts[i + 1] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Keep the part of a polygon where `a·x + b·y + c ≥ 0` (Sutherland–Hodgman, one plane). */
function clipPlane(pts: readonly number[], a: number, b: number, c: number): number[] {
  const out: number[] = [];
  const n = pts.length >> 1;
  if (n === 0) return out;
  let px = pts[2 * (n - 1)] as number;
  let py = pts[2 * (n - 1) + 1] as number;
  let pf = a * px + b * py + c;
  for (let i = 0; i < n; i++) {
    const qx = pts[2 * i] as number;
    const qy = pts[2 * i + 1] as number;
    const qf = a * qx + b * qy + c;
    if (qf >= 0) {
      if (pf < 0) {
        const t = pf / (pf - qf);
        out.push(px + t * (qx - px), py + t * (qy - py));
      }
      out.push(qx, qy);
    } else if (pf >= 0) {
      const t = pf / (pf - qf);
      out.push(px + t * (qx - px), py + t * (qy - py));
    }
    px = qx;
    py = qy;
    pf = qf;
  }
  return out;
}

/** Area of a polygon (any simple subject) inside the cell `[c, c + 1] × [r, r + 1]`. */
function polygonCellArea(pts: readonly number[], c: number, r: number): number {
  let p = clipPlane(pts, 1, 0, -c);
  p = clipPlane(p, -1, 0, c + 1);
  p = clipPlane(p, 0, 1, -r);
  p = clipPlane(p, 0, -1, r + 1);
  return Math.abs(signedArea2(p)) / 2;
}

/** Signed area of (circle at the origin, radius √r2) ∩ triangle (origin, a, b). */
function circleSegArea(ax: number, ay: number, bx: number, by: number, r2: number): number {
  const sector = (px: number, py: number, qx: number, qy: number) =>
    0.5 * r2 * Math.atan2(px * qy - py * qx, px * qx + py * qy);
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a === 0) return 0;
  const b = ax * dx + ay * dy;
  const c = ax * ax + ay * ay - r2;
  const disc = b * b - a * c;
  if (disc <= 0) return sector(ax, ay, bx, by);
  const s = Math.sqrt(disc);
  const t1 = Math.max(0, (-b - s) / a);
  const t2 = Math.min(1, (-b + s) / a);
  if (t1 >= t2) return sector(ax, ay, bx, by);
  const p1x = ax + t1 * dx;
  const p1y = ay + t1 * dy;
  const p2x = ax + t2 * dx;
  const p2y = ay + t2 * dy;
  return sector(ax, ay, p1x, p1y) + 0.5 * (p1x * p2y - p1y * p2x) + sector(p2x, p2y, bx, by);
}

/** Closed form: area of the circle (cx, cy, r) ∩ the cell (c, r). */
function circleCellArea(cx: number, cy: number, r: number, col: number, row: number): number {
  const x0 = col - cx;
  const y0 = row - cy;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const r2 = r * r;
  return Math.abs(
    circleSegArea(x0, y0, x1, y0, r2) +
      circleSegArea(x1, y0, x1, y1, r2) +
      circleSegArea(x1, y1, x0, y1, r2) +
      circleSegArea(x0, y1, x0, y0, r2),
  );
}

// ---------- coverage (FR-SCN-41) ----------

type Covered = (col: number, row: number, share: number) => void;

function circleCoverage(cx: number, cy: number, r: number, emit: Covered): void {
  const r2 = r * r;
  const rows0 = Math.floor(cy - r);
  const rows1 = Math.ceil(cy + r);
  const cols0 = Math.floor(cx - r);
  const cols1 = Math.ceil(cx + r);
  for (let row = rows0; row < rows1; row++) {
    const ny = cy < row ? row - cy : cy > row + 1 ? cy - row - 1 : 0;
    const fy = Math.max(Math.abs(row - cy), Math.abs(row + 1 - cy));
    for (let col = cols0; col < cols1; col++) {
      const nx = cx < col ? col - cx : cx > col + 1 ? cx - col - 1 : 0;
      if (nx * nx + ny * ny >= r2) continue;
      const fx = Math.max(Math.abs(col - cx), Math.abs(col + 1 - cx));
      if (fx * fx + fy * fy <= r2) {
        emit(col, row, 1);
        continue;
      }
      emit(col, row, circleCellArea(cx, cy, r, col, row));
    }
  }
}

/** Convex polygon (positive orientation): clip each cell; four corners inside → 1. */
function convexCoverage(pts: readonly number[], emit: Covered): void {
  const n = pts.length >> 1;
  const A = new Float64Array(n);
  const B = new Float64Array(n);
  const C = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ax = pts[2 * i] as number;
    const ay = pts[2 * i + 1] as number;
    const bx = pts[2 * ((i + 1) % n)] as number;
    const by = pts[2 * ((i + 1) % n) + 1] as number;
    // cross(b − a, p − a) ≥ 0 inside.
    A[i] = -(by - ay);
    B[i] = bx - ax;
    C[i] = (by - ay) * ax - (bx - ax) * ay;
  }
  const [x0, y0, x1, y1] = boxOf(pts);
  for (let row = Math.floor(y0); row < Math.ceil(y1); row++) {
    for (let col = Math.floor(x0); col < Math.ceil(x1); col++) {
      let full = true;
      let out = false;
      for (let i = 0; i < n; i++) {
        const a = A[i] as number;
        const b = B[i] as number;
        const c = C[i] as number;
        const f00 = a * col + b * row + c;
        const f10 = f00 + a;
        const f01 = f00 + b;
        const f11 = f10 + b;
        if (f00 < 0 || f10 < 0 || f01 < 0 || f11 < 0) full = false;
        if (f00 <= 0 && f10 <= 0 && f01 <= 0 && f11 <= 0) {
          out = true;
          break;
        }
      }
      if (out) continue;
      if (full) {
        emit(col, row, 1);
        continue;
      }
      let p: number[] = [col, row, col + 1, row, col + 1, row + 1, col, row + 1];
      for (let i = 0; i < n && p.length > 0; i++) {
        p = clipPlane(p, A[i] as number, B[i] as number, C[i] as number);
      }
      emit(col, row, Math.abs(signedArea2(p)) / 2);
    }
  }
}

/**
 * Simple polygon (any orientation, even-odd): cells an edge touches are clipped exactly; every
 * other cell lies wholly inside or outside, decided by its centre on a scanline.
 */
function polygonCoverage(pts: readonly number[], emit: Covered): void {
  const n = pts.length >> 1;
  const [bx0, by0, bx1, by1] = boxOf(pts);
  const col0 = Math.floor(bx0);
  const row0 = Math.floor(by0);
  const cols = Math.ceil(bx1) - col0;
  const rows = Math.ceil(by1) - row0;
  if (cols <= 0 || rows <= 0) return;
  const edge = new Uint8Array(cols * rows);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = pts[2 * j] as number;
    const ay = pts[2 * j + 1] as number;
    const bx = pts[2 * i] as number;
    const by = pts[2 * i + 1] as number;
    const ylo = Math.min(ay, by);
    const yhi = Math.max(ay, by);
    for (
      let row = Math.max(row0, Math.floor(ylo));
      row <= Math.floor(yhi) && row < row0 + rows;
      row++
    ) {
      let xa: number;
      let xb: number;
      if (ay === by) {
        xa = ax;
        xb = bx;
      } else {
        const ya = Math.max(ylo, row);
        const yb = Math.min(yhi, row + 1);
        xa = ax + ((ya - ay) * (bx - ax)) / (by - ay);
        xb = ax + ((yb - ay) * (bx - ax)) / (by - ay);
      }
      const c0 = Math.max(col0, Math.floor(Math.min(xa, xb)));
      const c1 = Math.min(col0 + cols - 1, Math.floor(Math.max(xa, xb)));
      for (let col = c0; col <= c1; col++) edge[(row - row0) * cols + (col - col0)] = 1;
    }
  }
  const xs: number[] = [];
  for (let row = row0; row < row0 + rows; row++) {
    const y = row + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = pts[2 * j] as number;
      const ay = pts[2 * j + 1] as number;
      const bx = pts[2 * i] as number;
      const by = pts[2 * i + 1] as number;
      if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    let k = 0;
    for (let col = col0; col < col0 + cols; col++) {
      if (edge[(row - row0) * cols + (col - col0)]) {
        emit(col, row, polygonCellArea(pts, col, row));
        continue;
      }
      const x = col + 0.5;
      while (k < xs.length && (xs[k] as number) <= x) k++;
      if (k % 2 === 1) emit(col, row, 1);
    }
  }
}

function rectCoverage(rect: readonly number[], emit: Covered): void {
  const [a = 0, b = 0, c = 0, d = 0] = rect;
  const x0 = Math.min(a, c);
  const x1 = Math.max(a, c);
  const y0 = Math.min(b, d);
  const y1 = Math.max(b, d);
  for (let row = Math.floor(y0); row < Math.ceil(y1); row++) {
    const h = Math.min(y1, row + 1) - Math.max(y0, row);
    for (let col = Math.floor(x0); col < Math.ceil(x1); col++) {
      emit(col, row, h * (Math.min(x1, col + 1) - Math.max(x0, col)));
    }
  }
}

function coverage(shape: AreaShape, emit: Covered): void {
  if ("kind" in shape) {
    if (shape.kind === "circle") circleCoverage(shape.x, shape.y, shape.r, emit);
    else convexCoverage(convexOf(shape), emit);
    return;
  }
  if ("stroke" in shape) throw new Error("area: no exact coverage for a stroke (FR-SCN-42)");
  if ("rect" in shape) rectCoverage(shape.rect, emit);
  else if ("polygon" in shape) polygonCoverage(shape.polygon, emit);
  else {
    const [cx = 0, cy = 0, r = 0] = shape.circle;
    circleCoverage(cx, cy, r, emit);
  }
}

/**
 * FR-SCN-41 / -42: every cell the shape covers, with its exact covered share (> 0), row-major.
 * Strokes are not supported (no consumer; seams S2).
 */
export function cellCoverage(shape: AreaShape): CellShare[] {
  const out: CellShare[] = [];
  coverage(shape, (col, row, share) => {
    if (share > SHARE_MIN) out.push({ col, row, share: Math.min(1, share) });
  });
  return out;
}

// ---------- tie rule (FR-SCN-41, #245 G28, review A10) ----------

/** Strictly right of the axis through (ox, oy) along (ux, uy), on screen. */
const rightOf = (ox: number, oy: number, ux: number, uy: number, px: number, py: number) =>
  ux * (py - oy) - uy * (px - ox) > AREA_TOL;

/** A tied cell's verdict: lines / cones right of the axis, cubes right of either centre line. */
function tieCounts(shape: AreaShape, col: number, row: number, opts: CellsOptions): boolean {
  const px = col + 0.5;
  const py = row + 0.5;
  if ("kind" in shape) {
    if (shape.kind === "circle") return false;
    const [ux, uy] = dir(shape.angle);
    if (shape.kind !== "square") return rightOf(shape.x, shape.y, ux, uy, px, py);
    const h = shape.side / 2;
    // Square centre = origin + h·(u + n), n = (−uy, ux).
    const cx = shape.x + h * (ux - uy);
    const cy = shape.y + h * (uy + ux);
    return rightOf(cx, cy, ux, uy, px, py) || rightOf(cx, cy, -uy, ux, px, py);
  }
  if (!opts.axis || "circle" in shape) return false;
  const [ux, uy] = dir(opts.axis.angle);
  return rightOf(opts.axis.x, opts.axis.y, ux, uy, px, py);
}

// ---------- containment (centre mode, FR-FOG-26 strokes) ----------

const S = (v: number) => Math.round(v * 100);

/** FOG geometry on 1/100-cell integers (as FR-FOG-26's tests): boundary-inclusive, exact. */
function fogContains(shape: AreaShape, x: number, y: number): boolean {
  const px = S(x);
  const py = S(y);
  if ("rect" in shape) {
    const [a = 0, b = 0, c = 0, d = 0] = shape.rect.map(S);
    return (
      Math.min(a, c) <= px && px <= Math.max(a, c) && Math.min(b, d) <= py && py <= Math.max(b, d)
    );
  }
  if ("circle" in shape) {
    const [cx = 0, cy = 0, r = 0] = shape.circle.map(S);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  }
  if (!("polygon" in shape)) return false;
  const v = shape.polygon.map(S);
  const n = v.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = v[2 * i] as number;
    const ay = v[2 * i + 1] as number;
    const bx = v[2 * j] as number;
    const by = v[2 * j + 1] as number;
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
      const lhs = (px - ax) * (by - ay);
      const rhs = (py - ay) * (bx - ax);
      if (by - ay > 0 ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside;
}

/** Squared distance from (px, py) to the segment a–b. */
function segDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** FR-FOG-26 stroke: within r of the polyline (a single point = a circle), boundary-inclusive. */
function strokeContains(stroke: readonly number[], x: number, y: number): boolean {
  const r = stroke[0] ?? 0;
  const lim = r * r + AREA_TOL;
  const n = (stroke.length - 1) >> 1;
  if (n === 1)
    return segDist2(stroke[1] ?? 0, stroke[2] ?? 0, stroke[1] ?? 0, stroke[2] ?? 0, x, y) <= lim;
  for (let i = 0; i + 1 < n; i++) {
    const ax = stroke[1 + 2 * i] as number;
    const ay = stroke[2 + 2 * i] as number;
    const bx = stroke[3 + 2 * i] as number;
    const by = stroke[4 + 2 * i] as number;
    if (segDist2(ax, ay, bx, by, x, y) <= lim) return true;
  }
  return false;
}

/**
 * The point lies inside or on the shape. Template kinds within `AREA_TOL` (FR-SCN-21's sprint-2
 * test); FOG rect / polygon / circle exact on 1/100-cell integers (FR-FOG-26); strokes by
 * distance to the polyline.
 */
export function contains(shape: AreaShape, x: number, y: number): boolean {
  if ("stroke" in shape) return strokeContains(shape.stroke, x, y);
  if (!("kind" in shape)) return fogContains(shape, x, y);
  if (shape.kind === "circle")
    return (x - shape.x) ** 2 + (y - shape.y) ** 2 <= shape.r ** 2 + AREA_TOL;
  const pts = convexOf(shape);
  const n = pts.length >> 1;
  for (let i = 0; i < n; i++) {
    const ax = pts[2 * i] as number;
    const ay = pts[2 * i + 1] as number;
    const bx = pts[2 * ((i + 1) % n)] as number;
    const by = pts[2 * ((i + 1) % n) + 1] as number;
    const len = Math.hypot(bx - ax, by - ay);
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < -AREA_TOL * len) return false;
  }
  return true;
}

/** Bounding box `[x0, y0, x1, y1]` of a shape. */
export function areaBox(shape: AreaShape): [number, number, number, number] {
  if ("kind" in shape) {
    if (shape.kind === "circle") {
      return [shape.x - shape.r, shape.y - shape.r, shape.x + shape.r, shape.y + shape.r];
    }
    return boxOf(convexOf(shape));
  }
  if ("rect" in shape) return boxOf(shape.rect);
  if ("polygon" in shape) return boxOf(shape.polygon);
  if ("circle" in shape) {
    const [cx = 0, cy = 0, r = 0] = shape.circle;
    return [cx - r, cy - r, cx + r, cy + r];
  }
  const r = shape.stroke[0] ?? 0;
  const [x0, y0, x1, y1] = boxOf(shape.stroke.slice(1));
  return [x0 - r, y0 - r, x1 + r, y1 + r];
}

// ---------- cells (FR-SCN-42) ----------

/** Row-major dedupe of cells keyed `row × 2^16 + col` (|coord| < 2^15). */
function sortedCells(keys: Iterable<number>): Cell[] {
  return [...keys]
    .sort((a, b) => a - b)
    .map((k) => {
      const row = Math.floor(k / 65536);
      return [k - row * 65536 - 32768, row - 32768] as const;
    });
}
const cellKey = (col: number, row: number) => (row + 32768) * 65536 + (col + 32768);

/** Cells within `r` cells (`r × 5` ft) of the cell holding (x, y), by the diagonal rule. */
function addDistanceCells(x: number, y: number, r: number, rule: DiagonalRule, out: Set<number>) {
  const c = Math.floor(x);
  const w = Math.floor(y);
  const ft = r * FT_PER_CELL + AREA_TOL;
  const k = Math.floor(r + AREA_TOL);
  for (let dy = -k; dy <= k; dy++) {
    for (let dx = -k; dx <= k; dx++) {
      const d =
        rule === "5"
          ? FT_PER_CELL * Math.max(Math.abs(dx), Math.abs(dy))
          : distanceFt({ col: 0, row: 0 }, { col: dx, row: dy });
      if (d <= ft) out.add(cellKey(c + dx, w + dy));
    }
  }
}

/**
 * FR-SCN-42: the cells a shape affects, row-major.
 * - `half` (FR-SCN-41): > 50 % covered; exactly 50 % (± `AREA_TOL`) → the tie rule (lines and
 *   cones: centre strictly right of the axis; cubes: right of either centre line; circles never;
 *   FOG geometry: right of `opts.axis`, else never). Not for strokes.
 * - `centre`: the cell centre inside or on the shape (`contains`).
 * - `distance` (circles and strokes): cells whose distance from the cell holding the centre (each
 *   stroke point) is ≤ r × 5 ft by `opts.rule` (FR-SCN-30); r = 0 → that cell.
 */
export function cells(shape: AreaShape, mode: AreaMode, opts: CellsOptions = {}): Cell[] {
  if (mode === "half") {
    if ("stroke" in shape) throw new Error("area: no half mode for strokes (FR-SCN-42)");
    const out: Cell[] = [];
    coverage(shape, (col, row, share) => {
      if (share > 0.5 + AREA_TOL) out.push([col, row]);
      else if (share >= 0.5 - AREA_TOL && tieCounts(shape, col, row, opts)) out.push([col, row]);
    });
    return out;
  }
  if (mode === "distance") {
    const rule = opts.rule ?? "5-10-5";
    const keys = new Set<number>();
    if ("stroke" in shape) {
      const r = shape.stroke[0] ?? 0;
      for (let i = 1; i + 1 < shape.stroke.length; i += 2) {
        addDistanceCells(shape.stroke[i] as number, shape.stroke[i + 1] as number, r, rule, keys);
      }
    } else if ("kind" in shape && shape.kind === "circle") {
      addDistanceCells(shape.x, shape.y, shape.r, rule, keys);
    } else if ("circle" in shape) {
      const [cx = 0, cy = 0, r = 0] = shape.circle;
      addDistanceCells(cx, cy, r, rule, keys);
    } else {
      throw new Error("area: distance mode needs a circle or a stroke (FR-SCN-42)");
    }
    return sortedCells(keys);
  }
  const [x0, y0, x1, y1] = areaBox(shape);
  const out: Cell[] = [];
  for (let row = Math.floor(y0 - 0.5); row <= Math.ceil(y1); row++) {
    for (let col = Math.floor(x0 - 0.5); col <= Math.ceil(x1); col++) {
      if (contains(shape, col + 0.5, row + 0.5)) out.push([col, row]);
    }
  }
  return out;
}
