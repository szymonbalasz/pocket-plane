// Test support (DM #364): the keep-out cases written before #364 lifted the half-width cap on
// slides left of home. `cappedSpot` / `cappedPlacement` run them with a PC token across the map
// left of the column (`noFarSlide`), so no far-left slide is clear and they keep testing the rules
// that follow it (the empty body, the fallback ranking, the fold). Imported by tests only.
import type { Viewport } from "../play-shell/geometry";
import { dmStackPlacement, dmStackSpot, MAX_SLIDE, STACK_W } from "./keep-out";

/** A PC footprint from x 80 to `MAX_SLIDE` left of home, full height: blocks far slides only. */
export const noFarSlide = (vp: Viewport) => ({
  x: 80,
  y: 0,
  w: Math.max(0, Math.round((vp.w - STACK_W) / 2) - MAX_SLIDE - 80),
  h: vp.h,
});

export function cappedSpot(...a: Parameters<typeof dmStackSpot>): ReturnType<typeof dmStackSpot> {
  const [vp, init, h, w = STACK_W, avoid = [], windows = [], hard = [], rows, d = [], pcs = []] = a;
  return dmStackSpot(
    vp,
    init,
    h,
    w,
    avoid,
    windows,
    hard,
    rows,
    d,
    [...pcs, noFarSlide(vp)],
    a[10],
  );
}

export function cappedPlacement(
  ...a: Parameters<typeof dmStackPlacement>
): ReturnType<typeof dmStackPlacement> {
  const [vp, init, h, w = STACK_W, avoid = [], windows = [], hard = [], rows, d = [], pcs = []] = a;
  return dmStackPlacement(
    vp,
    init,
    h,
    w,
    avoid,
    windows,
    hard,
    rows,
    d,
    [...pcs, noFarSlide(vp)],
    a[10],
  );
}
