// AoE origin snap (FR-SCN-43, amended by DM #375), pure and DOM-free: where a press (or a kept
// template's origin drag) puts the origin. Sphere, cylinder, cone and line: the centre of the cell
// under the pointer; over a token larger than one cell a sphere / cylinder takes the token's
// centre (its footprint's centre: a vertex for even sizes); the cube keeps its corner on the
// nearest grid vertex (whole cells). Ctrl (`free`): the point itself, to 0.01 cell. Snapped
// origins stay on the map's cells. One helper for placing, the ephemeral drag signal and kept
// origin moves (FR-SCN-26, -45); it also names the cells the AoE tool highlights while placing.
// DM #377: a snapped sphere / cylinder carries that block's side as its `footprint` (its squares
// are then the grid reach from the block, FR-SCN-41).
import type { TemplateShape } from "@shared/scene-tools/schemas";
import { snapPoint } from "@shared/scenes-map/area";
import { footprint, type MapRect } from "@shared/scenes-map/geometry";
import type { TokenSize } from "@shared/scenes-map/schemas";
import type { GridPoint } from "./templates";

/** A token footprint in grid cells: top-left cell (`col`, `row`), `n` cells per side. */
export interface SnapToken {
  col: number;
  row: number;
  n: number;
}

/** The cells the map overlaps, inclusive (grid offsets may leave part cells at the edges). */
export interface CellBounds {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export interface SnapOptions {
  /** Ctrl held: free to 0.01 cell (FR-SCN-43). */
  free: boolean;
  /** Tokens on the shown scene, in draw order (the last one containing the pointer wins). */
  tokens?: readonly SnapToken[];
  /** Clamp snapped origins to these cells (the map's); absent → unclamped. */
  bounds?: CellBounds | null;
}

/** A snapped origin, plus the square block it centres on (`n` cells) to highlight, if any. */
export interface AoeOrigin extends GridPoint {
  cell: SnapToken | null;
}

/** #377: a sphere / cylinder snapped to a square or a token: its origin block's side, else none. */
export const footprintOf = (shape: TemplateShape, o: AoeOrigin): number | undefined =>
  (shape === "sphere" || shape === "cylinder") && o.cell ? o.cell.n : undefined;

/** Token records → footprints (FR-MAP-14 sizes). */
export const snapTokens = (
  tokens: readonly { col: number; row: number; size: TokenSize }[],
): SnapToken[] => tokens.map((t) => ({ col: t.col, row: t.row, n: footprint(t.size) }));

/** The cells a map rectangle overlaps (grid units; at least one cell). */
export function mapCells(m: MapRect): CellBounds {
  const cs = m.gridCellSize;
  const c0 = Math.floor(-m.gridOffsetX / cs) + 0;
  const r0 = Math.floor(-m.gridOffsetY / cs) + 0;
  return {
    c0,
    r0,
    c1: Math.max(c0, Math.ceil((m.mapWidth - m.gridOffsetX) / cs) - 1),
    r1: Math.max(r0, Math.ceil((m.mapHeight - m.gridOffsetY) / cs) - 1),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** FR-SCN-43 (#375): the origin a pointer at grid point `p` gives a template of `shape`. */
export function aoeOrigin(shape: TemplateShape, p: GridPoint, o: SnapOptions): AoeOrigin {
  if (o.free) return { ...snapPoint(p, true), cell: null };
  const b = o.bounds;
  if (shape === "cube") {
    const v = snapPoint(p, false);
    if (!b) return { ...v, cell: null };
    return { x: clamp(v.x, b.c0, b.c1 + 1), y: clamp(v.y, b.r0, b.r1 + 1), cell: null };
  }
  if (shape === "sphere" || shape === "cylinder") {
    const tokens = o.tokens ?? [];
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i] as SnapToken;
      if (t.n > 1 && p.x >= t.col && p.x < t.col + t.n && p.y >= t.row && p.y < t.row + t.n) {
        return { x: t.col + t.n / 2, y: t.row + t.n / 2, cell: t };
      }
    }
  }
  let col = Math.floor(p.x);
  let row = Math.floor(p.y);
  if (b) {
    col = clamp(col, b.c0, b.c1);
    row = clamp(row, b.r0, b.r1);
  }
  return { x: col + 0.5, y: row + 0.5, cell: { col, row, n: 1 } };
}
