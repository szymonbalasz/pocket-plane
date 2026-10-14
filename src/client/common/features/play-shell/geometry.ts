// Window geometry: default placement, render-only fit and clamp, drag and resize math
// (FR-SHELL-10/12/29).
import { GEOMETRY_LIMIT } from "@shared/play-shell/layout";
import type { DefaultPosition, Size } from "./registry";

/** Height of the top bar; windows never go above it (FR-SHELL-12). Matches `h-12`. */
export const TOP_BAR_H = 48;
/** Window title bar height. Matches `h-8`. */
export const TITLE_H = 32;
/** At least this much of a window's width stays inside the viewport (OQ-SHELL-10). */
export const MIN_VISIBLE_W = 120;
/** Gap between a default-placed window and the viewport edge / top bar. */
export const EDGE_GAP = 12;
/** Strip above the bottom edge kept clear of default-placed windows (the launcher). */
export const LAUNCHER_CLEAR = 64;

export interface Viewport {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const int = (n: number) => Math.max(-GEOMETRY_LIMIT, Math.min(GEOMETRY_LIMIT, Math.round(n)));
const clampNum = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Absolute default geometry for a window type in this viewport. */
export function defaultRect(pos: DefaultPosition, size: Size, vp: Viewport): Rect {
  const dx = pos.dx ?? 0;
  const dy = pos.dy ?? 0;
  const left = EDGE_GAP + dx;
  const right = vp.w - size.w - EDGE_GAP - dx;
  const top = TOP_BAR_H + EDGE_GAP + dy;
  const bottom = vp.h - size.h - EDGE_GAP - dy - LAUNCHER_CLEAR;
  const [x, y] =
    pos.anchor === "top-left"
      ? [left, top]
      : pos.anchor === "top-right"
        ? [right, top]
        : pos.anchor === "bottom-left"
          ? [left, bottom]
          : pos.anchor === "bottom-right"
            ? [right, bottom]
            : [(vp.w - size.w) / 2 + dx, (vp.h - size.h) / 2 + dy];
  return { x: int(x), y: int(y), w: int(size.w), h: int(size.h) };
}

/**
 * Render-only clamp (FR-SHELL-12): window ≤ viewport; title bar fully inside, below the top
 * bar; ≥ 120 px of its width (or all of it, if narrower) inside. Never written back.
 */
export function clampRect(r: Rect, vp: Viewport): Rect {
  const w = Math.max(1, Math.min(r.w, vp.w));
  const h = Math.max(1, Math.min(r.h, vp.h - TOP_BAR_H));
  const visible = Math.min(MIN_VISIBLE_W, w);
  const x = clampNum(r.x, visible - w, vp.w - visible);
  const y = clampNum(r.y, TOP_BAR_H, Math.max(TOP_BAR_H, vp.h - TITLE_H));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Work area size (FR-SHELL-29): the viewport below the top bar and above the launcher's top
 * edge. It starts at (0, TOP_BAR_H).
 */
export function workArea(vp: Viewport): Viewport {
  return { w: Math.max(1, vp.w), h: Math.max(1, vp.h - TOP_BAR_H - LAUNCHER_CLEAR) };
}

/**
 * A window within this distance of the work area's right (bottom) edge is attached to it and
 * keeps its gap when the area shrinks (FR-SHELL-29). Spec: "touched (≤ 8 px)"; measured beyond
 * the default edge gap, so default-placed edge windows (12 px gap) count as attached.
 */
export const EDGE_TOUCH = EDGE_GAP + 8;

/**
 * One axis of the fit: (pos, len) lay wholly inside [0, stored]; returns it inside [0, cur].
 * Attached to the far edge → keeps that gap; else moves back only as far as needed; then
 * shrinks, never below `min` (what still doesn't fit is the clamp's job).
 */
function fitAxis(pos: number, len: number, min: number, stored: number, cur: number) {
  const gap = stored - (pos + len);
  const end = gap <= EDGE_TOUCH ? cur - gap : cur;
  const p = Math.max(0, Math.min(pos, end - len));
  const l = Math.max(Math.min(min, len), Math.min(len, end - p));
  return [p, l] as const;
}

/**
 * Fit on render (FR-SHELL-29), per window and per axis, against the work area the window's
 * geometry was set in (`area`). Only a smaller current work area changes anything; a window
 * without `area`, or stored partly outside its work area (parked), is returned as is (then
 * FR-SHELL-12 clamps it). Render-only: never written back.
 */
export function fitRect(r: Rect, area: Viewport | undefined, min: Size, vp: Viewport): Rect {
  if (!area) return r;
  const y = r.y - TOP_BAR_H; // work-area coordinates
  const inside = r.x >= 0 && r.x + r.w <= area.w && y >= 0 && y + r.h <= area.h;
  if (!inside) return r;
  const cur = workArea(vp);
  let { x, w, h } = r;
  let wy = y;
  if (cur.w < area.w) [x, w] = fitAxis(r.x, r.w, min.w, area.w, cur.w);
  if (cur.h < area.h) [wy, h] = fitAxis(y, r.h, min.h, area.h, cur.h);
  return { x, y: wy + TOP_BAR_H, w, h };
}

/** What a stored window renders at: fit to the work area, then clamped (FR-SHELL-29, -12). */
export function renderedRect(
  win: Rect & { area?: Viewport | undefined },
  min: Size,
  vp: Viewport,
): Rect {
  return clampRect(fitRect(win, win.area, min, vp), vp);
}

/** Title-bar drag from `start` (the rendered rect) by (dx, dy); result clamped. */
export function moveRect(start: Rect, dx: number, dy: number, vp: Viewport): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vp);
}

export type ResizeEdge = "e" | "w" | "s" | "se" | "sw";

/**
 * Edge / corner resize (FR-SHELL-10): never below min size, never beyond the viewport
 * (left 0, right vp.w, bottom vp.h). The opposite edge stays put.
 */
export function resizeRect(
  start: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  min: Size,
  vp: Viewport,
): Rect {
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  if (edge === "e" || edge === "se") {
    w = clampNum(start.w + dx, min.w, Math.max(min.w, vp.w - start.x));
  }
  if (edge === "w" || edge === "sw") {
    const newX = clampNum(start.x + dx, Math.min(0, start.x), right - min.w);
    x = newX;
    w = right - newX;
  }
  if (edge === "s" || edge === "se" || edge === "sw") {
    h = clampNum(start.h + dy, min.h, Math.max(min.h, vp.h - start.y));
  }
  y = start.y;
  return { x: int(x), y: int(y), w: int(w), h: int(h) };
}
