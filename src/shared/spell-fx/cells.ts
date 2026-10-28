// Affected cells of an aura (FR-VFX-24, pure): a 5e emanation from a token's footprint.
import { distanceFt, type MapRect, overlapsMap } from "@shared/scenes-map/geometry";

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
 * FR-VFX-24: every cell on the map whose FR-MAP-22 distance (5/10/5) from some footprint cell is ≤
 * `radiusFt`, the footprint's own cells excluded; row-major order. Off-map cells are dropped.
 */
export function emanationCells(fp: Footprint, radiusFt: number, grid: MapRect): FxCell[] {
  const reach = Math.floor(radiusFt / 5);
  const out: FxCell[] = [];
  for (let row = fp.row - reach; row < fp.row + fp.side + reach; row++) {
    for (let col = fp.col - reach; col < fp.col + fp.side + reach; col++) {
      const inside =
        col >= fp.col && col < fp.col + fp.side && row >= fp.row && row < fp.row + fp.side;
      if (inside || !overlapsMap(grid, col, row, "medium")) continue;
      // Nearest footprint cell: clamp into the footprint square.
      const near = {
        col: Math.min(Math.max(col, fp.col), fp.col + fp.side - 1),
        row: Math.min(Math.max(row, fp.row), fp.row + fp.side - 1),
      };
      if (distanceFt({ col, row }, near) <= radiusFt) out.push({ col, row });
    }
  }
  return out;
}
