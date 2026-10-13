// Map-first layout check (#162): how much of a scene's map, fitted like the canvas fits it when
// the scene opens (FR-MAP-12), stays uncovered by windows and the top bar. Pure geometry; the
// layout tests run it on each client's default layout.
import { fitCamera } from "../scenes-map/camera";
import { type Rect, TOP_BAR_H, type Viewport } from "./geometry";

/** The map's on-screen rect right after the scene opens (the canvas fills the viewport). */
export function fittedMapRect(map: { w: number; h: number }, vp: Viewport): Rect {
  const cam = fitCamera(map, vp);
  return { x: cam.x, y: cam.y, w: map.w * cam.scale, h: map.h * cam.scale };
}

/** Share (0–1) of `map` not under the top bar or any of `covers`; 1 px raster. */
export function uncoveredShare(map: Rect, covers: readonly Rect[], vp: Viewport): number {
  const x0 = Math.max(0, Math.floor(map.x));
  const y0 = Math.max(0, Math.floor(map.y));
  const x1 = Math.min(vp.w, Math.ceil(map.x + map.w));
  const y1 = Math.min(vp.h, Math.ceil(map.y + map.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  const covered = new Uint8Array(w * h);
  const paint = (r: Rect) => {
    const ax = Math.max(x0, Math.floor(r.x)) - x0;
    const bx = Math.min(x1, Math.ceil(r.x + r.w)) - x0;
    for (let y = Math.max(y0, Math.floor(r.y)); y < Math.min(y1, Math.ceil(r.y + r.h)); y++) {
      if (ax < bx) covered.fill(1, (y - y0) * w + ax, (y - y0) * w + bx);
    }
  };
  paint({ x: 0, y: 0, w: vp.w, h: TOP_BAR_H });
  for (const r of covers) paint(r);
  let n = 0;
  for (const c of covered) n += c;
  return 1 - n / (w * h);
}
