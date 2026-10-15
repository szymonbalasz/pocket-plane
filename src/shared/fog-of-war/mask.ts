// Fog mask: box, run-length codec, re-base and footprint test (FR-FOG-01, -03, -04, -10). Pure;
// shared by the server (commands, `derive`) and both clients (render).
import type { MapRect } from "@shared/scenes-map/geometry";
import { FOG_RUNS_MAX, type FogBox, type FogFill } from "./schemas";

/** A decoded mask: `cells[(row − row0) × cols + (col − col0)]` = 1 fogged, 0 clear. */
export interface FogMask {
  fill: FogFill;
  box: FogBox;
  cells: Uint8Array;
}

/** The stored shape of a mask (`scene_fog` row, `fog` record). */
export interface FogRow {
  fill: FogFill;
  box: FogBox;
  runs: string;
}

/** A subject's footprint: a square block (tokens) or a list of `[col, row]` cells (SCN). */
export type FogCells =
  | { col: number; row: number; w: number; h: number }
  | readonly (readonly [number, number])[];

/**
 * FR-FOG-03: every cell overlapping the map rectangle at the scene's current grid:
 * `col0 = floor(−offsetX / cellSize)`, `cols = ceil((mapWidth − offsetX) / cellSize) − col0`.
 */
export function fogBox(m: MapRect): FogBox {
  const col0 = Math.floor(-m.gridOffsetX / m.gridCellSize) + 0;
  const row0 = Math.floor(-m.gridOffsetY / m.gridCellSize) + 0;
  const cols = Math.ceil((m.mapWidth - m.gridOffsetX) / m.gridCellSize) - col0;
  const rows = Math.ceil((m.mapHeight - m.gridOffsetY) / m.gridCellSize) - row0;
  return [col0, row0, Math.max(0, cols), Math.max(0, rows)];
}

const boxSize = (b: FogBox) => b[2] * b[3];

/** FR-FOG-01: a mask whose every cell takes `fill`. */
export function uniformMask(fill: FogFill, box: FogBox): FogMask {
  return { fill, box, cells: new Uint8Array(boxSize(box)).fill(fill === "fog" ? 1 : 0) };
}

/**
 * FR-FOG-04: row-major run lengths over the box, alternating, starting with **fogged**, base 36,
 * comma-separated; `""` when every box cell equals `fill`.
 */
export function encodeRuns(cells: Uint8Array, fill: FogFill): string {
  const f = fill === "fog" ? 1 : 0;
  if (cells.every((c) => c === f)) return "";
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

/** Number of runs in an encoded string (FR-FOG-04 cap: ≤ `FOG_RUNS_MAX`). */
export function runCount(runs: string): number {
  return runs === "" ? 0 : runs.split(",").length;
}

export const runsWithinCap = (runs: string) => runCount(runs) <= FOG_RUNS_MAX;

const BASE36 = /^[0-9a-z]+$/;

/**
 * Decodes `runs` over `n` box cells. `""` = every cell `fill`. Null when malformed or the sum
 * ≠ `n` (the caller fails closed, FR-FOG-04).
 */
export function decodeRuns(runs: string, n: number, fill: FogFill): Uint8Array | null {
  if (runs === "") return new Uint8Array(n).fill(fill === "fog" ? 1 : 0);
  const cells = new Uint8Array(n);
  let at = 0;
  let v = 1;
  for (const part of runs.split(",")) {
    if (!BASE36.test(part)) return null;
    const len = Number.parseInt(part, 36);
    if (at + len > n) return null;
    if (v === 1) cells.fill(1, at, at + len);
    at += len;
    v = 1 - v;
  }
  return at === n ? cells : null;
}

/**
 * The mask of a stored row; no row = every cell clear (FR-FOG-01). A corrupt row decodes fully
 * fogged with `corrupt: true` (fail closed; the server logs an `error`, FR-FOG-04).
 */
export function maskOf(row: FogRow | null): { mask: FogMask; corrupt: boolean } {
  if (row === null) return { mask: uniformMask("clear", [0, 0, 0, 0]), corrupt: false };
  const cells = decodeRuns(row.runs, boxSize(row.box), row.fill);
  if (cells === null) return { mask: uniformMask("fog", row.box), corrupt: true };
  return { mask: { fill: row.fill, box: row.box, cells }, corrupt: false };
}

/** The stored shape of a mask. */
export function rowOf(mask: FogMask): FogRow {
  return { fill: mask.fill, box: mask.box, runs: encodeRuns(mask.cells, mask.fill) };
}

/** Is a cell fogged? Inside the box its value; outside, `fill` (FR-FOG-01). */
export function cellFogged(mask: FogMask, col: number, row: number): boolean {
  const [col0, row0, cols, rows] = mask.box;
  const c = col - col0;
  const r = row - row0;
  if (c < 0 || r < 0 || c >= cols || r >= rows) return mask.fill === "fog";
  return mask.cells[r * cols + c] === 1;
}

/**
 * FR-FOG-03: the mask over a new box. Cells in both keep their value; new cells take `fill`
 * (which is also what cells leaving the box fall back to).
 */
export function rebase(mask: FogMask, box: FogBox): FogMask {
  const [col0, row0, cols, rows] = box;
  const out = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[r * cols + c] = cellFogged(mask, col0 + c, row0 + r) ? 1 : 0;
    }
  }
  return { fill: mask.fill, box, cells: out };
}

/** FR-FOG-10: true iff **every** footprint cell is fogged (an empty footprint is not). */
export function footprintFogged(mask: FogMask, cells: FogCells): boolean {
  if (Array.isArray(cells)) {
    const list = cells as readonly (readonly [number, number])[];
    return list.length > 0 && list.every(([c, r]) => cellFogged(mask, c, r));
  }
  const b = cells as { col: number; row: number; w: number; h: number };
  if (b.w <= 0 || b.h <= 0) return false;
  for (let r = b.row; r < b.row + b.h; r++) {
    for (let c = b.col; c < b.col + b.w; c++) {
      if (!cellFogged(mask, c, r)) return false;
    }
  }
  return true;
}

/** Same cells and fill (the row encodes identically). */
export function sameMask(a: FogMask, b: FogMask): boolean {
  if (a.fill !== b.fill || a.box.some((v, i) => v !== b.box[i])) return false;
  return a.cells.every((v, i) => v === b.cells[i]);
}
