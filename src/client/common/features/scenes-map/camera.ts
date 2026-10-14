// Per-client camera (FR-MAP-12): pan/zoom never sent. Map px → screen px = p × scale + (x, y).
// A scene opens framed in the free area (FR-MAP-44, R1).
import { footprint, type Grid } from "@shared/scenes-map/geometry";
import type { TokenSize } from "@shared/scenes-map/schemas";

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
  if (tokens.length === 0) return whole;
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
  const bx0 = Math.max(0, x0 - c);
  const by0 = Math.max(0, y0 - c);
  const bx1 = Math.min(map.w, x1 + c);
  const by1 = Math.min(map.h, y1 + c);
  if (bx1 <= bx0 || by1 <= by0) return whole;
  return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
}

/** FR-MAP-44 margin inside the free area (px). */
export const FIT_MARGIN = 16;

/**
 * FR-MAP-44 fit: `box` (map px) centred in `free` (screen px), as large as fits with a 16 px
 * margin, but never above the whole-map fit into the work area (`work`), so it only zooms out
 * from the FR-MAP-12 zoom.
 */
export function fitContent(box: Box, free: Box, map: Size, work: Size): Camera {
  const cap = fitCamera(map, work).scale;
  if (box.w <= 0 || box.h <= 0 || free.w <= 0 || free.h <= 0) {
    return { x: free.x, y: free.y, scale: cap };
  }
  const scale = clampScale(
    Math.min(cap, (free.w - 2 * FIT_MARGIN) / box.w, (free.h - 2 * FIT_MARGIN) / box.h),
  );
  return {
    x: free.x + free.w / 2 - (box.x + box.w / 2) * scale,
    y: free.y + free.h / 2 - (box.y + box.h / 2) * scale,
    scale,
  };
}

/** `data-camera` (FR-MAP-44 (b)): where the last fit put it, or moved by the user since. */
export type CameraMode = "fitted" | "moved";

/** What can happen to the camera; window, token, snapshot and resize changes are not here. */
export type CameraEvent = "open" | "fit" | "appearance" | "pan" | "zoom" | "pull";

/**
 * FR-MAP-44/45 triggers: a scene open and the Fit button always fit; an appearance refits only
 * while `fitted`; pan, wheel zoom and pull mark the camera `moved`.
 */
export function cameraOn(mode: CameraMode, e: CameraEvent): { mode: CameraMode; fit: boolean } {
  switch (e) {
    case "open":
    case "fit":
      return { mode: "fitted", fit: true };
    case "appearance":
      return { mode, fit: mode === "fitted" };
    default:
      return { mode: "moved", fit: false };
  }
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
