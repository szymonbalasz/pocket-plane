// Per-client camera (FR-MAP-12): pan/zoom never sent. Map px → screen px = p × scale + (x, y).
// A scene opens framed in the free area (FR-MAP-44, R1), never below a readable cell (FR-MAP-46);
// a viewport resize refits while fitted (FR-MAP-47); BL-01: the map then pans to fill the canvas.
import { footprint, type Grid } from "@shared/scenes-map/geometry";
import type { TokenSize } from "@shared/scenes-map/schemas";
import { TOP_BAR_H } from "../play-shell/geometry";
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
  if (lo === Number.NEGATIVE_INFINITY) return pos;
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
 * PCs, with the margin) stay in the free area.
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
  const fits = clampScale(
    Math.min(cap, (free.w - 2 * FIT_MARGIN) / box.w, (free.h - 2 * FIT_MARGIN) / box.h),
  );
  const floor = fits < min;
  const scale = floor ? min : fits;
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
  const view = { x: RAIL_CLEAR, y: TOP_BAR_H, w: Math.max(1, work.w - RAIL_CLEAR), h: work.h };
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
  return { x, y, scale, floor };
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
