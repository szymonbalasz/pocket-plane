// FR-FOG-26 / -55 / -57 (sprint 4): containment of the brush's fog shapes. Pure.
// - `stroke [r, x0, y0, x1, y1, …]`: a point is inside iff its distance to the polyline ≤ r (a
//   single point = a circle); boundary-inclusive.
// - `cells {box: [col0, row0, cols, rows], runs}`: whole cells (FR-FOG-04 codec over the box,
//   "1" = painted); a point is inside iff a cell holding it (boundary-inclusive: a point on a cell
//   edge belongs to both cells) is painted.
// Stroke containment and box come from the shared area helper (`@shared/scenes-map/area`, seams
// S2, review A13), so fog and AoE share one implementation; the cells codec is fog's (FR-FOG-04).
// Also the cells encoder and the server's same-op merge (FR-FOG-57). No import from this folder,
// so `shapes.ts` can use it without a cycle through `mask.ts` → `schemas.ts`.
import { areaBox, contains } from "@shared/scenes-map/area";

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

/** A brush shape prepared for repeated tests (cells decoded once). */
export type PreparedBrush =
  | { kind: "stroke"; stroke: readonly number[] }
  | { kind: "cells"; box: readonly [number, number, number, number]; cells: Uint8Array };

export function prepareBrush(s: BrushShape): PreparedBrush {
  if ("stroke" in s) return { kind: "stroke", stroke: s.stroke };
  const box = [...s.cells.box] as [number, number, number, number];
  return { kind: "cells", box, cells: decodeCells(s.cells) ?? new Uint8Array(box[2] * box[3]) };
}

/** FR-FOG-26: the point (1/100-cell integers) lies inside or on the brush shape. Exact. */
export function brushContains(p: PreparedBrush, px: number, py: number): boolean {
  // The stroke's coordinates carry ≤ 2 decimals, so area.ts's tolerance keeps this exact.
  if (p.kind === "stroke") return contains({ stroke: p.stroke }, px / 100, py / 100);
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
  return areaBox({ stroke: s.stroke });
}

/** A built `cells` geometry (a mutable box, as zod's `FogBrushGeom` types it). */
export type CellsOut = {
  box: [col0: number, row0: number, cols: number, rows: number];
  runs: string;
};

/** FR-FOG-04 codec, first run painted: the `runs` of a `cells` shape over its box. */
export function encodeCells(cells: Uint8Array): string {
  const runs: number[] = [];
  let want = 1;
  let n = 0;
  for (const c of cells) {
    if (c === want) {
      n++;
      continue;
    }
    runs.push(n);
    want = 1 - want;
    n = 1;
  }
  runs.push(n);
  return runs.map((r) => r.toString(36)).join(",");
}

/**
 * FR-FOG-26: the `cells` shape painting exactly these cells (tight box), or null when there are
 * none, the box exceeds 128 × 128 or the runs exceed 500.
 */
export function cellsOf(list: Iterable<readonly [col: number, row: number]>): CellsOut | null {
  const cells = [...list];
  if (cells.length === 0) return null;
  let c0 = Number.POSITIVE_INFINITY;
  let r0 = Number.POSITIVE_INFINITY;
  let c1 = Number.NEGATIVE_INFINITY;
  let r1 = Number.NEGATIVE_INFINITY;
  for (const [c, r] of cells) {
    c0 = Math.min(c0, c);
    r0 = Math.min(r0, r);
    c1 = Math.max(c1, c);
    r1 = Math.max(r1, r);
  }
  const cols = c1 - c0 + 1;
  const rows = r1 - r0 + 1;
  if (cols > CELLS_BOX_MAX || rows > CELLS_BOX_MAX) return null;
  const grid = new Uint8Array(cols * rows);
  for (const [c, r] of cells) grid[(r - r0) * cols + (c - c0)] = 1;
  const runs = encodeCells(grid);
  if (cellsRunCount(runs) > CELLS_RUNS_MAX) return null;
  return { box: [c0, r0, cols, rows], runs };
}

/** The painted cells of a `cells` shape, row-major. */
export function paintedCells(c: CellsGeom): [col: number, row: number][] {
  const grid = decodeCells(c);
  if (!grid) return [];
  const [col0, row0, cols] = c.box;
  const out: [number, number][] = [];
  grid.forEach((v, i) => {
    if (v === 1) out.push([col0 + (i % cols), row0 + Math.floor(i / cols)]);
  });
  return out;
}

/**
 * FR-FOG-57: the union of two `cells` shapes, or null when it would leave the caps (box over
 * 128 × 128, runs over 500): then the edit appends instead.
 */
export const mergeCells = (a: CellsGeom, b: CellsGeom): CellsOut | null =>
  cellsOf([...paintedCells(a), ...paintedCells(b)]);

/** A brush shape's geometry (`stroke` / `cells`), as `shapes.ts` types it. */
export type BrushShape = { stroke: readonly number[] } | { cells: CellsGeom };
