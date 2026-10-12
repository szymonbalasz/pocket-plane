// Per-client camera (FR-MAP-12): pan/zoom never sent. Map px → screen px = p × scale + (x, y).

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
