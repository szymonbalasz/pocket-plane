// Per-client camera (FR-MAP-12): pan/zoom never sent. Map px → screen px = p × scale + (x, y).
// A scene opens framed in the free area (FR-MAP-44, R1), never below a readable cell (FR-MAP-46);
// a viewport resize refits while fitted (FR-MAP-47); BL-01: the map then pans to fill the canvas.
// FR-MAP-58: "the free area" is the candidate free rectangle the tokens fit best (`bestFreeRect`).
import { footprint, type Grid } from "@shared/scenes-map/geometry";
import type { TokenSize } from "@shared/scenes-map/schemas";
import { TOP_BAR_H, workArea } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";
import { labelMetrics } from "./label";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  w: number;
  h: number;
}

/** FR-MAP-12 zoom range 10–400 % *(proposed, OQ-MAP-20)*. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
/** Per wheel notch. */
export const ZOOM_STEP = 1.1;

export const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

/** Opening a scene fits the map to the viewport, centred, with a margin. */
export function fitCamera(map: Size, view: Size, margin = 24): Camera {
  if (view.w <= 0 || view.h <= 0 || map.w <= 0 || map.h <= 0) return { x: 0, y: 0, scale: 1 };
  const scale = clampScale(
    Math.min((view.w - 2 * margin) / map.w, (view.h - 2 * margin) / map.h) || ZOOM_MIN,
  );
  return { x: (view.w - map.w * scale) / 2, y: (view.h - map.h * scale) / 2, scale };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box (map px) of the footprints of `tokens`; none → null. */
export function footprintBox(
  tokens: readonly { col: number; row: number; size: TokenSize }[],
  grid: Grid,
): Box | null {
  if (tokens.length === 0) return null;
  const c = grid.gridCellSize;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const t of tokens) {
    const n = footprint(t.size);
    const x = grid.gridOffsetX + t.col * c;
    const y = grid.gridOffsetY + t.row * c;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + n * c);
    y1 = Math.max(y1, y + n * c);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * FR-MAP-44 content box (map px): the bounding box of the footprints of `tokens`, grown by one
 * cell per side, cut to the map rectangle. No tokens (or none on the map) → the map rectangle.
 */
export function contentBox(
  tokens: readonly { col: number; row: number; size: TokenSize }[],
  grid: Grid,
  map: Size,
): Box {
  const whole = { x: 0, y: 0, w: map.w, h: map.h };
  const fp = footprintBox(tokens, grid);
  if (!fp) return whole;
  const c = grid.gridCellSize;
  const bx0 = Math.max(0, fp.x - c);
  const by0 = Math.max(0, fp.y - c);
  const bx1 = Math.min(map.w, fp.x + fp.w + c);
  const by1 = Math.min(map.h, fp.y + fp.h + c);
  if (bx1 <= bx0 || by1 <= by0) return whole;
  return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
}

/** FR-MAP-44 margin inside the free area (px). */
export const FIT_MARGIN = 16;

/** FR-MAP-46 fit floor: a fit never draws a grid cell smaller than this (screen px). */
export const FIT_MIN_CELL_PX = 48;

/** A fit camera; `floor` = the FR-MAP-46 floor set the scale (`data-fit-floor`). */
export interface Fit extends Camera {
  floor: boolean;
}

/** FR-MAP-44 (3): the scale fitting `box` into `free` minus the margin, capped at `cap`. */
const fitScale = (box: Box, free: Box, cap: number) =>
  clampScale(Math.min(cap, (free.w - 2 * FIT_MARGIN) / box.w, (free.h - 2 * FIT_MARGIN) / box.h));

/** What the fit priority (V7 ruling) looks at per candidate: `fitContent`'s inputs, map px. */
export interface FitPriority {
  cell: number;
  pcs: Box | null;
  /** Every token's footprint this client has on the scene. */
  tokens: readonly Box[];
}

const within = (p: { x: number; y: number }, r: Box) =>
  p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/**
 * FR-MAP-58: of the candidate free rectangles (FR-SHELL-44), the best for `box`. With `priority`
 * each candidate is first fitted (`fitContent`) and ranked by the V7 fit priority: the PCs in it
 * > the map's top row at or below the top bar > the most token centres on screen clear of every
 * window (in some candidate); then the largest scale (FR-MAP-44's, capped by the whole-map fit
 * into `work`, before the floor); ties → the larger area, then the higher, then the more left
 * one. `area` = FR-SHELL-34's free area: when it isn't a candidate (its small-area fallback) or
 * there are none, it is the only one.
 */
export function bestFreeRect(
  box: Box,
  areas: readonly Box[],
  area: Box,
  map: Size,
  work: Size,
  priority?: FitPriority,
): Box {
  const same = (a: Box) => a.x === area.x && a.y === area.y && a.w === area.w && a.h === area.h;
  if (box.w <= 0 || box.h <= 0 || !areas.some(same)) return area;
  const cap = fitCamera(map, work).scale;
  const rank = (a: Box): number[] => {
    const s = fitScale(box, a, cap);
    if (!priority) return [s];
    const { cell, pcs, tokens } = priority;
    const cam = fitContent(box, a, map, work, cell, pcs);
    const pcsIn =
      !pcs ||
      (cam.x + pcs.x * cam.scale >= a.x - 1e-6 &&
        cam.y + pcs.y * cam.scale >= a.y - 1e-6 &&
        cam.x + (pcs.x + pcs.w) * cam.scale <= a.x + a.w + 1e-6 &&
        cam.y + (pcs.y + pcs.h) * cam.scale <= a.y + a.h + 1e-6);
    const shown = tokens.filter((t) => {
      const c = {
        x: cam.x + (t.x + t.w / 2) * cam.scale,
        y: cam.y + (t.y + t.h / 2) * cam.scale,
      };
      return areas.some((r) => within(c, r));
    }).length;
    return [pcsIn ? 1 : 0, cam.y >= TOP_BAR_H - 1e-6 ? 1 : 0, shown, s];
  };
  let best = area;
  let bestRank = rank(area);
  for (const a of areas) {
    const r = rank(a);
    const i = r.findIndex((v, k) => Math.abs(v - (bestRank[k] ?? 0)) > 1e-9);
    const better =
      i >= 0
        ? (r[i] ?? 0) > (bestRank[i] ?? 0)
        : a.w * a.h > best.w * best.h ||
          (a.w * a.h === best.w * best.h && (a.y < best.y || (a.y === best.y && a.x < best.x)));
    if (better) {
      best = a;
      bestRank = r;
    }
  }
  return best;
}

/**
 * Pans `at` (the screen start of a span of length `len`) the least so the span lies in
 * [lo, hi]; a span longer than that is centred in it instead.
 */
const panInto = (at: number, len: number, lo: number, hi: number) =>
  len > hi - lo ? (lo + hi - len) / 2 : Math.min(Math.max(at, lo), hi - len);

/** One axis of a box (map px) and the inset from the free area's edges it keeps (screen px). */
interface Keep {
  at: number;
  len: number;
  inset: number;
}

/**
 * The camera positions (one axis, screen px) at which each of `keeps` that lies in [f0, f1]
 * (minus its inset) at `pos` still does; none does → null.
 */
function keepRange(
  pos: number,
  scale: number,
  [f0, f1]: readonly [number, number],
  keeps: readonly (Keep | null)[],
): [number, number] | null {
  const eps = 1e-6;
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (const k of keeps) {
    if (!k) continue;
    const kLo = f0 + k.inset - k.at * scale;
    const kHi = f1 - k.inset - (k.at + k.len) * scale;
    if (pos < kLo - eps || pos > kHi + eps) continue;
    lo = Math.max(lo, Math.min(kLo, pos));
    hi = Math.min(hi, Math.max(kHi, pos));
  }
  return lo === Number.NEGATIVE_INFINITY ? null : [lo, hi];
}

/**
 * BL-01, one axis, after the fit: the map (`map` long, map px) centred in the view [v0, v1]
 * (screen px) when it fits, else panned the least to cover it (`startFirst`: its start edge at
 * v0, so the top row shows and the crop falls at the dock, FOG §13 step 26), so no empty band
 * sits beside a cropped edge; but only as far as each of `keeps` that lies in the free area
 * [f0, f1] (minus its inset) now stays there. None does → `pos` unchanged.
 */
function fillAxis(
  pos: number,
  scale: number,
  map: number,
  [v0, v1]: readonly [number, number],
  [f0, f1]: readonly [number, number],
  keeps: readonly (Keep | null)[],
  startFirst = false,
): number {
  const range = keepRange(pos, scale, [f0, f1], keeps);
  if (!range) return pos;
  const [lo, hi] = range;
  const len = map * scale;
  const want =
    len <= v1 - v0 ? (v0 + v1 - len) / 2 : startFirst ? v0 : Math.min(Math.max(pos, v1 - len), v0);
  return Math.min(Math.max(want, lo), hi);
}

/** The tokens' own footprint box inside a content box (its 1-cell pad off, unless cut at the map). */
function tokensIn(box: Box, map: Size, cell: number): Box {
  const x0 = box.x > 0 ? box.x + cell : box.x;
  const y0 = box.y > 0 ? box.y + cell : box.y;
  const x1 = box.x + box.w < map.w ? box.x + box.w - cell : box.x + box.w;
  const y1 = box.y + box.h < map.h ? box.y + box.h - cell : box.y + box.h;
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : box;
}

/**
 * FR-MAP-44 fit: `box` (map px) centred in `free` (screen px), as large as fits with a 16 px
 * margin, but never above the whole-map fit into the work area (`work`), so it only zooms out
 * from the FR-MAP-12 zoom. FR-MAP-46: never below a `FIT_MIN_CELL_PX` cell (`cell` = grid cell,
 * map px; capped by the max zoom), which beats the cap; then the camera pans the least so `pcs`
 * (the PC tokens' footprint box, map px) lies in the free area minus the margin, centred on it
 * per axis where it can't. BL-01: last, per axis, the map is centred in the work area right of
 * the tool rail (if larger: panned the least to cover it; vertically its top row under the top
 * bar), as far as the tokens' footprints and the lower half of their labels (and at the floor the
 * PCs, with the margin) stay in the free area. FOG §13 step 26 (V7 ruling) when that still puts
 * the top row under the top bar: (1) the PCs in the free area, (2) the top row at the top bar,
 * zooming out for it down to the floor, (3) the other tokens anywhere (cut at the dock or under
 * a window); only where (1) and (2) can't both hold does the PC rule keep the pan.
 */
export function fitContent(
  box: Box,
  free: Box,
  map: Size,
  work: Size,
  cell: number,
  pcs: Box | null,
): Fit {
  const cap = fitCamera(map, work).scale;
  const min = cell > 0 ? Math.min(ZOOM_MAX, FIT_MIN_CELL_PX / cell) : 0;
  if (box.w <= 0 || box.h <= 0 || free.w <= 0 || free.h <= 0) {
    return { x: free.x, y: free.y, scale: Math.max(cap, min), floor: min > cap };
  }
  const fits = fitScale(box, free, cap);
  const floor = fits < min;
  const scale = floor ? min : fits;
  const view = { x: RAIL_CLEAR, y: TOP_BAR_H, w: Math.max(1, work.w - RAIL_CLEAR), h: work.h };
  const at = panAt(box, free, map, view, cell, pcs, scale, floor);
  if (at.y >= view.y) return { ...at, scale, floor };
  if (!pcs) return { x: at.x, y: view.y, scale, floor };
  // The PCs with their labels' lower half in the free area with the top row at the top bar: the
  // largest scale (≤ the fit's, ≥ the floor) for that. The label only shrinks as the scale does.
  const label = (labelMetrics(cell, scale).pillH * scale) / 2;
  const s = Math.min(scale, (free.y + free.h - view.y - label) / (pcs.y + pcs.h));
  // A free area starting below the top bar: the PCs' top edge must clear it too.
  const clear = free.y - view.y;
  const low =
    clear <= 0 ? min : pcs.y > 0 ? Math.max(min, clear / pcs.y) : Number.POSITIVE_INFINITY;
  if (s < low - 1e-9) return { ...at, scale, floor };
  const pinned = s < scale ? panAt(box, free, map, view, cell, pcs, s, floor) : at;
  const x0 = pinned.x + pcs.x * s;
  if (x0 < free.x - 1e-6 || x0 + pcs.w * s > free.x + free.w + 1e-6) return { ...at, scale, floor };
  return { x: pinned.x, y: view.y, scale: s, floor };
}

/**
 * The fit's pan at `scale`: `box` centred in `free`, at the floor the PCs panned into it, then
 * BL-01 per axis (see `fitContent`).
 */
function panAt(
  box: Box,
  free: Box,
  map: Size,
  view: Box,
  cell: number,
  pcs: Box | null,
  scale: number,
  floor: boolean,
): { x: number; y: number } {
  let x = free.x + free.w / 2 - (box.x + box.w / 2) * scale;
  let y = free.y + free.h / 2 - (box.y + box.h / 2) * scale;
  const m = Math.min(FIT_MARGIN, free.w / 2, free.h / 2);
  if (floor && pcs) {
    x +=
      panInto(x + pcs.x * scale, pcs.w * scale, free.x + m, free.x + free.w - m) -
      (x + pcs.x * scale);
    y +=
      panInto(y + pcs.y * scale, pcs.h * scale, free.y + m, free.y + free.h - m) -
      (y + pcs.y * scale);
  }
  // BL-01: fill the work area right of the rail with the map, as far as the tokens with their
  // name labels' lower half (FR-MAP-42) and, at the floor, the PCs with the margin stay in the
  // free area.
  const t = tokensIn(box, map, cell);
  /** The name label's lower half below the footprint (map px). */
  const label = labelMetrics(cell, scale).pillH / 2;
  const keepPcs = floor ? pcs : null;
  x = fillAxis(
    x,
    scale,
    map.w,
    [view.x, view.x + view.w],
    [free.x, free.x + free.w],
    [{ at: t.x, len: t.w, inset: 0 }, keepPcs && { at: keepPcs.x, len: keepPcs.w, inset: m }],
  );
  y = fillAxis(
    y,
    scale,
    map.h,
    [view.y, view.y + view.h],
    [free.y, free.y + free.h],
    [
      { at: t.y, len: t.h + label, inset: 0 },
      keepPcs && { at: keepPcs.y, len: keepPcs.h, inset: m },
    ],
    true,
  );
  return { x, y };
}

// ---- FR-MAP-59: every token visible (sprint 5, #256) ----

/** FR-MAP-59: the hard floor #190's 48 px yields to, only to keep every token visible. */
export const FIT_HARD_MIN_CELL_PX = 24;
/** FR-MAP-59 bound: more content tokens or obstacles than this → no search (PCs first). */
export const FIT_VISIBLE_MAX_TOKENS = 30;
export const FIT_VISIBLE_MAX_OBSTACLES = 6;

/** `data-fit-visible`: every token footprint clear (`all`), or FR-MAP-46's PCs first (`pcs`). */
export type FitVisible = "all" | "pcs";

const EPS = 1e-6;

/** Open rectangles overlap (touching edges don't). */
const cross = (a: Box, b: Box) =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

/** FR-MAP-59 area: the work area right of the rail, inset 16 px (screen px). */
export function visibleArea(view: Size): Box {
  const work = workArea(view);
  return {
    x: RAIL_CLEAR + FIT_MARGIN,
    y: TOP_BAR_H + FIT_MARGIN,
    w: Math.max(0, work.w - RAIL_CLEAR - 2 * FIT_MARGIN),
    h: Math.max(0, work.h - 2 * FIT_MARGIN),
  };
}

/** Every footprint (map px) at `cam` inside `area` and clear of every obstacle (screen px). */
export function allClear(
  cam: Camera,
  tokens: readonly Box[],
  obstacles: readonly Box[],
  area: Box,
): boolean {
  return tokens.every((t) => {
    const s = {
      x: cam.x + t.x * cam.scale,
      y: cam.y + t.y * cam.scale,
      w: t.w * cam.scale,
      h: t.h * cam.scale,
    };
    const inArea =
      s.x >= area.x - EPS &&
      s.y >= area.y - EPS &&
      s.x + s.w <= area.x + area.w + EPS &&
      s.y + s.h <= area.y + area.h + EPS;
    return inArea && !obstacles.some((o) => cross(s, o));
  });
}

/** First index of sorted `xs` with a value above `v` (`strict`) or at or above it. */
function lowerBound(xs: readonly number[], v: number, strict: boolean): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = xs[mid] as number;
    if (strict ? x > v : x >= v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const sortedUnique = (vs: readonly number[]) => [...new Set(vs)].sort((a, b) => a - b);

/**
 * FR-MAP-59 (2), one scale: the allowed pan nearest `from` (Manhattan, then higher, then left), or
 * null. Each (token, obstacle) pair forbids an open rectangle of pans (Minkowski difference); the
 * area bounds the pan range. Candidates = the cross product of the x-values {range bounds, `from`
 * clamped, every forbidden rectangle's left and right edge} and the y-values likewise; a sweep over
 * the x-values marks, per x, the y-candidates inside an active rectangle's open y-interval.
 */
function panAtScale(
  tokens: readonly Box[],
  obstacles: readonly Box[],
  area: Box,
  scale: number,
  from: { x: number; y: number },
): { x: number; y: number } | null {
  let x0 = Number.NEGATIVE_INFINITY;
  let x1 = Number.POSITIVE_INFINITY;
  let y0 = Number.NEGATIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  for (const t of tokens) {
    x0 = Math.max(x0, area.x - t.x * scale);
    x1 = Math.min(x1, area.x + area.w - (t.x + t.w) * scale);
    y0 = Math.max(y0, area.y - t.y * scale);
    y1 = Math.min(y1, area.y + area.h - (t.y + t.h) * scale);
  }
  if (x0 > x1 + EPS || y0 > y1 + EPS) return null;
  x1 = Math.max(x0, x1);
  y1 = Math.max(y0, y1);
  // Forbidden open rectangles that reach into the pan range.
  const fl: number[] = [];
  const fr: number[] = [];
  const ft: number[] = [];
  const fb: number[] = [];
  for (const t of tokens) {
    for (const o of obstacles) {
      const l = o.x - (t.x + t.w) * scale;
      const r = o.x + o.w - t.x * scale;
      const tp = o.y - (t.y + t.h) * scale;
      const b = o.y + o.h - t.y * scale;
      if (r <= x0 + EPS || l >= x1 - EPS || b <= y0 + EPS || tp >= y1 - EPS) continue;
      fl.push(l);
      fr.push(r);
      ft.push(tp);
      fb.push(b);
    }
  }
  const inX = (v: number) => v >= x0 - EPS && v <= x1 + EPS;
  const inY = (v: number) => v >= y0 - EPS && v <= y1 + EPS;
  const fx = Math.min(Math.max(from.x, x0), x1);
  const fy = Math.min(Math.max(from.y, y0), y1);
  const xs = sortedUnique([x0, x1, fx, ...fl.filter(inX), ...fr.filter(inX)]);
  const ys = sortedUnique([y0, y1, fy, ...ft.filter(inY), ...fb.filter(inY)]);
  const n = fl.length;
  const marks = new Int32Array(ys.length + 1);
  let best: { x: number; y: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const x of xs) {
    const dx = Math.abs(x - from.x);
    if (dx > bestD + EPS) continue;
    marks.fill(0);
    for (let i = 0; i < n; i++) {
      if (!((fl[i] as number) < x - EPS && x < (fr[i] as number) - EPS)) continue;
      const lo = lowerBound(ys, (ft[i] as number) + EPS, true);
      const hi = lowerBound(ys, (fb[i] as number) - EPS, false);
      if (lo < hi) {
        marks[lo] = (marks[lo] as number) + 1;
        marks[hi] = (marks[hi] as number) - 1;
      }
    }
    let covered = 0;
    for (let j = 0; j < ys.length; j++) {
      covered += marks[j] as number;
      if (covered > 0) continue;
      const y = ys[j] as number;
      const d = dx + Math.abs(y - from.y);
      const better =
        best === null ||
        d < bestD - EPS ||
        (Math.abs(d - bestD) <= EPS &&
          (y < best.y - EPS || (Math.abs(y - best.y) <= EPS && x < best.x)));
      if (better) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return best;
}

/**
 * FR-MAP-59 (2)–(3): after step 1's fit (`from`), the largest integer cell size (screen px per
 * grid cell of `cell` map px) at which some pan keeps every footprint (`tokens`, map px) inside
 * `area` and clear of every obstacle (screen px). Scales: from step 1's cell down to
 * `FIT_HARD_MIN_CELL_PX` in steps of 4 px; at the first step with an allowed pan, also + 3, + 2,
 * + 1 (below the previous step); the largest allowed wins (no monotonicity assumed). Step 1
 * already clear → `from`; nothing allowed at 24 px, or more than 30 tokens or 6 obstacles in the
 * area → `from` (FR-MAP-46's PCs first), `pcs`.
 */
export function fitVisible(
  tokens: readonly Box[],
  obstacles: readonly Box[],
  area: Box,
  from: Camera,
  cell: number,
): Camera & { visible: FitVisible } {
  const inArea = obstacles.filter((o) => cross(o, area));
  if (allClear(from, tokens, inArea, area)) return { ...from, visible: "all" };
  const pcs = { ...from, visible: "pcs" as const };
  if (
    cell <= 0 ||
    tokens.length > FIT_VISIBLE_MAX_TOKENS ||
    inArea.length > FIT_VISIBLE_MAX_OBSTACLES
  ) {
    return pcs;
  }
  const at = (c: number) => {
    const scale = c / cell;
    if (scale < ZOOM_MIN || scale > ZOOM_MAX) return null;
    const pan = panAtScale(tokens, inArea, area, scale, from);
    return pan && { ...pan, scale };
  };
  const top = Math.floor(from.scale * cell + EPS);
  let prev: number | null = null;
  for (let c = top; c >= FIT_HARD_MIN_CELL_PX; ) {
    const found = at(c);
    if (found) {
      for (let k = 3; k >= 1; k--) {
        if (prev === null || c + k >= prev) continue;
        const up = at(c + k);
        if (up) return { ...up, visible: "all" };
      }
      return { ...found, visible: "all" };
    }
    prev = c;
    c = c - 4 >= FIT_HARD_MIN_CELL_PX || c === FIT_HARD_MIN_CELL_PX ? c - 4 : FIT_HARD_MIN_CELL_PX;
  }
  return pcs;
}

/** A token as the fit sees it: its cells and whether it is a PC (has an owner, FR-MAP-46). */
export interface FitToken {
  col: number;
  row: number;
  size: TokenSize;
  pc: boolean;
}

/** What the fit avoids, screen px. */
export interface FitRoom {
  /** FR-SHELL-44's candidate free rectangles, also clear of the toast box; largest first. */
  areas: readonly Box[];
  /** Rendered open windows + this client's toast box (FR-SHELL-48 (a)). */
  obstacles: readonly Box[];
  /** No `areas`: FR-SHELL-44's windows-only candidates (`useFreeArea().areas`). */
  windowsOnly: readonly Box[];
}

/** A scene fit: the camera, the free rectangle step 1 used, and FR-MAP-59's outcome. */
export interface SceneFit extends Fit {
  rect: Box;
  visible: FitVisible;
}

/**
 * The whole fit (FR-MAP-44 → -58 → -46, then FR-MAP-59): the candidate free rectangle that best
 * keeps the V7 fit priority, the content box fitted into it; then, if a token footprint is still
 * under a window or the toast box, `fitVisible`. `view` = the canvas (the viewport). Candidates:
 * the toast-free ones; none (the DM at 1280×720 with Scenes) → the windows-only ones. The free area
 * is the largest candidate, even below FR-SHELL-34's 25 % share (the DM's toast box or a resized
 * layout takes it there, and the whole work area would put the PCs under the Game log); no
 * candidate at all → the work area right of the rail.
 */
export function fitScene(
  tokens: readonly FitToken[],
  grid: Grid,
  map: Size,
  view: Size,
  room: FitRoom,
): SceneFit {
  const box = contentBox(tokens, grid, map);
  const pcs = footprintBox(
    tokens.filter((t) => t.pc),
    grid,
  );
  const work = workArea(view);
  const footprints = tokens.flatMap((t) => footprintBox([t], grid) ?? []);
  const cell = grid.gridCellSize;
  const areas = room.areas.length > 0 ? room.areas : room.windowsOnly;
  const rail = { x: RAIL_CLEAR, y: TOP_BAR_H, w: Math.max(1, work.w - RAIL_CLEAR), h: work.h };
  const area = areas[0] ?? rail;
  const rect = bestFreeRect(box, areas, area, map, work, { cell, pcs, tokens: footprints });
  const step1 = fitContent(box, rect, map, work, cell, pcs);
  const { visible, ...cam } = fitVisible(
    footprints,
    room.obstacles,
    visibleArea(view),
    step1,
    cell,
  );
  const same = cam.x === step1.x && cam.y === step1.y && cam.scale === step1.scale;
  return { ...cam, floor: same ? step1.floor : false, rect, visible };
}

/** `data-camera` (FR-MAP-44 (b)): where the last fit put it, or moved by the user since. */
export type CameraMode = "fitted" | "moved";

/**
 * What can happen to the camera; window, token and snapshot changes are not here. `resize` = a
 * browser viewport resize, settled (FR-MAP-47).
 */
export type CameraEvent = "open" | "fit" | "appearance" | "resize" | "pan" | "zoom" | "pull";

/**
 * FR-MAP-44/45/47 triggers: a scene open and the Fit button always fit; an appearance or a
 * viewport resize refits only while `fitted`; pan, wheel zoom and pull mark the camera `moved`.
 */
export function cameraOn(mode: CameraMode, e: CameraEvent): { mode: CameraMode; fit: boolean } {
  switch (e) {
    case "open":
    case "fit":
      return { mode: "fitted", fit: true };
    case "appearance":
    case "resize":
      return { mode, fit: mode === "fitted" };
    default:
      return { mode: "moved", fit: false };
  }
}

/** FR-MAP-47: a viewport resize refits this long after the last `resize` event. */
export const RESIZE_REFIT_MS = 200;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * FR-MAP-47: `resize()` on each viewport `resize` event; `refit` runs once, `RESIZE_REFIT_MS`
 * after the last one (it applies the `resize` camera event, so `moved` never refits). Settled
 * during a token drag (`dragging()`): it waits for `drop()`.
 */
export function createResizeRefit(refit: () => void, dragging: () => boolean, timers = realTimers) {
  let handle: unknown = null;
  let afterDrop = false;
  const fire = () => {
    handle = null;
    if (dragging()) afterDrop = true;
    else refit();
  };
  return {
    resize() {
      if (handle !== null) timers.clear(handle);
      afterDrop = false;
      handle = timers.set(fire, RESIZE_REFIT_MS);
    },
    drop() {
      if (!afterDrop) return;
      afterDrop = false;
      refit();
    },
    dispose() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      afterDrop = false;
    },
  };
}

/** FR-MAP-61: an appearance refit waits at most this many extra frames for changes to settle. */
export const APPEARANCE_REFIT_MAX_WAITS = 10;

export interface Frames {
  request(fn: () => void): unknown;
  cancel(handle: unknown): void;
}

const realFrames: Frames = {
  request: (fn) => requestAnimationFrame(fn),
  cancel: (h) => cancelAnimationFrame(h as number),
};

/**
 * FR-MAP-61: `appearance()` schedules `refit` for the next animation frame, once the window change
 * is laid out (FR-SHELL-18 `appear`); every change the canvas applies before it fires (`applied()`:
 * the tokens or window rects of the frame that caused it reaching the canvas) moves it to the frame
 * after, at most `APPEARANCE_REFIT_MAX_WAITS` times, so tokens Start creates or reveals count.
 * `refit` reads the canvas's current inputs; it checks `fitted` itself.
 */
export function createAppearanceRefit(refit: () => void, frames = realFrames) {
  let handle: unknown = null;
  let waits = 0;
  const fire = () => {
    handle = null;
    refit();
  };
  return {
    appearance() {
      if (handle !== null) frames.cancel(handle);
      waits = 0;
      handle = frames.request(fire);
    },
    applied() {
      if (handle === null || waits >= APPEARANCE_REFIT_MAX_WAITS) return;
      waits += 1;
      frames.cancel(handle);
      handle = frames.request(fire);
    },
    dispose() {
      if (handle !== null) frames.cancel(handle);
      handle = null;
    },
  };
}

/** Wheel zoom about the pointer (screen px): the map point under it stays put. */
export function zoomAt(cam: Camera, pointer: { x: number; y: number }, deltaY: number): Camera {
  const scale = clampScale(deltaY < 0 ? cam.scale * ZOOM_STEP : cam.scale / ZOOM_STEP);
  const mx = (pointer.x - cam.x) / cam.scale;
  const my = (pointer.y - cam.y) / cam.scale;
  return { x: pointer.x - mx * scale, y: pointer.y - my * scale, scale };
}

/** FR-MAP-23 pull: centre the camera on a map point, zoom unchanged. */
export function centreOn(cam: Camera, p: { x: number; y: number }, view: Size): Camera {
  return { scale: cam.scale, x: view.w / 2 - p.x * cam.scale, y: view.h / 2 - p.y * cam.scale };
}

/** Screen px (relative to the canvas) → map px. */
export function toMap(cam: Camera, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - cam.x) / cam.scale, y: (p.y - cam.y) / cam.scale };
}
