// FR-CBT-65: where created tokens go. The DM client sends `at` = the grid cell under the centre
// of its free area (FR-SHELL-34) when it views the encounter's scene; the server clamps it into
// the map and searches free cells from there. `cellAtScreen` is pure; `freeAreaCell` reads the
// live map stage (as the attack popup's placement does).
import type { GridCell } from "@shared/combat-tracker/schemas";
import { type Grid, pxToCell } from "@shared/scenes-map/geometry";
import { CELL_INDEX_MAX } from "@shared/scenes-map/schemas";
import type { Rect } from "@ui/features/play-shell/geometry";

/** The map stage on screen: container's top-left (viewport px), pan (px) and zoom. */
export interface StageView {
  left: number;
  top: number;
  x: number;
  y: number;
  scale: number;
}

const clampIndex = (n: number) => Math.min(CELL_INDEX_MAX, Math.max(-CELL_INDEX_MAX, n));

/** The cell under a viewport point: screen → stage → map px → cell (FR-MAP-15 grid). */
export function cellAtScreen(p: { x: number; y: number }, s: StageView, grid: Grid): GridCell {
  const mx = (p.x - s.left - s.x) / s.scale;
  const my = (p.y - s.top - s.y) / s.scale;
  const c = pxToCell(grid, mx, my);
  return { col: clampIndex(c.col), row: clampIndex(c.row) };
}

/** The free area's centre (viewport px). */
export const rectCentre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

interface KonvaStage {
  container(): HTMLElement;
  x(): number;
  y(): number;
  scaleX(): number;
}

/** The DM map's live stage, or null (no map shown). */
function liveStage(): StageView | null {
  const K = (window as unknown as { Konva?: { stages: KonvaStage[] } }).Konva;
  const stage = K?.stages.find((s) => s.container().isConnected);
  if (!stage) return null;
  const box = stage.container().getBoundingClientRect();
  const scale = stage.scaleX();
  if (!(scale > 0)) return null;
  return { left: box.left, top: box.top, x: stage.x(), y: stage.y(), scale };
}

/**
 * FR-CBT-65: the cell under the free area's centre on the viewed map, or null when no map is
 * shown (the server then uses the map's centre).
 */
export function freeAreaCell(area: Rect, grid: Grid): GridCell | null {
  const s = liveStage();
  return s ? cellAtScreen(rectCentre(area), s, grid) : null;
}
