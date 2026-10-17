// Fog brush strokes (FR-FOG-55), pure: the draft a left-drag paints and the shape it sends.
// - Snapped (default): each cell the pointer visits stamps every cell within the radius of it by
//   the campaign's diagonal rule (`@shared/scenes-map/area` mode `distance`; 0 ft = that cell,
//   5 ft = 3 × 3) → a `cells` shape. The path between two pointer events is walked in ≤ ¼-cell
//   steps, so a fast drag leaves no gap.
// - Free (Ctrl held at the press): a round stroke of radius `max(0.5, ft / 5)` cells along the
//   pointer path, points ≥ 0.25 cell apart, simplified to 0.05 cell before sending → `stroke`.
// A stroke reaching 256 points (free) or leaving the `cells` caps (box 128 × 128, 500 runs) is
// handed back as sent and a new one starts at the pointer. DOM-free (`bun test`).
import { cellsOf, STROKE_POINTS_MAX } from "@shared/fog-of-war/brush";
import type { FogBrushGeom } from "@shared/fog-of-war/shapes";
import type { DiagonalRule } from "@shared/scene-tools/schemas";
import { cells as areaCells, type Cell } from "@shared/scenes-map/area";

/** FR-FOG-55: the radius Slider, ft. */
export const BRUSH_FT = { min: 0, max: 50, step: 5, default: 10 } as const;
/** Free stroke: points at least this far apart (cells). */
export const BRUSH_POINT_GAP = 0.25;
/** Free stroke: simplification tolerance before sending (cells). */
export const BRUSH_SIMPLIFY = 0.05;

type Pt = readonly [number, number];

export interface BrushDraft {
  kind: "brush";
  free: boolean;
  ft: number;
  rule: DiagonalRule;
  /** Snapped: the stamped cells (first-stamped first). */
  cells: readonly Cell[];
  /** Free: the kept points (grid units, 2 decimals). */
  points: readonly Pt[];
  /** The latest pointer position (the walk to the next one starts here). */
  last: Pt;
}

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const key = (c: number, r: number) => `${c},${r}`;

/** FR-FOG-55: a free stroke's radius in cells. */
export const freeRadius = (ft: number) => Math.max(0.5, ft / 5);

/** FR-FOG-55: the cells one snapped stamp from cell (col, row) paints. */
export const stampCells = (col: number, row: number, ft: number, rule: DiagonalRule): Cell[] =>
  areaCells({ kind: "circle", x: col + 0.5, y: row + 0.5, r: ft / 5 }, "distance", { rule });

const cellOf = (p: Pt): Cell => [Math.floor(p[0]), Math.floor(p[1])];

/** Adds a stamp's new cells; null when the stroke would leave the `cells` caps. */
function addStamp(d: BrushDraft, at: Cell): BrushDraft | null {
  const have = new Set(d.cells.map(([c, r]) => key(c, r)));
  const fresh = stampCells(at[0], at[1], d.ft, d.rule).filter(([c, r]) => !have.has(key(c, r)));
  if (fresh.length === 0) return d;
  const cells = [...d.cells, ...fresh];
  return cellsOf(cells) ? { ...d, cells } : null;
}

/** Left press: a new stroke stamped (snapped) or started (free) at `at`. */
export function startBrush(at: Pt, ft: number, free: boolean, rule: DiagonalRule): BrushDraft {
  const d: BrushDraft = { kind: "brush", free, ft, rule, cells: [], points: [], last: at };
  if (free) return { ...d, points: [[r2(at[0]), r2(at[1])]] };
  return addStamp(d, cellOf(at)) ?? d;
}

/**
 * Pointer move with the button down: walks the path from the last position to `at`. Returns the
 * draft and the strokes completed on the way (sent while the button stays down).
 */
export function extendBrush(d: BrushDraft, at: Pt): { draft: BrushDraft; sent: BrushDraft[] } {
  const sent: BrushDraft[] = [];
  let cur = d;
  if (d.free) {
    const prev = cur.points.at(-1) as Pt;
    if (Math.hypot(at[0] - prev[0], at[1] - prev[1]) >= BRUSH_POINT_GAP) {
      const p: Pt = [r2(at[0]), r2(at[1])];
      cur = { ...cur, points: [...cur.points, p] };
      if (cur.points.length >= STROKE_POINTS_MAX) {
        sent.push(cur);
        cur = { ...cur, points: [p] };
      }
    }
    return { draft: { ...cur, last: at }, sent };
  }
  const [x0, y0] = d.last;
  const steps = Math.max(1, Math.ceil(Math.hypot(at[0] - x0, at[1] - y0) / BRUSH_POINT_GAP));
  let prevCell = cellOf(d.last);
  for (let i = 1; i <= steps; i++) {
    const p: Pt = [x0 + ((at[0] - x0) * i) / steps, y0 + ((at[1] - y0) * i) / steps];
    const c = cellOf(p);
    if (c[0] === prevCell[0] && c[1] === prevCell[1]) continue;
    prevCell = c;
    const next = addStamp(cur, c);
    if (next) {
      cur = next;
      continue;
    }
    // Over the caps: send what we have, start a new stroke with this stamp.
    sent.push(cur);
    const fresh: BrushDraft = { ...cur, cells: [] };
    cur = addStamp(fresh, c) ?? fresh;
  }
  return { draft: { ...cur, last: at }, sent };
}

/** Squared distance from p to the segment a–b. */
function segDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  const qx = a[0] + t * dx - p[0];
  const qy = a[1] + t * dy - p[1];
  return qx * qx + qy * qy;
}

/** Douglas–Peucker: drops points within `tol` of the simplified polyline. Keeps both ends. */
export function simplifyPath(points: readonly Pt[], tol = BRUSH_SIMPLIFY): Pt[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const t2 = tol * tol;
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number];
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist2(points[k] as Pt, points[i] as Pt, points[j] as Pt);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > t2) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, k) => keep[k] === 1);
}

/** FR-FOG-55: the shape a stroke sends (`cells` snapped, `stroke` free), or null if empty. */
export function brushShape(d: BrushDraft): FogBrushGeom | null {
  if (!d.free) {
    const c = cellsOf(d.cells);
    return c ? { cells: c } : null;
  }
  if (d.points.length === 0) return null;
  const pts = simplifyPath(d.points);
  return { stroke: [freeRadius(d.ft), ...pts.flat()] };
}

/** FR-FOG-55: the radius Slider's value, kept per browser (`localStorage`), clamped to steps. */
export function clampBrushFt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return BRUSH_FT.default;
  const s = Math.round(n / BRUSH_FT.step) * BRUSH_FT.step;
  return Math.min(BRUSH_FT.max, Math.max(BRUSH_FT.min, s));
}
