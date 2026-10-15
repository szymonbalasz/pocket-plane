// Pure scene-tools math shared by server and clients (SCN §8 derived values): vertices, segment
// validity and dedupe (FR-SCN-07), the blocking rule (FR-SCN-10), prop / template / door cells
// (FR-SCN-18, -21, -36; the footprints fog reads, FR-SCN-35) and distance per diagonal rule
// (FR-SCN-30). Grid units throughout: vertices `(x, y)`, cells `(col, row)`.
import { distanceFt as distance5105, type Grid, type MapRect } from "@shared/scenes-map/geometry";
import {
  type DiagonalRule,
  DOOR_OPEN,
  type Door,
  FT_PER_CELL,
  type Segment,
  TEMPLATE_WIDTH,
  type TemplateGeometry,
  type Wall,
} from "./schemas";

export type Cell = readonly [col: number, row: number];
export interface CellPoint {
  col: number;
  row: number;
}
export interface Vertex {
  x: number;
  y: number;
}

// ---------- vertices ----------

/** Vertex → map px: `offset + x × cellSize`. */
export function vertexToPx(g: Grid, v: Vertex): { x: number; y: number } {
  return { x: g.gridOffsetX + v.x * g.gridCellSize, y: g.gridOffsetY + v.y * g.gridCellSize };
}

/** The vertex nearest a map point (structure and AoE tools snap to it). */
export function pxToVertex(g: Grid, x: number, y: number): Vertex {
  return {
    x: Math.round((x - g.gridOffsetX) / g.gridCellSize) + 0,
    y: Math.round((y - g.gridOffsetY) / g.gridCellSize) + 0,
  };
}

/**
 * The vertices of every cell that overlaps the map rectangle (FR-MAP-14 overlap):
 * `x0…x1 × y0…y1`, inclusive.
 */
export function vertexRange(m: MapRect): { x0: number; y0: number; x1: number; y1: number } {
  const cs = m.gridCellSize;
  return {
    x0: Math.floor(-m.gridOffsetX / cs) + 0,
    y0: Math.floor(-m.gridOffsetY / cs) + 0,
    x1: Math.ceil((m.mapWidth - m.gridOffsetX) / cs) + 0,
    y1: Math.ceil((m.mapHeight - m.gridOffsetY) / cs) + 0,
  };
}

// ---------- segments (FR-SCN-07) ----------

/** Same key for both directions: identical segments dedupe. */
export function segmentKey([x1, y1, x2, y2]: Segment): string {
  return x1 < x2 || (x1 === x2 && y1 <= y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
}

/** Why a segment is refused, or null: length 0, or an endpoint outside the vertex range ± 1. */
export function segmentProblem(seg: Segment, m: MapRect): "length" | "bounds" | null {
  const [x1, y1, x2, y2] = seg;
  if (x1 === x2 && y1 === y2) return "length";
  const r = vertexRange(m);
  const inX = (x: number) => x >= r.x0 - 1 && x <= r.x1 + 1;
  const inY = (y: number) => y >= r.y0 - 1 && y <= r.y1 + 1;
  return inX(x1) && inX(x2) && inY(y1) && inY(y2) ? null : "bounds";
}

/** The segment of a wall or door tuple. */
export const segmentOf = (s: Wall | Door): Segment => [s[1], s[2], s[3], s[4]];

type P = readonly [number, number];

const orient = (a: P, b: P, c: P) =>
  Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const within = (a: P, b: P, c: P) =>
  Math.min(a[0], b[0]) <= c[0] &&
  c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] &&
  c[1] <= Math.max(a[1], b[1]);

/** Segments `pq` and `rs` intersect or touch (collinear overlap counts). Exact on integers. */
export function segmentsTouch(p: P, q: P, r: P, s: P): boolean {
  const o1 = orient(p, q, r);
  const o2 = orient(p, q, s);
  const o3 = orient(r, s, p);
  const o4 = orient(r, s, q);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    (o1 === 0 && within(p, q, r)) ||
    (o2 === 0 && within(p, q, s)) ||
    (o3 === 0 && within(r, s, p)) ||
    (o4 === 0 && within(r, s, q))
  );
}

/** Footprint centre on doubled coordinates: `(2 col + n, 2 row + n)`. */
const centre2 = (c: CellPoint, n: number): P => [2 * c.col + n, 2 * c.row + n];

/**
 * FR-SCN-10 blocking rule: the `n`s of every wall, and every door whose state ≠ open, that the
 * straight segment between the footprint centres of `from` and `to` (footprint `n` cells per
 * side) intersects or touches. Integer math on doubled coordinates. An unmoved token crosses
 * nothing. The caller decides who is checked (DM moves never are).
 */
export function blockingSegments(
  from: CellPoint,
  to: CellPoint,
  n: number,
  walls: readonly Wall[],
  doors: readonly Door[],
): number[] {
  if (from.col === to.col && from.row === to.row) return [];
  const a = centre2(from, n);
  const b = centre2(to, n);
  const hit = (s: Wall | Door) => segmentsTouch(a, b, [2 * s[1], 2 * s[2]], [2 * s[3], 2 * s[4]]);
  const out: number[] = [];
  for (const w of walls) if (hit(w)) out.push(w[0]);
  for (const d of doors) if (d[5] !== DOOR_OPEN && hit(d)) out.push(d[0]);
  return out;
}

/** FR-SCN-10: any blocking segment on the path. */
export function moveBlocked(
  from: CellPoint,
  to: CellPoint,
  n: number,
  walls: readonly Wall[],
  doors: readonly Door[],
): boolean {
  return blockingSegments(from, to, n, walls, doors).length > 0;
}

