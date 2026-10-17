// FR-FOG-26 / -55 (sprint 4): containment of the brush's fog shapes. Pure, leaf (no imports, so
// `shapes.ts` can use it without a cycle through `mask.ts` → `schemas.ts`).
// - `stroke [r, x0, y0, x1, y1, …]`: a point is inside iff its distance to the polyline ≤ r (a
//   single point = a circle); boundary-inclusive.
// - `cells {box: [col0, row0, cols, rows], runs}`: whole cells (FR-FOG-04 codec over the box,
//   "1" = painted); a point is inside iff a cell holding it (boundary-inclusive: a point on a cell
//   edge belongs to both cells) is painted.
// Local helper until M0's `src/shared/scenes-map/area.ts` lands (seams S2): the brush's snapped
// stamp and these tests move there then; callers only use `brushContains`.

/** FR-FOG-26: stroke radius 0.5–10 cells, 1–256 points. */
export const STROKE_R_MIN = 0.5;
export const STROKE_R_MAX = 10;
export const STROKE_POINTS_MAX = 256;
/** FR-FOG-26: cells box ≤ 128 × 128, ≤ 500 runs. */
export const CELLS_BOX_MAX = 128;
export const CELLS_RUNS_MAX = 500;

/** `{box, runs}` of a `cells` shape. */
export interface CellsGeom {
  box: readonly [col0: number, row0: number, cols: number, rows: number];
  runs: string;
}

const BASE36 = /^[0-9a-z]+$/;

/**
 * FR-FOG-04 codec over the box, first run painted ("1"). Null when malformed, the sum ≠ the box
 * size, or nothing is painted (a cells shape has area > 0).
 */
export function decodeCells(c: CellsGeom): Uint8Array | null {
  const n = c.box[2] * c.box[3];
  if (n === 0 || c.runs === "") return null;
  const cells = new Uint8Array(n);
  let at = 0;
  let v = 1;
  let painted = 0;
  for (const part of c.runs.split(",")) {
    if (!BASE36.test(part)) return null;
    const len = Number.parseInt(part, 36);
    if (at + len > n) return null;
    if (v === 1) {
      cells.fill(1, at, at + len);
      painted += len;
    }
    at += len;
    v = 1 - v;
  }
  return at === n && painted > 0 ? cells : null;
}

/** Runs in a codec string. */
export const cellsRunCount = (runs: string) => (runs === "" ? 0 : runs.split(",").length);

/** Squared distance from (px, py) to the segment a → b. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax;
  const ey = by - ay;
  const ll = ex * ex + ey * ey;
  let t = ll === 0 ? 0 : ((px - ax) * ex + (py - ay) * ey) / ll;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + t * ex);
  const dy = py - (ay + t * ey);
  return dx * dx + dy * dy;
}

/** A brush shape prepared for repeated tests (1/100-cell integers, like `PreparedShape`). */
export type PreparedBrush =
  | { kind: "stroke"; r: number; pts: Float64Array }
  | { kind: "cells"; box: readonly [number, number, number, number]; cells: Uint8Array };

export function prepareBrush(s: BrushShape): PreparedBrush {
  if ("stroke" in s) {
    const [r, ...xy] = s.stroke;
    return {
      kind: "stroke",
      r: Math.round((r ?? 0) * 100),
      pts: Float64Array.from(xy, (v) => Math.round(v * 100)),
    };
  }
  const box = [...s.cells.box] as [number, number, number, number];
  return { kind: "cells", box, cells: decodeCells(s.cells) ?? new Uint8Array(box[2] * box[3]) };
}

/** FR-FOG-26: the point (1/100-cell integers) lies inside or on the brush shape. Exact. */
export function brushContains(p: PreparedBrush, px: number, py: number): boolean {
  if (p.kind === "stroke") {
    const r2 = p.r * p.r;
    const v = p.pts;
    if (v.length === 2)
      return segDist2(px, py, v[0] as number, v[1] as number, v[0] as number, v[1] as number) <= r2;
    for (let i = 0; i + 3 < v.length; i += 2) {
      const d = segDist2(
        px,
        py,
        v[i] as number,
        v[i + 1] as number,
        v[i + 2] as number,
        v[i + 3] as number,
      );
      if (d <= r2) return true;
    }
    return false;
  }
  const [col0, row0, cols, rows] = p.box;
  const cs = px % 100 === 0 ? [px / 100 - 1, px / 100] : [Math.floor(px / 100)];
  const rs = py % 100 === 0 ? [py / 100 - 1, py / 100] : [Math.floor(py / 100)];
  for (const r of rs) {
    for (const c of cs) {
      const cc = c - col0;
      const rr = r - row0;
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && p.cells[rr * cols + cc] === 1)
        return true;
    }
  }
  return false;
}

/** Bounding box `[x0, y0, x1, y1]` (grid units) of a brush shape. */
export function brushBox(s: BrushShape): [number, number, number, number] {
  if ("cells" in s) {
    const [c0, r0, cols, rows] = s.cells.box;
    return [c0, r0, c0 + cols, r0 + rows];
  }
  const [r = 0, ...xy] = s.stroke;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    x0 = Math.min(x0, xy[i] as number);
    y0 = Math.min(y0, xy[i + 1] as number);
    x1 = Math.max(x1, xy[i] as number);
    y1 = Math.max(y1, xy[i + 1] as number);
  }
  return [x0 - r, y0 - r, x1 + r, y1 + r];
}

/** A brush shape's geometry (`stroke` / `cells`), as `shapes.ts` types it. */
export type BrushShape = { stroke: readonly number[] } | { cells: CellsGeom };
