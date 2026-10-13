// Open placement for windows without stored geometry (FR-SHELL-08/14). Pure.
// 1. The default rect, fitted to the usable area (shrunk, never below min size).
// 2. If it overlaps an open window, the nearest free slot next to one (cascade), else the
//    tallest free slot ≥ min height, else the spot that covers the least.
import {
  defaultRect,
  EDGE_GAP,
  LAUNCHER_CLEAR,
  type Rect,
  TOP_BAR_H,
  type Viewport,
} from "./geometry";
import type { WindowDef } from "./registry";

/** Left edge clear of the tool rail (scenes-map's, ≈ 56 px wide) plus a gap. */
export const RAIL_CLEAR = 68;

export type Placeable = Pick<
  WindowDef,
  "defaultPosition" | "defaultSize" | "minSize" | "fixedDefault"
>;

interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where default-placed windows may go: below the top bar, above the launcher, edge gaps. */
export function usableArea(vp: Viewport): Area {
  return {
    left: EDGE_GAP,
    top: TOP_BAR_H + EDGE_GAP,
    right: vp.w - EDGE_GAP,
    bottom: vp.h - EDGE_GAP - LAUNCHER_CLEAR,
  };
}

/** Moves (pos, len) into [lo, hi]; shrinks len first, never below min. */
function fitAxis(pos: number, len: number, min: number, lo: number, hi: number): [number, number] {
  let p = Math.max(lo, pos);
  const l = Math.max(min, Math.min(len, hi - p));
  if (p + l > hi) p = Math.max(lo, hi - l);
  return [p, l];
}

/** The default rect, fitted to the usable area: e.g. a tall window ends above the launcher. */
export function fittedDefaultRect(def: Placeable, vp: Viewport): Rect {
  const r = defaultRect(def.defaultPosition, def.defaultSize, vp);
  const a = usableArea(vp);
  const [x, w] = fitAxis(r.x, r.w, def.minSize.w, a.left, a.right);
  const [y, h] = fitAxis(r.y, r.h, def.minSize.h, a.top, a.bottom);
  return { x, y, w, h };
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Height free below (x, y) for width w, up to `max`; 0 if (x, y) itself is covered. */
function freeHeight(x: number, y: number, w: number, max: number, obstacles: readonly Rect[]) {
  let h = max;
  for (const o of obstacles) {
    if (x >= o.x + o.w || o.x >= x + w) continue;
    if (o.y <= y && y < o.y + o.h) return 0;
    if (o.y >= y) h = Math.min(h, o.y - y - EDGE_GAP);
  }
  return Math.max(0, h);
}

/**
 * Where a window with no stored geometry opens, given the rendered rects of the windows
 * already open. Ranking: (free at full size, nearest to default) < (free at ≥ min height,
 * tallest) < (least overlap). Deterministic.
 */
export function placeRect(def: Placeable, vp: Viewport, obstacles: readonly Rect[]): Rect {
  const base = fittedDefaultRect(def, vp);
  if (def.fixedDefault) return base;
  const a = usableArea(vp);
  const { w } = base;
  const minH = Math.min(def.minSize.h, base.h);
  const g = EDGE_GAP;
  const spots: { x: number; y: number }[] = [{ x: base.x, y: base.y }];
  for (const o of obstacles) {
    const right = o.x + o.w + g;
    const left = o.x - g - w;
    const below = o.y + o.h + g;
    spots.push(
      { x: right, y: o.y },
      { x: left, y: o.y },
      { x: right, y: base.y },
      { x: left, y: base.y },
      { x: o.x, y: below },
      { x: o.x + o.w - w, y: below },
      { x: base.x, y: below },
    );
  }
  spots.push(
    { x: a.left, y: a.top },
    { x: a.right - w, y: a.top },
    { x: a.left, y: a.bottom - base.h },
    { x: a.right - w, y: a.bottom - base.h },
  );

  // Moved windows stay right of the tool rail (unless their default is already left of it).
  const minX = Math.max(a.left, Math.min(base.x, RAIL_CLEAR));
  let best: { rect: Rect; rank: [number, number, number] } | null = null;
  for (const s of spots) {
    const x = Math.max(minX, Math.min(s.x, a.right - w));
    const y = Math.max(a.top, Math.min(s.y, a.bottom - minH));
    const room = Math.min(base.h, a.bottom - y);
    const free = freeHeight(x, y, w, room, obstacles);
    const dist = Math.abs(x - base.x) + Math.abs(y - base.y);
    let rect: Rect;
    let rank: [number, number, number];
    if (free >= base.h) {
      rect = { x, y, w, h: base.h };
      rank = [0, 0, dist];
    } else if (free >= minH) {
      rect = { x, y, w, h: free };
      rank = [1, -free, dist];
    } else {
      rect = { x, y, w, h: Math.max(minH, room) };
      rank = [2, obstacles.reduce((n, o) => n + overlapArea(rect, o), 0), dist];
    }
    if (!best || lexLess(rank, best.rank)) best = { rect, rank };
  }
  return best?.rect ?? base;
}

function lexLess(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}
