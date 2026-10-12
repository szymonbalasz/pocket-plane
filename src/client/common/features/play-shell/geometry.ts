// Window geometry: default placement, render-only clamp, drag and resize math (FR-SHELL-10/12).
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
  const bottom = vp.h - size.h - EDGE_GAP - dy - 64; // keep clear of the launcher
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
