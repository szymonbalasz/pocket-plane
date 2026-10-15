// Pure prop rules shared by server and clients (SCN §6 FR-SCN-16–18): map overlap, duplicate
// placement, draw order, hit testing, resize from a handle, to front / to back, rotate. Cells are
// grid cells `(col, row)`; a prop's footprint is `w × h` cells from its top-left cell.
import type { MapRect } from "@shared/scenes-map/geometry";
import {
  COORD_MAX,
  PROP_SIDE_MAX,
  PROP_SIDE_MIN,
  type PropRotation,
  type PropView,
} from "./schemas";

export interface PropBox {
  col: number;
  row: number;
  w: number;
  h: number;
}

/** FR-SCN-16: the footprint must overlap the map rectangle (as FR-MAP-14 for tokens). */
export function propOverlapsMap(m: MapRect, p: PropBox): boolean {
  const cs = m.gridCellSize;
  const x = m.gridOffsetX + p.col * cs;
  const y = m.gridOffsetY + p.row * cs;
  return x < m.mapWidth && x + p.w * cs > 0 && y < m.mapHeight && y + p.h * cs > 0;
}

/**
 * `scn.duplicateProp` placement (as FR-MAP-17 for tokens): `col + w` on the same row if the copy
 * overlaps the map, else `col − w`, else the source cell.
 */
export function duplicatePropCell(m: MapRect, p: PropBox): { col: number; row: number } {
  for (const col of [p.col + p.w, p.col - p.w]) {
    if (propOverlapsMap(m, { ...p, col })) return { col, row: p.row };
  }
  return { col: p.col, row: p.row };
}

/** FR-SCN-18: draw order by `z`, then `seq` (bottom first). */
export function propDrawOrder(a: { z: number; seq: number }, b: { z: number; seq: number }) {
  return a.z - b.z || a.seq - b.seq;
}

export const propContains = (p: PropBox, cell: { col: number; row: number }): boolean =>
  cell.col >= p.col && cell.col < p.col + p.w && cell.row >= p.row && cell.row < p.row + p.h;

/** The topmost prop whose footprint holds `cell`, or null (FR-SCN-17 click select). */
export function propAt<P extends PropView>(
  props: readonly P[],
  cell: { col: number; row: number },
): P | null {
  const hits = props.filter((p) => propContains(p, cell)).sort(propDrawOrder);
  return hits.at(-1) ?? null;
}

/** Resize handles: the four corners of the selected prop (FR-SCN-17). */
export const PROP_HANDLES = ["nw", "ne", "sw", "se"] as const;
export type PropHandle = (typeof PROP_HANDLES)[number];

const clampSide = (n: number) => Math.min(PROP_SIDE_MAX, Math.max(PROP_SIDE_MIN, n));

/**
 * FR-SCN-17: dragging a corner handle to `cell` keeps the opposite corner fixed; each side snaps
 * to whole cells, 1–20.
 */
export function resizeFromHandle(
  p: PropBox,
  handle: PropHandle,
  cell: { col: number; row: number },
): PropBox {
  const right = p.col + p.w; // exclusive
  const bottom = p.row + p.h;
  const west = handle === "nw" || handle === "sw";
  const north = handle === "nw" || handle === "ne";
  const w = clampSide(west ? right - cell.col : cell.col - p.col + 1);
  const h = clampSide(north ? bottom - cell.row : cell.row - p.row + 1);
  return { col: west ? right - w : p.col, row: north ? bottom - h : p.row, w, h };
}

/** FR-SCN-17 To front / To back: one above the scene's top `z`, one below its bottom. */
export function frontZ(props: readonly { id: string; z: number }[], id: string): number | null {
  const others = props.filter((p) => p.id !== id);
  const self = props.find((p) => p.id === id);
  if (!self) return null;
  const top = others.length ? Math.max(...others.map((p) => p.z)) : self.z - 1;
  if (self.z > top) return null;
  return Math.min(COORD_MAX, top + 1);
}

export function backZ(props: readonly { id: string; z: number }[], id: string): number | null {
  const others = props.filter((p) => p.id !== id);
  const self = props.find((p) => p.id === id);
  if (!self) return null;
  const bottom = others.length ? Math.min(...others.map((p) => p.z)) : self.z + 1;
  if (self.z < bottom) return null;
  return Math.max(-COORD_MAX, bottom - 1);
}

/** FR-SCN-17 Rotate 90°: clockwise, 270 → 0. */
export const nextRotation = (r: number): PropRotation => ((r + 90) % 360) as PropRotation;
