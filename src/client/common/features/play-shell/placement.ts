// Auto placement: where a window goes when the user didn't choose (FR-SHELL-08/14/40). Pure.
// 1. The default rect, fitted to the usable area (shrunk, never below min size).
// 2. If it overlaps an open window: edge-first, never a mid-map column (map-first, #162). A
//    full-size free slot at either edge (the one over fewer map tokens, P3 glitch 13; then its
//    default column first, then the nearest) beats a
//    shrunk one (FR-NOTE-31 ruling); with none, a window with `minOpenH` opens at that height on
//    top, covering the least; any other takes the tallest free slot ≥ min height (default column
//    first); all full → the spot covering least, in its default column first (a cascade), then
//    at the other edge.
// 3. Sprint 4 (FR-SHELL-40): every candidate, the default rect included, is scored by the token
//    area it covers: of the candidates free of other windows (full size or shrunk), the least
//    covering wins; ties → the order above. Then, among equals, one clear of this client's toast
//    keep-out box (`toastKeepOut`), else the least over it. No free candidate → the cascade,
//    still least token cover first, then least window overlap before the keep-out box.
// 4. A window that renders taller than its min size (`need`: a `growToContent` window's measured
//    content height, FR-SHELL-39) never gets a slot shorter than that: a slot that can't hold
//    what it renders at is not free (M4 walkthrough, M8).
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
 * Where a window opens by itself (auto placement, FR-SHELL-40), given the rendered rects of the
 * windows already open (`avoid`: on-screen map token boxes; `keepOut`: the client's toast
 * keep-out box). Free of every open window first (least token area, then full size before
 * shrunk to ≥ min height); else `minOpenH` set: that height on top; else the default column,
 * then an edge (least token area first, then least window overlap, then clear of `keepOut`:
 * toasts are transient, another window isn't).
 * Among equals: clear of `keepOut` (else least over it), default column, nearest to default
 * (tallest first for shrunk slots). Mid-map columns never. Deterministic.
 * `need`: the height the window renders at (measured content), if known: no rect is shorter than
 * it (capped to the usable area), and a full-size slot holds the taller of it and the default.
 */
export function placeRect(
  def: Placeable,
  vp: Viewport,
  obstacles: readonly Rect[],
  avoid: readonly Rect[] = [],
  keepOut: Rect | null = null,
  need?: number,
): Rect {
  const base = fittedDefaultRect(def, vp);
  if (def.fixedDefault) return base;
  const a = usableArea(vp);
  const { w } = base;
  // Full size and min height: never below what the window renders at (step 4).
  const fullH = Math.min(Math.max(base.h, Math.ceil(need ?? 0)), a.bottom - a.top);
  const minH = Math.min(Math.max(def.minSize.h, Math.ceil(need ?? 0)), fullH);
  const g = EDGE_GAP;
  // Moved windows stay right of the tool rail (unless their default is already left of it).
  const minX = Math.max(a.left, Math.min(base.x, RAIL_CLEAR));
  // Columns: the default one and the left / right edge; never mid-map (#162). Every free slot
  // in a column touches the area's or an open window's top or bottom (+ gap): those lines
  // cover them all.
  const xs = new Set([base.x, minX, a.right - w]);
  const ys = new Set([base.y, a.top, a.bottom - fullH, a.bottom - minH]);
  for (const o of obstacles) {
    for (const y of [o.y, o.y + o.h + g, o.y - g - fullH, o.y - g - minH]) ys.add(y);
  }
  const spots: { x: number; y: number }[] = [];
  for (const x of xs) for (const y of ys) spots.push({ x, y });
  // Opt-in open height (never shrunk below it), clamped to the usable area.
  const openH = def.minOpenH === undefined ? null : Math.max(minH, Math.min(def.minOpenH, fullH));
  const covered = (r: Rect) => obstacles.reduce((n, o) => n + overlapArea(r, o), 0);
  const onTokens = (r: Rect) => avoid.reduce((n, t) => n + overlapArea(r, t), 0);
  // Toast keep-out: [over it at all, how much].
  const toasts = (r: Rect) => {
    const n = keepOut ? overlapArea(r, keepOut) : 0;
    return [n > 0 ? 1 : 0, n] as const;
  };
  let best: { rect: Rect; rank: number[] } | null = null;
  const consider = (rect: Rect, rank: number[]) => {
    if (!best || lexLess(rank, best.rank)) best = { rect, rank };
  };
  for (const s of spots) {
    const x = Math.max(minX, Math.min(s.x, a.right - w));
    const column = x === base.x ? 0 : 1; // default column, else the left / right edge
    const y = Math.max(a.top, Math.min(s.y, a.bottom - minH));
    const room = Math.min(fullH, a.bottom - y);
    const free = freeHeight(x, y, w, room, obstacles);
    const dist = Math.abs(x - base.x) + Math.abs(y - base.y);
    // Rank: [over a window, token area, step, keep-out flag, …today's order].
    if (free >= fullH) {
      const rect = { x, y, w, h: fullH };
      const [over, ko] = toasts(rect);
      consider(rect, [0, onTokens(rect), 0, over, ko, column, dist]);
    } else if (openH !== null) {
      const oy = Math.max(a.top, Math.min(s.y, a.bottom - openH));
      const rect = { x, y: oy, w, h: openH };
      const [over, ko] = toasts(rect);
      const d = Math.abs(oy - base.y) + Math.abs(x - base.x);
      consider(rect, [1, onTokens(rect), 0, covered(rect), over, ko, column, d]);
    } else if (free >= minH) {
      const rect = { x, y, w, h: free };
      const [over, ko] = toasts(rect);
      consider(rect, [0, onTokens(rect), 1, over, ko, column, -free, dist]);
    } else {
      const rect = { x, y, w, h: Math.max(minH, room) };
      const [over, ko] = toasts(rect);
      consider(rect, [1, onTokens(rect), 1 + column, covered(rect), over, ko, dist]);
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
