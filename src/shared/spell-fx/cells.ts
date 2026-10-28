// Affected cells of an aura (FR-VFX-24, pure): a 5e emanation from a token's footprint.
import type { DiagonalRule } from "@shared/scene-tools/schemas";
import { reachCells } from "@shared/scenes-map/area";
import { type MapRect, overlapsMap } from "@shared/scenes-map/geometry";

export interface Footprint {
  /** Top-left cell. */
  col: number;
  row: number;
  /** Cells per side (FR-MAP-14 `footprint(size)`). */
  side: number;
}

export interface FxCell {
  col: number;
  row: number;
}

/**
 * FR-VFX-24: every cell on the map whose grid distance from some footprint cell is ≤ `radiusFt`,
 * the footprint's own cells excluded; row-major order. Off-map cells are dropped. *(#377 ruling,
 * 2026-10-28)* Distance by the campaign's diagonal `rule` (FR-SCN-30, as the ruler; default
 * `5-10-5`), one rule with AoE templates snapped to a square.
 */
export function emanationCells(
  fp: Footprint,
  radiusFt: number,
  grid: MapRect,
  rule: DiagonalRule = "5-10-5",
): FxCell[] {
  // The shared grid reach (also AoE spheres snapped to a square, DM #377) under the campaign's
  // diagonal rule (FR-SCN-30, as the ruler), minus the footprint.
  const inside = (col: number, row: number) =>
    col >= fp.col && col < fp.col + fp.side && row >= fp.row && row < fp.row + fp.side;
  return reachCells(fp, radiusFt, rule)
    .filter(([col, row]) => !inside(col, row) && overlapsMap(grid, col, row, "medium"))
    .map(([col, row]) => ({ col, row }));
}
