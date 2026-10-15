// Open placement for windows without stored geometry (FR-SHELL-08/14). Pure.
// 1. The default rect, fitted to the usable area (shrunk, never below min size).
// 2. If it overlaps an open window: edge-first, never a mid-map column (map-first, #162). A
//    full-size free slot at either edge (the one over fewer map tokens, P3 glitch 13; then its
//    default column first, then the nearest) beats a
//    shrunk one (FR-NOTE-31 ruling); with none, a window with `minOpenH` opens at that height on
//    top, covering the least; any other takes the tallest free slot ≥ min height (default column
//    first); all full → the spot covering least, in its default column first (a cascade), then
//    at the other edge.
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
  "defaultPosition" | "defaultSize" | "minSize" | "fixedDefault" | "minOpenH"
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
 * already open (`avoid`: on-screen map token boxes, P3 glitch 13). Ranking: free at full size
 * (least token area covered, then default column, then the left / right edge column; nearest to
 * default) < `minOpenH` set: that height, least overlap (default column first) <
 * free at ≥ min height (default column first, tallest) < least overlap in the default column <
 * least overlap at an edge. Mid-map columns never. Deterministic.
 */
export function placeRect(
  def: Placeable,
  vp: Viewport,
  obstacles: readonly Rect[],
  avoid: readonly Rect[] = [],
): Rect {
  const base = fittedDefaultRect(def, vp);
  if (def.fixedDefault) return base;
  const a = usableArea(vp);
  const { w } = base;
  const minH = Math.min(def.minSize.h, base.h);
  const g = EDGE_GAP;
  // Moved windows stay right of the tool rail (unless their default is already left of it).
  const minX = Math.max(a.left, Math.min(base.x, RAIL_CLEAR));
  // Columns: the default one and the left / right edge; never mid-map (#162). Every free slot
  // in a column touches the area's or an open window's top or bottom (+ gap): those lines
  // cover them all.
  const xs = new Set([base.x, minX, a.right - w]);
  const ys = new Set([base.y, a.top, a.bottom - base.h, a.bottom - minH]);
  for (const o of obstacles) {
    for (const y of [o.y, o.y + o.h + g, o.y - g - base.h, o.y - g - minH]) ys.add(y);
  }
  const spots: { x: number; y: number }[] = [];
  for (const x of xs) for (const y of ys) spots.push({ x, y });
  // Opt-in open height (never shrunk below it), clamped to the usable area.
  const openH =
    def.minOpenH === undefined ? null : Math.min(def.minOpenH, base.h, a.bottom - a.top);
  const covered = (r: Rect) => obstacles.reduce((n, o) => n + overlapArea(r, o), 0);
  const onTokens = (r: Rect) => avoid.reduce((n, t) => n + overlapArea(r, t), 0);
  let best: { rect: Rect; rank: number[] } | null = null;
  const consider = (rect: Rect, rank: number[]) => {
    if (!best || lexLess(rank, best.rank)) best = { rect, rank };
  };
  for (const s of spots) {
    const x = Math.max(minX, Math.min(s.x, a.right - w));
    const column = x === base.x ? 0 : 1; // default column, else the left / right edge
    const y = Math.max(a.top, Math.min(s.y, a.bottom - minH));
    const room = Math.min(base.h, a.bottom - y);
    const free = freeHeight(x, y, w, room, obstacles);
    const dist = Math.abs(x - base.x) + Math.abs(y - base.y);
    if (free >= base.h) {
      const rect = { x, y, w, h: base.h };
      consider(rect, [0, onTokens(rect), column, dist]);
    } else if (openH !== null) {
      const oy = Math.max(a.top, Math.min(s.y, a.bottom - openH));
      const rect = { x, y: oy, w, h: openH };
      consider(rect, [1, covered(rect), column, Math.abs(oy - base.y) + Math.abs(x - base.x)]);
    } else if (free >= minH) {
      consider({ x, y, w, h: free }, [2, column, -free, dist]);
    } else {
      const rect = { x, y, w, h: Math.max(minH, room) };
      consider(rect, [3 + column, covered(rect), dist, 0]);
    }
  }
  return (best as { rect: Rect } | null)?.rect ?? base;
}

function lexLess(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}
