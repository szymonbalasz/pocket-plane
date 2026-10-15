// Fog render (FR-FOG-20/21): the stored mask → one shape of row-run rects over the map, re-based to
// the scene's current box (cells keep their index, so fog moves with the grid like tokens; cells
// outside the stored box take `fill`). DOM-free so it runs under `bun test`.
import { type FogRow, fogBox, maskOf, rebase } from "@shared/fog-of-war/mask";
import type { FogBox, FogFill } from "@shared/fog-of-war/schemas";
import type { MapRect } from "@shared/scenes-map/geometry";
import type { CanvasClient } from "../scenes-map/layers";

/** One horizontal run of fogged cells, in map px: `[x, y, w, h]`. */
export type FogRun = readonly [number, number, number, number];

export interface FogRender {
  runs: FogRun[];
  /** Fogged cells drawn (Konva attr `fogged-cells`). */
  cells: number;
}

/** The fields of a `fog` record the render reads (DM and player shapes both carry them). */
export interface FogRecordLike {
  fill: FogFill;
  box: FogBox;
  runs: string;
}

/**
 * FR-FOG-20/21: fogged cells of the map's current box as row runs. No record = no fog
 * (FR-FOG-01); a corrupt `runs` draws fully fogged (fail closed, FR-FOG-04).
 */
export function fogRuns(rec: FogRecordLike | null, m: MapRect): FogRender {
  if (rec === null) return { runs: [], cells: 0 };
  const row: FogRow = { fill: rec.fill, box: rec.box, runs: rec.runs };
  const box = fogBox(m);
  const mask = rebase(maskOf(row).mask, box);
  const [col0, row0, cols, rows] = box;
  const cs = m.gridCellSize;
  const runs: FogRun[] = [];
  let cells = 0;
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && mask.cells[r * cols + c] === 1;
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        runs.push([
          m.gridOffsetX + (col0 + start) * cs,
          m.gridOffsetY + (row0 + r) * cs,
          (c - start) * cs,
          cs,
        ]);
        cells += c - start;
        start = -1;
      }
    }
  }
  return { runs, cells };
}

/** FOG §7 placeholder tokens until theme-system names them (OQ-FOG-17). */
export const FOG_COLOR_VARS = { dm: "--fog-dm", player: "--fog-player" } as const;
export const FOG_COLOR_FALLBACK = "#000000";
/** FR-FOG-20 (OQ-FOG-19): the DM sees fog at ≈ 50 %; players opaque (FR-FOG-21). */
export const FOG_DM_OPACITY = 0.5;

export function fogOpacity(client: CanvasClient): number {
  return client === "dm" ? FOG_DM_OPACITY : 1;
}
