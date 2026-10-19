// Auto placement: where a window goes when the user didn't choose (FR-SHELL-08, -40, -45–47,
// -51). Pure, deterministic.
// Candidates: the fitted default rect; every spot in the default column and the left / right
// edge column at the rows given by the usable area's and every open window's and keep-out
// region's edges (± 12), each at full size, at `minOpenH`, shrunk to the height free there, and
// at min height (fallback). When no edge candidate is clear, keeps `minOpenH` and covers no PC,
// columns beside every open window and keep-out region are added (inward columns, FR-SHELL-46).
// Rank, lexicographic (FR-SHELL-45):
//   (1) clear of every open window and hard keep-out region (else, screen full: no protected
//       window, no title bar, least protected area, least overlap; FR-SHELL-47's fallback);
//   (2) covers no PC token centre; (1b) `minOpenH` windows: clear at ≥ `minOpenH` (after (2):
//   a slightly shorter window beats one over a PC, walkthrough W1);
//   (3) edge column before inward; (4) clear of soft keep-out regions; (5) least token area;
//   (6) full size (≥ `minOpenH` counts as full; else, `minOpenH` windows: the tallest, FR-NOTE-31);
//   (7) default column; (8) nearest to the fitted default rect, then taller, higher, more left,
//   least over soft regions.
// A window that renders taller than its min size (`need`: a `growToContent` window's measured
// content height, FR-SHELL-39) never gets a slot shorter than that.
import {
  defaultRect,
  EDGE_GAP,
  LAUNCHER_CLEAR,
  type Rect,
  TITLE_H,
  TOP_BAR_H,
  type Viewport,
} from "./geometry";
import { defaultSizeAt, type WindowDef } from "./registry";

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

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * The default rect at the type's default size for this viewport (FR-SHELL-51), fitted to the
 * usable area: e.g. a tall window ends above the launcher. A top-anchored rect that would overlap
 * a `hard` keep-out region below its top (the players' toast corner) ends 12 px above it, never
 * below min size; any other overlapping rect is left as is (placement puts it elsewhere).
 */
export function fittedDefaultRect(def: Placeable, vp: Viewport, hard: readonly Rect[] = []): Rect {
  const r = defaultRect(def.defaultPosition, defaultSizeAt(def, vp), vp);
  const a = usableArea(vp);
  const [x, w] = fitAxis(r.x, r.w, def.minSize.w, a.left, a.right);
  const [y, h] = fitAxis(r.y, r.h, def.minSize.h, a.top, a.bottom);
  let out = { x, y, w, h };
  if (def.defaultPosition.anchor.startsWith("top")) {
    for (const k of hard) {
      if (k.y <= y || overlapArea(out, k) === 0) continue;
      const cut = k.y - EDGE_GAP - y;
      if (cut >= def.minSize.h && cut < out.h) out = { ...out, h: cut };
    }
  }
  return out;
}

/** An open window placement must avoid; `protected`: a default-open type (FR-SHELL-45). */
export interface Obstacle extends Rect {
  protected?: boolean;
}

/** A drawn token's on-screen box; `pc`: it has an owner (a PC, FR-SHELL-45 (2)). */
export interface PlacementToken extends Rect {
  pc?: boolean;
}

export interface PlaceInput {
  /** Rendered rects of the windows open now (minus the one placed). */
  windows?: readonly Obstacle[];
  /** Hard keep-out regions: blocked like windows (FR-SHELL-48). */
  hard?: readonly Rect[];
  /** Soft keep-out regions: avoided when possible (FR-SHELL-45 (4)). */
  soft?: readonly Rect[];
  /** On-screen token boxes (this client's, current camera). */
  tokens?: readonly PlacementToken[];
  /** Height the window renders at (measured content), if known. */
  need?: number;
  /**
   * Nothing is left to auto-minimise (FR-SHELL-47): also try the window at min size (FR-SHELL-45's
   * last resort), in every column.
   */
  lastResort?: boolean;
}

export interface Placement {
  rect: Rect;
  /** Clear of every open window and hard keep-out region; false = screen full (FR-SHELL-47). */
  clear: boolean;
}

const inside = (px: number, py: number, r: Rect) =>
  px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;

/** Where a window opens by itself (auto placement; rank in the header). */
export function placeWindow(def: Placeable, vp: Viewport, input: PlaceInput = {}): Placement {
  const windows = input.windows ?? [];
  const hard = input.hard ?? [];
  const soft = input.soft ?? [];
  const tokens = input.tokens ?? [];
  const base = fittedDefaultRect(def, vp, hard);
  if (def.fixedDefault) return { rect: base, clear: true };
  const a = usableArea(vp);
  const g = EDGE_GAP;
  const { w } = base;
  const need = Math.ceil(input.need ?? 0);
  const fullH = Math.min(Math.max(base.h, need), a.bottom - a.top);
  const minH = Math.min(Math.max(def.minSize.h, need), fullH);
  const openH = def.minOpenH === undefined ? null : Math.max(minH, Math.min(def.minOpenH, fullH));
  // Moved windows stay right of the tool rail (unless their default is already left of it).
  const minX = Math.max(a.left, Math.min(base.x, RAIL_CLEAR));
  const blockers: Rect[] = [...windows, ...hard];
  // "Clear" keeps the 12 px gap to every window and hard region.
  const padded = blockers.map((o) => ({ x: o.x - g, y: o.y - g, w: o.w + 2 * g, h: o.h + 2 * g }));
  const regions: Rect[] = [...windows, ...hard, ...soft];
  const heights = [fullH, minH, ...(openH === null ? [] : [openH])];
  const ys = new Set([base.y, a.top, ...heights.map((h) => a.bottom - h)]);
  for (const o of regions) {
    ys.add(o.y);
    ys.add(o.y + o.h + g);
    for (const h of heights) ys.add(o.y - g - h);
  }
  const titleBars = windows.map((o) => ({ x: o.x, y: o.y, w: o.w, h: TITLE_H }));
  const pcs = tokens.filter((t) => t.pc).map((t) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 }));

  /** Free height below (x, y) for width `cw`, up to `max`; 0 if (x, y) itself is covered. */
  const freeHeight = (x: number, y: number, cw: number, max: number) => {
    let h = max;
    for (const o of blockers) {
      if (x >= o.x + o.w || o.x >= x + cw) continue;
      if (o.y <= y && y < o.y + o.h) return 0;
      if (o.y >= y) h = Math.min(h, o.y - y - g);
    }
    return Math.max(0, h);
  };

  /** What a column [x, x + cw] can touch (placement is ≤ ~1,000 candidates; keep each cheap). */
  const inColumn = (x: number, cw: number) => {
    const across = <T extends Rect>(list: readonly T[]) =>
      list.filter((o) => o.x < x + cw && x < o.x + o.w);
    return {
      windows: across(windows),
      hard: across(hard),
      padded: across(padded),
      titleBars: across(titleBars),
      soft: across(soft),
      tokens: across(tokens),
      pcs: pcs.filter((p) => p.x > x && p.x < x + cw),
    };
  };
  type Column = ReturnType<typeof inColumn>;

  const rank = (r: Rect, inward: boolean, c: Column): number[] => {
    let overlap = 0;
    let prot = 0;
    for (const o of c.windows) {
      const n = overlapArea(r, o);
      overlap += n;
      if (o.protected) prot += n;
    }
    for (const o of c.hard) overlap += overlapArea(r, o);
    const clear = !c.padded.some((o) => overlapArea(r, o) > 0);
    const title = c.titleBars.some((t) => overlapArea(r, t) > 0) ? 1 : 0;
    const keepsOpenH = openH === null || (clear && r.h >= openH) ? 0 : 1;
    const pc = c.pcs.some((p) => inside(p.x, p.y, r)) ? 1 : 0;
    const softArea = c.soft.reduce((n, s) => n + overlapArea(r, s), 0);
    const tokenArea = c.tokens.reduce((n, t) => n + overlapArea(r, t), 0);
    const full = r.h >= (openH ?? fullH) && r.w === w ? 0 : 1;
    const column = r.x === base.x ? 0 : 1;
    const dist = Math.abs(r.x - base.x) + Math.abs(r.y - base.y);
    return [
      clear ? 0 : 1,
      prot > 0 ? 1 : 0,
      title,
      prot,
      overlap,
      pc,
      keepsOpenH,
      inward ? 1 : 0,
      softArea > 0 ? 1 : 0,
      tokenArea,
      full,
      openH === null ? 0 : -r.h,
      column,
      dist,
      -r.h,
      r.y,
      r.x,
      softArea,
    ];
  };

  let best: { rect: Rect; rank: number[] } | null = null;
  const seen = new Set<string>();
  let cur: Column = inColumn(base.x, w);
  const minW = Math.min(def.minSize.w, w);
  /**
   * A candidate over PC token centres, shrunk (≥ min size) to clear them: narrower keeping its
   * left or right edge, shorter keeping its top or bottom (#245: cover only when no size avoids
   * it), so rank (2) beats (6) full size.
   */
  const clearOfPcs = (r: Rect): Rect[] => {
    const under = cur.pcs.filter((p) => inside(p.x, p.y, r));
    if (under.length === 0) return [];
    const px = under.map((p) => p.x);
    const py = under.map((p) => p.y);
    const out: Rect[] = [];
    const lw = Math.floor(Math.min(...px) - r.x);
    if (lw >= minW) out.push({ ...r, w: lw });
    const rx = Math.ceil(Math.max(...px));
    if (r.x + r.w - rx >= minW) out.push({ ...r, x: rx, w: r.x + r.w - rx });
    const th = Math.floor(Math.min(...py) - r.y);
    if (th >= minH) out.push({ ...r, h: th });
    const by = Math.ceil(Math.max(...py));
    if (r.y + r.h - by >= minH) out.push({ ...r, y: by, h: r.y + r.h - by });
    return out;
  };
  const consider = (rect: Rect, inward: boolean): void => {
    const key = `${rect.x},${rect.y},${rect.w},${rect.h},${inward}`;
    if (seen.has(key)) return;
    seen.add(key);
    const r = rank(rect, inward, cur);
    if (!best || lexLess(r, best.rank)) best = { rect, rank: r };
    if (r[5] === 1) for (const s of clearOfPcs(rect)) consider(s, inward);
  };
  const column = (x0: number, inward: boolean, cw = w) => {
    const x = Math.max(minX, Math.min(x0, a.right - cw));
    cur = inColumn(x, cw);
    for (const y0 of ys) {
      const at = (h: number) => Math.max(a.top, Math.min(y0, a.bottom - h));
      if (cw !== w) {
        consider({ x, y: at(minH), w: cw, h: minH }, inward);
        continue;
      }
      for (const h of heights) consider({ x, y: at(h), w, h }, inward);
      const y = at(minH);
      const free = Math.min(freeHeight(x, y, w, a.bottom - y), fullH);
      if (free >= minH) consider({ x, y, w, h: free }, inward);
    }
  };
  consider(base, false);
  const edges = (cw: number) => new Set([base.x, minX, a.right - cw]);
  for (const x of edges(w)) column(x, false);
  // FR-SHELL-46: inward columns only when no edge candidate passes (1), (1b) and (2).
  const passes = (r: number[]) => r[0] === 0 && r[5] === 0 && r[6] === 0;
  const inwardXs = (cw: number) => {
    const xs = new Set<number>();
    for (const o of regions) {
      xs.add(o.x + o.w + g);
      xs.add(o.x - g - cw);
    }
    return xs;
  };
  if (!passes((best as { rank: number[] } | null)?.rank ?? [1])) {
    for (const x of inwardXs(w)) column(x, true);
  }
  // FR-SHELL-45's last resort: min size (FR-SHELL-47 calls it once nothing is left to park).
  if (input.lastResort && minW < w && (best as { rank: number[] } | null)?.rank[0] !== 0) {
    for (const x of edges(minW)) column(x, false, minW);
    for (const x of inwardXs(minW)) column(x, true, minW);
  }
  const chosen = best as { rect: Rect; rank: number[] } | null;
  return chosen ? { rect: chosen.rect, clear: chosen.rank[0] === 0 } : { rect: base, clear: true };
}

function lexLess(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}
