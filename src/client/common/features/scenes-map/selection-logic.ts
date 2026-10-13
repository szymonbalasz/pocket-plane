// DM selection (FR-MAP-31/32): a client-only set of token ids on the viewed scene, and the box
// hit test. DOM-free so it runs under `bun test`; the store lives in `@dm/features/scenes-map/selection`.
import { cellToPx, footprint, type Grid } from "@shared/scenes-map/geometry";
import type { TokenSize } from "@shared/scenes-map/schemas";

export interface SelectionState {
  /** The viewed scene the ids belong to. */
  sceneId: string | null;
  tokenIds: readonly string[];
}

export type SelectionAction =
  /** Plain click on a token: selection = that token. */
  | { type: "click"; id: string }
  /** Ctrl- / Shift-click: toggle it. */
  | { type: "toggle"; id: string }
  /** Empty-canvas click or Esc. */
  | { type: "clear" }
  /** Box select: adds (#154). */
  | { type: "add"; ids: readonly string[] }
  | { type: "set"; ids: readonly string[] }
  /** The viewed scene changed: clear. */
  | { type: "scene"; sceneId: string | null }
  /** Ids that left the store (or the viewed scene) drop out. */
  | { type: "prune"; present: ReadonlySet<string> };

export const emptySelection: SelectionState = { sceneId: null, tokenIds: [] };

const unique = (ids: readonly string[]) => [...new Set(ids)];

export function selectionReducer(s: SelectionState, a: SelectionAction): SelectionState {
  switch (a.type) {
    case "click":
      return { ...s, tokenIds: [a.id] };
    case "toggle":
      return {
        ...s,
        tokenIds: s.tokenIds.includes(a.id)
          ? s.tokenIds.filter((id) => id !== a.id)
          : [...s.tokenIds, a.id],
      };
    case "clear":
      return s.tokenIds.length === 0 ? s : { ...s, tokenIds: [] };
    case "add":
      return { ...s, tokenIds: unique([...s.tokenIds, ...a.ids]) };
    case "set":
      return { ...s, tokenIds: unique(a.ids) };
    case "scene":
      return a.sceneId === s.sceneId ? s : { sceneId: a.sceneId, tokenIds: [] };
    case "prune": {
      const kept = s.tokenIds.filter((id) => a.present.has(id));
      return kept.length === s.tokenIds.length ? s : { ...s, tokenIds: kept };
    }
  }
}

/** Pointer travel (screen px) below which a press is a click, not a drag (FR-MAP-31/32). */
export const CLICK_PX = 4;

export const isClick = (dx: number, dy: number) => Math.hypot(dx, dy) < CLICK_PX;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** FR-MAP-32: tokens whose footprint centre lies inside the box (map px, any drag direction). */
export function tokensInBox(
  tokens: readonly { id: string; col: number; row: number; size: TokenSize }[],
  grid: Grid,
  box: Box,
): string[] {
  const [left, right] = box.x0 <= box.x1 ? [box.x0, box.x1] : [box.x1, box.x0];
  const [top, bottom] = box.y0 <= box.y1 ? [box.y0, box.y1] : [box.y1, box.y0];
  const out: string[] = [];
  for (const t of tokens) {
    const half = (footprint(t.size) * grid.gridCellSize) / 2;
    const p = cellToPx(grid, t.col, t.row);
    const cx = p.x + half;
    const cy = p.y + half;
    if (cx >= left && cx <= right && cy >= top && cy <= bottom) out.push(t.id);
  }
  return out;
}
