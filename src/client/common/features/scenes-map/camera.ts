// Per-client camera (FR-MAP-12): pan/zoom never sent. Map px → screen px = p × scale + (x, y).
// A scene opens framed in the free area (FR-MAP-44, R1), never below a readable cell (FR-MAP-46);
// a viewport resize refits while fitted (FR-MAP-47); BL-01: the map then pans to fill the canvas.
// FR-MAP-58: "the free area" is the candidate free rectangle the tokens fit best (`bestFreeRect`).
import { footprint, type Grid } from "@shared/scenes-map/geometry";
import type { TokenSize } from "@shared/scenes-map/schemas";
import { TOP_BAR_H, workArea } from "../play-shell/geometry";
import { PC_MARGIN, RAIL_CLEAR } from "../play-shell/placement";
import { isPlacementPc } from "../play-shell/token-boxes";
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
  /** FR-MAP-94: the largest scale the fit may take (the last full fit's, for a refit). */
  maxScale?: number;
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
  const cap = Math.min(fitCamera(map, work).scale, priority?.maxScale ?? Number.POSITIVE_INFINITY);
  const rank = (a: Box): number[] => {
    const s = fitScale(box, a, cap);
    if (!priority) return [s];
    const { cell, pcs, tokens, maxScale } = priority;
    const cam = fitContent(box, a, map, work, cell, pcs, maxScale);
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
  maxScale = Number.POSITIVE_INFINITY,
): Fit {
  // FR-MAP-94: a refit bounded by the last full fit never draws a larger cell, floor included.
  const cap = Math.min(fitCamera(map, work).scale, maxScale);
  const min = cell > 0 ? Math.min(ZOOM_MAX, FIT_MIN_CELL_PX / cell, maxScale) : 0;
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

/**
 * FR-MAP-93: a fit keeps PC footprints + this margin (screen px) clear of windows wherever a pan
 * at the same cell allows it, as the placer keeps windows off PC footprints + 4 px (FR-SHELL-57),
 * so a refit doesn't leave a PC flush with a window. A soft rule: it never costs a smaller cell,
 * an all-clear fit or the top row (FR-MAP-81).
 */
export const FIT_PC_MARGIN = PC_MARGIN;

/** A footprint (map px) that may be a PC's (FR-MAP-93: `isPlacementPc`). */
type MaybePc = Box & { pc?: boolean };

/**
 * The footprint (map px) the obstacle test uses at `scale`: a PC's grown by `margin` screen px,
 * any other as it is. The area test always uses the footprint itself.
 */
function guarded(t: MaybePc, scale: number, margin: number): Box {
  if (!t.pc || margin <= 0 || scale <= 0) return t;
  // A hair over the margin, so float noise in the pan never leaves a PC + 4 px touching a window.
  const m = (margin + 1e-3) / scale;
  return { x: t.x - m, y: t.y - m, w: t.w + 2 * m, h: t.h + 2 * m };
}

/**
 * Every footprint (map px) at `cam` inside `area` and clear of every obstacle (screen px); a PC's
 * (`pc`) with `margin` px to spare (FR-MAP-93).
 */
export function allClear(
  cam: Camera,
  tokens: readonly MaybePc[],
  obstacles: readonly Box[],
  area: Box,
  margin = 0,
): boolean {
  const onScreen = (t: Box) => ({
    x: cam.x + t.x * cam.scale,
    y: cam.y + t.y * cam.scale,
    w: t.w * cam.scale,
    h: t.h * cam.scale,
  });
  return tokens.every((t) => {
    const s = onScreen(t);
    const inArea =
      s.x >= area.x - EPS &&
      s.y >= area.y - EPS &&
      s.x + s.w <= area.x + area.w + EPS &&
      s.y + s.h <= area.y + area.h + EPS;
    if (!inArea) return false;
    const g = t.pc && margin > 0 ? onScreen(guarded(t, cam.scale, margin)) : s;
    return !obstacles.some((o) => cross(g, o));
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
 * null (also when more than 6 obstacles reach into the pan range: FR-MAP-90's bound). Each (token, obstacle) pair forbids an open rectangle of pans (Minkowski difference); the
 * area bounds the pan range. Candidates = the cross product of the x-values {range bounds, `from`
 * clamped, every forbidden rectangle's left and right edge} and the y-values likewise; a sweep over
 * the x-values marks, per x, the y-candidates inside an active rectangle's open y-interval. Pans
 * above `minY` (the map's top edge, FR-MAP-44's top row) are out of range.
 */
function panAtScale(
  tokens: readonly MaybePc[],
  obstacles: readonly Box[],
  area: Box,
  scale: number,
  from: { x: number; y: number },
  minY: number,
  margin = 0,
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
  y0 = Math.max(y0, minY);
  if (x0 > x1 + EPS || y0 > y1 + EPS) return null;
  x1 = Math.max(x0, x1);
  y1 = Math.max(y0, y1);
  // Forbidden open rectangles that reach into the pan range.
  const fl: number[] = [];
  const fr: number[] = [];
  const ft: number[] = [];
  const fb: number[] = [];
  const reach = new Set<Box>();
  for (const tok of tokens) {
    const t = guarded(tok, scale, margin);
    for (const o of obstacles) {
      const l = o.x - (t.x + t.w) * scale;
      const r = o.x + o.w - t.x * scale;
      const tp = o.y - (t.y + t.h) * scale;
      const b = o.y + o.h - t.y * scale;
      if (r <= x0 + EPS || l >= x1 - EPS || b <= y0 + EPS || tp >= y1 - EPS) continue;
      reach.add(o);
      fl.push(l);
      fr.push(r);
      ft.push(tp);
      fb.push(b);
    }
  }
  // FR-MAP-90: the bound counts only the obstacles some token can reach at this scale.
  if (reach.size > FIT_VISIBLE_MAX_OBSTACLES) return null;
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
 * already clear → `from`; nothing allowed at 24 px, or more than 30 tokens → `from` (FR-MAP-46's
 * PCs first), `pcs`. FR-MAP-90: a scale at which more than 6 obstacles reach the tokens' pan range
 * isn't searched (the bound counts only those, not every obstacle in the area). `minY`: `all` keeps the map's top edge (map
 * px 0) at or below it (FR-MAP-44's top row under the top bar), step 1 included. `minCell`
 * (FR-MAP-94): the search's lowest cell. FR-MAP-93: the ladder is searched first with every PC
 * (`pc`) + 4 px clear (a clear step 1 with a PC flush first tries its own scale), then, if no
 * cell allows that, flush.
 */
export function fitVisible(
  tokens: readonly MaybePc[],
  obstacles: readonly Box[],
  area: Box,
  from: Camera,
  cell: number,
  minY = Number.NEGATIVE_INFINITY,
  minCell = FIT_HARD_MIN_CELL_PX,
): Camera & { visible: FitVisible } {
  const inArea = obstacles.filter((o) => cross(o, area));
  const fromOk = from.y >= minY - EPS;
  if (fromOk && allClear(from, tokens, inArea, area, FIT_PC_MARGIN)) {
    return { ...from, visible: "all" };
  }
  const plainFrom = fromOk && allClear(from, tokens, inArea, area);
  const pcs = { ...from, visible: "pcs" as const };
  if (cell <= 0 || tokens.length > FIT_VISIBLE_MAX_TOKENS) {
    return plainFrom ? { ...from, visible: "all" } : pcs;
  }
  /** The ladder below `from` with each PC `margin` px clear (FR-MAP-93); null: none. */
  const search = (margin: number) => {
    const at = (c: number) => {
      const scale = c / cell;
      if (scale < ZOOM_MIN || scale > ZOOM_MAX) return null;
      const pan = panAtScale(tokens, inArea, area, scale, from, minY, margin);
      return pan && { ...pan, scale };
    };
    // A clear step 1 with a PC flush: its own scale first (FR-MAP-93: shift, don't zoom).
    if (plainFrom) {
      const pan = panAtScale(tokens, inArea, area, from.scale, from, minY, margin);
      if (pan) return { ...pan, scale: from.scale };
    }
    const top = Math.floor(from.scale * cell + EPS);
    const low = Math.max(FIT_HARD_MIN_CELL_PX, Math.ceil(minCell - EPS));
    let prev: number | null = null;
    for (let c = top; c >= low; ) {
      const found = at(c);
      if (found) {
        for (let k = 3; k >= 1; k--) {
          if (prev === null || c + k >= prev) continue;
          const up = at(c + k);
          if (up) return up;
        }
        return found;
      }
      prev = c;
      c = c - 4 >= low || c === low ? c - 4 : low;
    }
    return null;
  };
  // FR-MAP-93: PCs + 4 px clear where some cell allows it; else flush rather than lose `all`.
  const found = search(FIT_PC_MARGIN);
  return found ? { ...found, visible: "all" } : pcs;
}

// ---- FR-MAP-81: `pcs` keeps the top row (sprint 6, BL-41) ----

/** FR-MAP-81 bound: the tokens nearest the PCs' box centre that enter the `pcs` pan sweep. */
export const PCS_PAN_MAX_TOKENS = 30;

/** A footprint (map px) and whether it is a PC's. */
export interface FitBox extends Box {
  pc: boolean;
}

/** Index range of sorted `xs` inside the closed interval [lo, hi]. */
const closedRange = (xs: readonly number[], lo: number, hi: number): [number, number] => [
  lowerBound(xs, lo - EPS, false),
  lowerBound(xs, hi + EPS, true),
];

/** Index range of sorted `xs` inside the open interval (lo, hi). */
const openRange = (xs: readonly number[], lo: number, hi: number): [number, number] => [
  lowerBound(xs, lo + EPS, true),
  lowerBound(xs, hi - EPS, false),
];

/** Lexicographic `a < b`, ties within EPS. */
function before(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (Math.abs(d) > EPS) return d < 0;
  }
  return false;
}

/**
 * FR-MAP-81: the `pcs` pan at 48 px per cell (`FIT_MIN_CELL_PX`, capped by the max zoom), or null
 * (no PCs, or no pan keeps every PC footprint inside `area`: FR-MAP-46's centring stays). Inputs
 * bounded: the PCs + the 30 tokens nearest the PCs' box centre, and (FR-MAP-90) the 6 obstacles in
 * the area nearest the PCs' box at `from`. No pan keeps every PC clear → the pan with the least PC
 * footprint area under those obstacles (FR-MAP-90). Among the pans keeping the PCs inside and clear: (1) none drawn
 * cut by the top (a footprint on the viewport `view` whose top is above `area`'s), if such a pan
 * exists ("never cuts a token by the top bar while another PC-clear pan doesn't"; sim-9 a03's
 * top row at y 64), (1b) then every PC + 4 px clear (FR-MAP-93), (2) then the most of those
 * footprints inside `area` and clear of every obstacle, (3) then the least Manhattan distance to
 * `from`, then higher, then left. `scale` (FR-MAP-94): default 48 px per cell. Candidates: the cross product of
 * every edge where one of those counts can change (as FR-MAP-59 (2)); per x a sweep over y counts.
 */
export function pcsPan(
  tokens: readonly FitBox[],
  obstacles: readonly Box[],
  area: Box,
  view: Size,
  from: { x: number; y: number },
  cell: number,
  scale = cell > 0 ? Math.min(ZOOM_MAX, FIT_MIN_CELL_PX / cell) : 0,
): Camera | null {
  const pcs = tokens.filter((t) => t.pc);
  if (cell <= 0 || pcs.length === 0) return null;
  // The PCs' bounding box and its centre.
  const px0 = Math.min(...pcs.map((p) => p.x));
  const py0 = Math.min(...pcs.map((p) => p.y));
  const px1 = Math.max(...pcs.map((p) => p.x + p.w));
  const py1 = Math.max(...pcs.map((p) => p.y + p.h));
  const cx = (px0 + px1) / 2;
  const cy = (py0 + py1) / 2;
  // FR-MAP-90: past the bound, the 6 obstacles nearest the PCs' box (on screen at `from`).
  const pcScreen = {
    x: from.x + px0 * scale,
    y: from.y + py0 * scale,
    w: (px1 - px0) * scale,
    h: (py1 - py0) * scale,
  };
  const inArea = obstacles
    .filter((o) => cross(o, area))
    .map((o) => ({ o, d: rectGap(o, pcScreen) }))
    .sort((a, b) => a.d - b.d || b.o.w * b.o.h - a.o.w * a.o.h || a.o.y - b.o.y || a.o.x - b.o.x)
    .slice(0, FIT_VISIBLE_MAX_OBSTACLES)
    .map(({ o }) => o)
    .sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x);
  const dist = (t: Box) => Math.hypot(t.x + t.w / 2 - cx, t.y + t.h / 2 - cy);
  const others = tokens
    .map((t, i) => ({ t, i, d: dist(t) }))
    .filter(({ t }) => !t.pc)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, PCS_PAN_MAX_TOKENS)
    .map(({ t }) => t);
  const set = [...pcs, ...others];
  // The pan range: every PC footprint inside the area.
  let x0 = Number.NEGATIVE_INFINITY;
  let x1 = Number.POSITIVE_INFINITY;
  let y0 = Number.NEGATIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  for (const t of pcs) {
    x0 = Math.max(x0, area.x - t.x * scale);
    x1 = Math.min(x1, area.x + area.w - (t.x + t.w) * scale);
    y0 = Math.max(y0, area.y - t.y * scale);
    y1 = Math.min(y1, area.y + area.h - (t.y + t.h) * scale);
  }
  if (x0 > x1 + EPS || y0 > y1 + EPS) return null;
  x1 = Math.max(x0, x1);
  y1 = Math.max(y0, y1);
  // Per token: the pans keeping it inside the area, the forbidden (open) pans per obstacle, and
  // the (open) pans that draw it cut by the top.
  const per = set.map((t) => ({
    pc: t.pc,
    ax: [area.x - t.x * scale, area.x + area.w - (t.x + t.w) * scale] as const,
    ay: [area.y - t.y * scale, area.y + area.h - (t.y + t.h) * scale] as const,
    forbid: forbids(t, inArea, scale, 0),
    // FR-MAP-93: a PC's with the 4-px margin (rank (1b)).
    forbidM: t.pc ? forbids(t, inArea, scale, FIT_PC_MARGIN) : [],
    cutX: [-(t.x + t.w) * scale, view.w - t.x * scale] as const,
    cutY: [-(t.y + t.h) * scale, area.y - t.y * scale] as const,
  }));
  const inX = (v: number) => v >= x0 - EPS && v <= x1 + EPS;
  const inY = (v: number) => v >= y0 - EPS && v <= y1 + EPS;
  const fx = Math.min(Math.max(from.x, x0), x1);
  const fy = Math.min(Math.max(from.y, y0), y1);
  const xs = sortedUnique(
    [
      x0,
      x1,
      fx,
      ...per.flatMap((p) => [
        ...p.ax,
        ...p.cutX,
        ...[...p.forbid, ...p.forbidM].flatMap((f) => [f.l, f.r]),
      ]),
    ].filter(inX),
  );
  const ys = sortedUnique(
    [
      y0,
      y1,
      fy,
      ...per.flatMap((p) => [
        ...p.ay,
        ...p.cutY,
        ...[...p.forbid, ...p.forbidM].flatMap((f) => [f.t, f.b]),
      ]),
    ].filter(inY),
  );
  const ok = new Int32Array(ys.length + 1);
  const pcOk = new Int32Array(ys.length + 1);
  const pcOkM = new Int32Array(ys.length + 1);
  const cut = new Int32Array(ys.length + 1);
  const mark = (arr: Int32Array, [lo, hi]: [number, number]) => {
    if (lo >= hi) return;
    arr[lo] = (arr[lo] as number) + 1;
    arr[hi] = (arr[hi] as number) - 1;
  };
  /** Marks the y the token may take at `x`: inside the area, outside every forbidden interval. */
  const allowed = (
    x: number,
    ay: readonly [number, number],
    forbid: readonly Forbid[],
    arrs: readonly Int32Array[],
  ) => {
    const gaps = forbid.filter((f) => f.l < x - EPS && x < f.r - EPS).sort((a, b) => a.t - b.t);
    let at = ay[0];
    for (const g of gaps) {
      if (g.t >= at - EPS) {
        const hi = Math.min(g.t, ay[1]);
        if (hi >= at - EPS) for (const arr of arrs) mark(arr, closedRange(ys, at, hi));
      }
      at = Math.max(at, g.b);
    }
    if (at <= ay[1] + EPS) for (const arr of arrs) mark(arr, closedRange(ys, at, ay[1]));
  };
  let best: { x: number; y: number; rank: number[] } | null = null;
  for (const x of xs) {
    ok.fill(0);
    pcOk.fill(0);
    pcOkM.fill(0);
    cut.fill(0);
    for (const p of per) {
      if (p.cutX[0] < x - EPS && x < p.cutX[1] - EPS) mark(cut, openRange(ys, ...p.cutY));
      if (x < p.ax[0] - EPS || x > p.ax[1] + EPS) continue;
      // The token's allowed y: inside the area minus the open intervals of the obstacles whose
      // forbidden x-interval holds x.
      allowed(x, p.ay, p.forbid, p.pc ? [ok, pcOk] : [ok]);
      if (p.pc) allowed(x, p.ay, p.forbidM, [pcOkM]);
    }
    let nOk = 0;
    let nPc = 0;
    let nPcM = 0;
    let nCut = 0;
    for (let j = 0; j < ys.length; j++) {
      nOk += ok[j] as number;
      nPc += pcOk[j] as number;
      nPcM += pcOkM[j] as number;
      nCut += cut[j] as number;
      if (nPc < pcs.length) continue;
      const y = ys[j] as number;
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      const rank = [nCut > 0 ? 1 : 0, nPcM < pcs.length ? 1 : 0, -nOk, d, y, x];
      if (best === null || before(rank, best.rank)) best = { x, y, rank };
    }
  }
  if (best) return { x: best.x, y: best.y, scale };
  // FR-MAP-90: no pan keeps every PC clear → the least PC footprint area under the obstacles.
  const pan = leastCoveredPan(pcs, inArea, [x0, x1], [y0, y1], scale, from);
  return { ...pan, scale };
}

/** The open pan rectangle at which footprint `t` (map px, + `margin` px for a PC) meets an obstacle. */
interface Forbid {
  l: number;
  r: number;
  t: number;
  b: number;
}

function forbids(t: MaybePc, obstacles: readonly Box[], scale: number, margin: number): Forbid[] {
  const g = guarded(t, scale, margin);
  return obstacles.map((o) => ({
    l: o.x - (g.x + g.w) * scale,
    r: o.x + o.w - g.x * scale,
    t: o.y - (g.y + g.h) * scale,
    b: o.y + o.h - g.y * scale,
  }));
}

/** Screen gap between two rectangles (0 when they touch or overlap). */
function rectGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** Length of the overlap of [at, at + len] with [o, o + olen]. */
const overlap1 = (at: number, len: number, o: number, olen: number) =>
  Math.max(0, Math.min(at + len, o + olen) - Math.max(at, o));

/**
 * FR-MAP-90: in the pan range [x0, x1] × [y0, y1] at `scale`, the pan with the least total area of
 * `pcs` footprints under `obstacles` (screen px), then the least Manhattan distance to `from`, then
 * higher, then left. Each footprint's overlap with an obstacle is bilinear between the pans where
 * an edge of one meets an edge of the other, so the minimum lies on the grid of those pans.
 */
function leastCoveredPan(
  pcs: readonly Box[],
  obstacles: readonly Box[],
  [x0, x1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  scale: number,
  from: { x: number; y: number },
): { x: number; y: number } {
  const inX = (v: number) => v >= x0 - EPS && v <= x1 + EPS;
  const inY = (v: number) => v >= y0 - EPS && v <= y1 + EPS;
  const edges = (o: number, olen: number, t: number, tlen: number) => [
    o - (t + tlen) * scale,
    o - t * scale,
    o + olen - (t + tlen) * scale,
    o + olen - t * scale,
  ];
  const xs = sortedUnique(
    [
      x0,
      x1,
      Math.min(Math.max(from.x, x0), x1),
      ...pcs.flatMap((t) => obstacles.flatMap((o) => edges(o.x, o.w, t.x, t.w))),
    ].filter(inX),
  );
  const ys = sortedUnique(
    [
      y0,
      y1,
      Math.min(Math.max(from.y, y0), y1),
      ...pcs.flatMap((t) => obstacles.flatMap((o) => edges(o.y, o.h, t.y, t.h))),
    ].filter(inY),
  );
  const n = pcs.length * obstacles.length;
  const ox = new Float64Array(n);
  let best: { x: number; y: number; rank: number[] } | null = null;
  for (const x of xs) {
    let k = 0;
    for (const t of pcs) {
      for (const o of obstacles) ox[k++] = overlap1(x + t.x * scale, t.w * scale, o.x, o.w);
    }
    for (const y of ys) {
      let cost = 0;
      k = 0;
      for (const t of pcs) {
        for (const o of obstacles) {
          const w = ox[k++] as number;
          if (w > 0) cost += w * overlap1(y + t.y * scale, t.h * scale, o.y, o.h);
        }
      }
      const rank = [cost, Math.abs(x - from.x) + Math.abs(y - from.y), y, x];
      if (best === null || before(rank, best.rank)) best = { x, y, rank };
    }
  }
  return best ?? { x: x0, y: y0 };
}

/** A token as the fit sees it: its cells and whether it is a PC (FR-MAP-46, -93). */
export interface FitToken {
  col: number;
  row: number;
  size: TokenSize;
  pc: boolean;
}

/**
 * FR-MAP-93: this client's tokens as the fit sees them; `pc` = the placer's PC test
 * (`isPlacementPc`, #318): a player character's token. Pets and summons are content tokens.
 */
export const fitTokensOf = (
  tokens: readonly {
    col: number;
    row: number;
    size: TokenSize;
    ownerPlayerId: string | null;
    characterId: string | null;
  }[],
): FitToken[] =>
  tokens.map((t) => ({ col: t.col, row: t.row, size: t.size, pc: isPlacementPc(t) }));

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
 * FR-MAP-94: the cell range (screen px per grid cell) a fit may take: at most `maxCell`, and its
 * searches go no lower than `minCell` (default: FR-MAP-59's 24-px hard floor).
 */
export interface FitBounds {
  maxCell?: number;
  minCell?: number;
  /**
   * With no all-clear pan, the PCs-first ladder (FR-MAP-94) ranks by the least token area hidden;
   * off (the DM's full fits, BL-41: Fit doesn't squeeze the map): the largest cell keeping the PCs
   * clear.
   */
  leastHidden?: boolean;
}

/** FR-MAP-97, FR-SHELL-108: a yield (`window`) keeps ≥ this share of the last full fit's cell. */
export const REFIT_MIN_SHARE = 0.75;

/**
 * Hidden footprint area (map px², so comparable across scales) of `tokens` at `cam`: outside
 * `area` or under an obstacle (FR-MAP-94's "least token area under windows").
 */
function hiddenArea(cam: Camera, tokens: readonly Box[], obstacles: readonly Box[], area: Box) {
  let total = 0;
  for (const t of tokens) {
    const s = {
      x: cam.x + t.x * cam.scale,
      y: cam.y + t.y * cam.scale,
      w: t.w * cam.scale,
      h: t.h * cam.scale,
    };
    const inside = overlap1(s.x, s.w, area.x, area.w) * overlap1(s.y, s.h, area.y, area.h);
    let under = 0;
    for (const o of obstacles) under += overlap1(s.x, s.w, o.x, o.w) * overlap1(s.y, s.h, o.y, o.h);
    total += Math.min(s.w * s.h, s.w * s.h - inside + under);
  }
  return total / (cam.scale * cam.scale);
}

/**
 * FR-MAP-94 (BL-65): no pan clears every token at any searched cell → the PCs first (#333), then
 * (`leastHidden`) the least token area under windows or off the area. Cells from the lower of the
 * fit's step 1 and FR-MAP-46's 48 px (so it never zooms in past what `fitVisible` searched) down
 * to `low`, in 4-px steps; each takes FR-MAP-81's `pcs` pan. Rank: every PC clear, then + 4 px
 * (FR-MAP-93), then the least hidden area, then the larger cell. Null when no PCs or no pan keeps
 * them inside the area.
 */
function pcsFirst(
  boxes: readonly FitBox[],
  obstacles: readonly Box[],
  area: Box,
  view: Size,
  from: Camera,
  cell: number,
  low: number,
  leastHidden: boolean,
): Camera | null {
  const pcs = boxes.filter((b) => b.pc);
  const others = boxes.filter((b) => !b.pc);
  const top = Math.min(FIT_MIN_CELL_PX, from.scale * cell);
  const bottom = Math.min(top, Math.max(FIT_HARD_MIN_CELL_PX, low));
  const cells = [top];
  for (let c = Math.floor(top + EPS) - 4; c > bottom + EPS; c -= 4) cells.push(c);
  if (bottom < top - EPS) cells.push(bottom);
  let best: { cam: Camera; rank: number[] } | null = null;
  for (const c of cells) {
    const cam = pcsPan(boxes, obstacles, area, view, from, cell, Math.min(ZOOM_MAX, c / cell));
    if (!cam) continue;
    const rank = [
      allClear(cam, pcs, obstacles, area) ? 0 : 1,
      allClear(cam, pcs, obstacles, area, FIT_PC_MARGIN) ? 0 : 1,
      leastHidden ? Math.round(hiddenArea(cam, others, obstacles, area)) : 0,
      -c,
    ];
    if (best === null || before(rank, best.rank)) best = { cam, rank };
    // Cells only shrink from here: nothing beats every PC + 4 px clear with nothing hidden.
    if (rank[0] === 0 && rank[1] === 0 && rank[2] === 0) break;
  }
  return best?.cam ?? null;
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
  bounds: FitBounds = {},
): SceneFit {
  const box = contentBox(tokens, grid, map);
  const pcs = footprintBox(
    tokens.filter((t) => t.pc),
    grid,
  );
  const work = workArea(view);
  const footprints = tokens.flatMap((t) => {
    const b = footprintBox([t], grid);
    return b ? [{ ...b, pc: t.pc }] : [];
  });
  const cell = grid.gridCellSize;
  const areas = room.areas.length > 0 ? room.areas : room.windowsOnly;
  const rail = { x: RAIL_CLEAR, y: TOP_BAR_H, w: Math.max(1, work.w - RAIL_CLEAR), h: work.h };
  const area = areas[0] ?? rail;
  const maxScale =
    bounds.maxCell !== undefined && cell > 0 ? bounds.maxCell / cell : Number.POSITIVE_INFINITY;
  const rect = bestFreeRect(box, areas, area, map, work, {
    cell,
    pcs,
    tokens: footprints,
    maxScale,
  });
  const step1 = fitContent(box, rect, map, work, cell, pcs, maxScale);
  const low = bounds.minCell ?? FIT_HARD_MIN_CELL_PX;
  const { visible, ...cam } = fitVisible(
    footprints,
    room.obstacles,
    visibleArea(view),
    step1,
    cell,
    TOP_BAR_H,
    low,
  );
  if (visible === "pcs") {
    // FR-MAP-81, -94: the PCs first (top row not cut where a pan allows it), then the least
    // token area under windows, never above step 1's cell.
    const area = visibleArea(view);
    const hide = bounds.leastHidden === true;
    const pan = pcsFirst(footprints, room.obstacles, area, view, step1, cell, low, hide);
    if (pan) return { ...pan, floor: pan.scale * cell >= FIT_MIN_CELL_PX - EPS, rect, visible };
  }
  const same = cam.x === step1.x && cam.y === step1.y && cam.scale === step1.scale;
  return { ...cam, floor: same ? step1.floor : false, rect, visible };
}

/** FR-MAP-91 (OQ-MAP-61 A): shown card toasts stay clear unless the cell drops below this share. */
export const FIT_PAST_TOASTS_SHARE = 0.75;

/**
 * FR-MAP-91: the DM's Fit (button, Reset layout, resize; FR-MAP-90: the appearance refit too)
 * twice: with the shown stack as obstacle (`room`, FR-MAP-80) and with only the summary strip
 * (`stripRoom`). The first keeps every token clear (`all`) at ≥ 75 % of the second's cell → the
 * first; else the second (`pastToasts`: the shown toasts and roll popups may cover tokens until
 * they go) when it keeps every token clear or the first doesn't either; else the first. So a tall
 * shown stack never turns an `all` Fit into FR-MAP-46's `pcs` (U13: Start's roll popup). Players
 * (no shown stack): `room` alone.
 */
export function fitPastToasts(
  tokens: readonly FitToken[],
  grid: Grid,
  map: Size,
  view: Size,
  room: FitRoom,
  stripRoom: FitRoom,
  bounds: FitBounds = {},
): SceneFit & { pastToasts: boolean } {
  const kept = fitScene(tokens, grid, map, view, room, bounds);
  if (stripRoom.obstacles.length === room.obstacles.length) return { ...kept, pastToasts: false };
  const past = fitScene(tokens, grid, map, view, stripRoom, bounds);
  const useKept =
    kept.visible === "all"
      ? kept.scale >= FIT_PAST_TOASTS_SHARE * past.scale - EPS
      : past.visible !== "all";
  return useKept ? { ...kept, pastToasts: false } : { ...past, pastToasts: true };
}

/**
 * FR-MAP-90 no jump: an appearance keeps the camera when every footprint (`tokens`, map px) is
 * inside FR-MAP-59's area and clear of every obstacle at `cam` (FR-MAP-59's test), PCs by
 * `FIT_PC_MARGIN` (FR-MAP-93).
 */
export const appearanceKeeps = (
  cam: Camera,
  tokens: readonly MaybePc[],
  obstacles: readonly Box[],
  view: Size,
) => allClear(cam, tokens, obstacles, visibleArea(view), FIT_PC_MARGIN);

/** `data-camera` (FR-MAP-44 (b)): where the last fit put it, or moved by the user since. */
export type CameraMode = "fitted" | "moved";

/**
 * What can happen to the camera; window, token and snapshot changes are not here. `resize` = a
 * browser viewport resize, settled (FR-MAP-47); `reveal` = newly drawn tokens off-screen or under
 * an obstacle (FR-MAP-82, players).
 */
export type CameraEvent =
  | "open"
  | "fit"
  | "appearance"
  | "resize"
  | "reveal"
  | "window"
  | "pan"
  | "zoom"
  | "pull";

/**
 * `data-fit-reason`: the last fit's cause (FR-MAP-82); `load` = the first scene open on this page
 * (FR-MAP-89), `fit-past-toasts` = a Fit that let a card toast cover tokens (FR-MAP-91), `window`
 * = the players' map yielded to a window (FR-MAP-97).
 */
export type FitReason =
  | "open"
  | "load"
  | "fit"
  | "fit-past-toasts"
  | "appearance"
  | "resize"
  | "reveal"
  | "window";

/** FR-MAP-94: a full fit (Fit, open, load, resize) sets the cell later refits are bounded by. */
export const isFullFit = (reason: FitReason) =>
  reason === "open" ||
  reason === "load" ||
  reason === "fit" ||
  reason === "fit-past-toasts" ||
  reason === "resize";

/**
 * FR-MAP-94: a refit (reveal, appearance, window) draws a cell ≤ the last full fit's; it may zoom
 * out to the floor to clear tokens. A yield (`window`) also keeps ≥ 75 % of it (FR-SHELL-108: the
 * placer accepts nothing below). A full fit, or no full fit yet, is unbounded. With no all-clear
 * pan, the players' fits rank the PCs-first ladder by the least hidden token area (BL-65, r03: a
 * player's load never re-scales up to 48 px with tokens under the sheet); the DM's take the
 * largest PC-clear cell (BL-41: Fit doesn't squeeze the map).
 */
export function fitBounds(
  reason: FitReason,
  lastFullCell: number | null,
  client: "dm" | "player",
): FitBounds {
  const leastHidden = client === "player";
  if (isFullFit(reason) || lastFullCell === null || lastFullCell <= 0) return { leastHidden };
  if (reason !== "window") return { maxCell: lastFullCell, leastHidden };
  return { maxCell: lastFullCell, minCell: REFIT_MIN_SHARE * lastFullCell, leastHidden };
}

/** A fit's inputs: this client's tokens, grid, map, canvas and rooms (FR-MAP-93: one obstacle source). */
export interface FitInputs {
  client: "dm" | "player";
  tokens: readonly FitToken[];
  grid: Grid;
  map: Size;
  view: Size;
  /** The windows of the placer's plan + this client's toast obstacles (`fitObstacles`). */
  room: FitRoom;
  /** The same with only the DM's summary strip (FR-MAP-91); players: `room`. */
  stripRoom: FitRoom;
  /**
   * BL-100 (FR-MAP-115): `room` / `stripRoom` without the remembered windows; present while one
   * is shown (absent for a dry fit's candidate rects).
   */
  untouched?: { room: FitRoom; stripRoom: FitRoom };
}

/**
 * FR-MAP-95: the one fit path. Every reason (`open`, `load`, Fit, `resize`, `reveal`,
 * `appearance`, `window`) runs Fit's function (`fitPastToasts`) with this client's obstacles,
 * bounded per FR-MAP-94 by the last full fit's cell. `reason` = what `data-fit-reason` shows.
 */
export function fitFor(
  reason: FitReason,
  inputs: FitInputs,
  lastFullCell: number | null,
): SceneFit & { reason: FitReason } {
  const { tokens, grid, map, view, room, stripRoom } = inputs;
  const bounds = fitBounds(reason, lastFullCell, inputs.client);
  const run = (b: FitBounds) => fitPastToasts(tokens, grid, map, view, room, stripRoom, b);
  // FR-MAP-95: a refit first takes the full fit for these inputs (the camera a load would take);
  // only when that zooms in past the last full fit (or, for a yield, below 75 % of it) the bounded
  // fit (FR-MAP-94).
  let fit = run({ leastHidden: bounds.leastHidden });
  const cell = fit.scale * grid.gridCellSize;
  const within =
    (bounds.maxCell === undefined || cell <= bounds.maxCell + EPS) &&
    (bounds.minCell === undefined || cell >= bounds.minCell - EPS);
  if (!within) fit = run(bounds);
  // BL-100 (FR-MAP-115): remembered windows are obstacles while some view keeps every token clear
  // of them; where they leave none (one dragged over the map centre), the map is framed around
  // the other windows and they stay over it where the user put them, never FR-MAP-46's PCs-only
  // floor in a corner.
  if (fit.visible === "pcs" && inputs.untouched) {
    const { untouched, ...rest } = inputs;
    const alt = fitFor(reason, { ...rest, ...untouched }, lastFullCell);
    if (alt.visible === "all") return alt;
  }
  const { pastToasts, ...rest } = fit;
  return { ...rest, reason: pastToasts ? "fit-past-toasts" : reason };
}

/** A dry fit (FR-MAP-97, the base port's `dryFit`): the camera a yield would take, not applied. */
export interface DryFitResult {
  camera: Camera;
  cellPx: number;
  verdict: FitVisible;
  /**
   * Every PC footprint + 4 px clear at `camera` (FR-SHELL-108: every PC, and every token the dry
   * fit kept, clear; the fit itself keeps the others as far as it can, `verdict`).
   */
  clear: boolean;
}

/**
 * FR-MAP-97: the `window` fit with `inputs` (the placer's candidate as one more obstacle), not
 * applied.
 */
export function dryFitScene(inputs: FitInputs, lastFullCell: number | null): DryFitResult {
  const { grid, view, tokens } = inputs;
  const fit = fitFor("window", inputs, lastFullCell);
  const pcs = tokens.flatMap((t) => {
    const b = t.pc ? footprintBox([t], grid) : null;
    return b ? [{ ...b, pc: true }] : [];
  });
  const camera = { x: fit.x, y: fit.y, scale: fit.scale };
  return {
    camera,
    cellPx: fit.scale * grid.gridCellSize,
    verdict: fit.visible,
    clear: allClear(camera, pcs, inputs.room.obstacles, visibleArea(view), FIT_PC_MARGIN),
  };
}

/**
 * FR-MAP-44/45/47/82 triggers: a scene open and the Fit button always fit; an appearance, a
 * viewport resize, a reveal or the map yielding to a window (FR-MAP-97) refits only while
 * `fitted`; pan, wheel zoom and pull mark the camera `moved`.
 */
export function cameraOn(mode: CameraMode, e: CameraEvent): { mode: CameraMode; fit: boolean } {
  switch (e) {
    case "open":
    case "fit":
      return { mode: "fitted", fit: true };
    case "appearance":
    case "resize":
    case "reveal":
    case "window":
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

/** FR-MAP-82: reveals within this long coalesce into one refit (the last frame's content). */
export const REVEAL_REFIT_MS = 1000;

/** A token this client draws: its id and footprint (map px). */
export interface DrawnToken {
  id: string;
  box: Box;
}

/** FR-MAP-82 is the players' (rulings-b #18): the DM's camera never refits on reveals. */
export const refitsOnReveal = (client: "dm" | "player") => client === "player";

/**
 * FR-MAP-82 trigger (players): a frame made tokens newly drawn (ids not in `prevDrawn`) and at
 * least one of their footprints lies outside `area` or under an obstacle at `cam`, while the
 * camera is `fitted`. Tokens already drawn, moving or leaving sight never count.
 */
export function revealRefit(
  prevDrawn: ReadonlySet<string>,
  nextDrawn: readonly DrawnToken[],
  cam: Camera,
  obstacles: readonly Box[],
  area: Box,
  mode: CameraMode,
): boolean {
  if (mode !== "fitted") return false;
  return nextDrawn.some((t) => !prevDrawn.has(t.id) && !allClear(cam, [t.box], obstacles, area));
}

/**
 * FR-MAP-82 timing: `reveal()` arms one refit `REVEAL_REFIT_MS` later (later reveals ride along,
 * so a burst refits once with the last frame's content). The user wins: `gesture()` (a pan or zoom
 * gesture's start; the caller marks the camera `moved`) cancels it; `press()` (a token or a tool
 * under the pointer) cancels it and `release()` (the drop) re-arms it; reveals while pressed wait
 * for the release. `refit` applies the `reveal` camera event, so `moved` never refits.
 */
export function createRevealRefit(refit: () => void, timers = realTimers) {
  let handle: unknown = null;
  let pressing = false;
  let deferred = false;
  const clear = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  const arm = () => {
    if (handle !== null) return;
    handle = timers.set(() => {
      handle = null;
      refit();
    }, REVEAL_REFIT_MS);
  };
  return {
    reveal() {
      if (pressing) deferred = true;
      else arm();
    },
    gesture() {
      clear();
      deferred = false;
    },
    press() {
      pressing = true;
      if (handle === null) return;
      clear();
      deferred = true;
    },
    release() {
      if (!pressing) return;
      pressing = false;
      if (!deferred) return;
      deferred = false;
      arm();
    },
    /** A refit is armed or waits for a release. */
    get pending() {
      return handle !== null || deferred;
    },
    dispose() {
      clear();
      pressing = false;
      deferred = false;
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

/** What the canvas knows of the placer (`useFreeArea`). */
export interface PlacerState {
  /** The layout is applied (the `load` settle ran). */
  ready: boolean;
  /** Every open growing window reported its content height. */
  grown: boolean;
  /** A window the placer just placed (open, `appear`) still waits for its `settle`. */
  settling: boolean;
  /** The viewport of the last `viewport` (or `load`, reset) settle. */
  settledAt: Size | null;
  /** `viewport` settles applied so far (FR-MAP-113). */
  settles?: number;
}

/**
 * FR-MAP-96, -98, -113: a fit for `reason` may frame now: the layout applied, no placed window
 * waiting for its `settle`, grown windows measured; a resize refit also waits for the last
 * `viewport` settle (`settledAt` = the viewport `view`), and, with `since` (the settle count its
 * resize is waiting for), for that settle itself: never an older one's windows render-fit.
 */
export function placerSettled(
  s: PlacerState,
  reason: FitReason,
  view: Size,
  since?: number,
): boolean {
  if (!s.ready || !s.grown || s.settling) return false;
  if (reason !== "resize") return true;
  if (since !== undefined && (s.settles ?? 0) < since) return false;
  return s.settledAt !== null && s.settledAt.w === view.w && s.settledAt.h === view.h;
}

/**
 * FR-MAP-113: while `hold()` is true (a resize refit whose viewport settle hasn't landed) a
 * settled fit keeps waiting past `SETTLED_FIT_MAX_WAITS`, up to this many frames.
 */
export const SETTLED_FIT_HOLD_MAX = 600;

/** FR-MAP-96, -98: the most frames a settled fit waits for the placer before it fits anyway. */
export const SETTLED_FIT_MAX_WAITS = 60;

/**
 * FR-MAP-96, -98 (replaces FR-MAP-89 (2)'s frame wait): `request()` fits once the placer has
 * settled: on the first animation frame at which `ready()` holds (the `load`, `appear` or last
 * `viewport` settle applied, grown windows measured), or after `SETTLED_FIT_MAX_WAITS` frames
 * (`SETTLED_FIT_HOLD_MAX` while `hold()`: a resize refit waiting for its settle, FR-MAP-113).
 * `applied()` (new tokens, window rects or size reached the canvas) moves a pending fit to the
 * frame after, at most `APPEARANCE_REFIT_MAX_WAITS` times (FR-MAP-61), so it reads them.
 */
export function createSettledRefit(
  refit: () => void,
  ready: () => boolean,
  frames: Frames = realFrames,
  hold: () => boolean = () => false,
) {
  let handle: unknown = null;
  let waits = 0;
  let nudges = 0;
  const fire = () => {
    handle = null;
    const max = hold() ? SETTLED_FIT_HOLD_MAX : SETTLED_FIT_MAX_WAITS;
    if (!ready() && waits < max) {
      waits += 1;
      handle = frames.request(fire);
      return;
    }
    refit();
  };
  return {
    request() {
      if (handle !== null) frames.cancel(handle);
      waits = 0;
      nudges = 0;
      handle = frames.request(fire);
    },
    applied() {
      if (handle === null || nudges >= APPEARANCE_REFIT_MAX_WAITS) return;
      nudges += 1;
      frames.cancel(handle);
      handle = frames.request(fire);
    },
    /** A fit is waiting. */
    get pending() {
      return handle !== null;
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