// ---------- footprints (FR-SCN-18, -21, -35, -36) ----------

/** FR-SCN-18: a prop's footprint is its `w × h` cells (rotation swaps only the drawn sides). */
export function propCells(p: { col: number; row: number; w: number; h: number }): {
  col: number;
  row: number;
  w: number;
  h: number;
} {
  return { col: p.col, row: p.row, w: p.w, h: p.h };
}

/** FR-SCN-18: the drawn image sides of a `w × h` footprint at `rotation` (90° / 270° swap). */
export function propDrawnSides(p: { w: number; h: number; rotation: number }): {
  w: number;
  h: number;
} {
  return p.rotation % 180 === 0 ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
}

/** FR-MAP-14 overlap of one cell with the map rectangle (the `cut`). */
function cellOnMap(m: MapRect, col: number, row: number): boolean {
  const cs = m.gridCellSize;
  const x = m.gridOffsetX + col * cs;
  const y = m.gridOffsetY + row * cs;
  return x < m.mapWidth && x + cs > 0 && y < m.mapHeight && y + cs > 0;
}

const EPS = 1e-9;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

/**
 * FR-SCN-21: cells whose centre lies inside or on the template (FR-SCN-20). Directions are
 * screen angles: 0 = east (+x), 90 = south (+y). `cut: true` keeps cells overlapping the map
 * (drawing, the count); `cut: false` keeps all (fog's `derive`, so `fogged` survives a map
 * change). Row-major order.
 */
export function templateCells(
  t: TemplateGeometry,
  scene: MapRect,
  { cut }: { cut: boolean },
): Cell[] {
  const L = t.size / FT_PER_CELL;
  const out: Cell[] = [];
  const push = (c: number, r: number) => {
    if (!cut || cellOnMap(scene, c, r)) out.push([c, r]);
  };
  if (t.shape === "sphere" || t.shape === "cylinder") {
    // Doubled coordinates: centre (2c + 1, 2r + 1), origin (2x, 2y); exact.
    const r2 = (2 * L) ** 2;
    for (let r = t.y - L; r < t.y + L; r++)
      for (let c = t.x - L; c < t.x + L; c++) {
        const dx = 2 * c + 1 - 2 * t.x;
        const dy = 2 * r + 1 - 2 * t.y;
        if (dx * dx + dy * dy <= r2) push(c, r);
      }
    return out;
  }
  if (t.shape === "cube") {
    // The origin is a corner; `angle` picks the quadrant (0 SE, 90 SW, 180 NW, 270 NE).
    const q = Math.floor(norm360(t.angle) / 90);
    const c0 = q === 0 || q === 3 ? t.x : t.x - L;
    const r0 = q === 0 || q === 1 ? t.y : t.y - L;
    for (let r = r0; r < r0 + L; r++) for (let c = c0; c < c0 + L; c++) push(c, r);
    return out;
  }
  // Cone (width at distance d = d) and line (width `width`), along `angle` from the origin.
  const rad = (norm360(t.angle) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const half = t.shape === "line" ? (t.width ?? TEMPLATE_WIDTH.default) / FT_PER_CELL / 2 : 0;
  const reach = Math.ceil(L + half) + 1;
  for (let r = t.y - reach; r < t.y + reach; r++)
    for (let c = t.x - reach; c < t.x + reach; c++) {
      const dx = c + 0.5 - t.x;
      const dy = r + 0.5 - t.y;
      const along = dx * ux + dy * uy;
      const across = Math.abs(dx * uy - dy * ux);
      if (along < -EPS || along > L + EPS) continue;
      const limit = t.shape === "cone" ? along / 2 : half;
      if (across <= limit + EPS) push(c, r);
    }
  return out;
}

/**
 * FR-SCN-36: the cells that share an edge with the segment, on either side; for a diagonal
 * segment, the cells it passes through (positive length inside the cell). Row-major order.
 */
export function doorCells([x1, y1, x2, y2]: Segment): Cell[] {
  const out: Cell[] = [];
  if (x1 === x2) {
    for (let r = Math.min(y1, y2); r < Math.max(y1, y2); r++) out.push([x1 - 1, r], [x1, r]);
    return out.sort(rowMajor);
  }
  if (y1 === y2) {
    for (let c = Math.min(x1, x2); c < Math.max(x1, x2); c++) out.push([c, y1 - 1], [c, y1]);
    return out.sort(rowMajor);
  }
  for (let r = Math.min(y1, y2); r < Math.max(y1, y2); r++)
    for (let c = Math.min(x1, x2); c < Math.max(x1, x2); c++)
      if (clipLength([x1, y1, x2, y2], c, r) > EPS) out.push([c, r]);
  return out;
}

const rowMajor = (a: Cell, b: Cell) => a[1] - b[1] || a[0] - b[0];

/** Liang–Barsky: the parameter length of the segment inside the closed cell `(c, r)`. */
function clipLength([x1, y1, x2, y2]: Segment, c: number, r: number): number {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: [number, number][] = [
    [-dx, x1 - c],
    [dx, c + 1 - x1],
    [-dy, y1 - r],
    [dy, r + 1 - y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return 0;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return 0;
  }
  return t1 - t0;
}

// ---------- distance (FR-SCN-30) ----------

/**
 * One distance fn for the ruler, the movement indicator and combat's movement used: `5-10-5`
 * (FR-MAP-22, #145) or `5` = `5 × max(dx, dy)`. Template sizes don't use it.
 */
export function distanceFt(a: CellPoint, b: CellPoint, rule: DiagonalRule = "5-10-5"): number {
  if (rule === "5") return FT_PER_CELL * Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  return distance5105(a, b);
}
