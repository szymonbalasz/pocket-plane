// Overview camera (FR-OVW-11, -12): the helpers of `scenes-map/camera.ts` with an item box in place
// of the map, per client and never sent. Fit runs when an overview first opens on a client and on
// the Fit button; adding or moving items never moves the camera. DOM-free for `bun test`.
import { railArea } from "../play-shell/free-area";
import { workArea } from "../play-shell/geometry";
import {
  type Box,
  bestFreeRect,
  type Camera,
  FIT_MARGIN,
  type FitRoom,
  fitCamera,
  type Size,
} from "../scenes-map/camera";
import { itemBox, type MeasureText, type OverviewItemView } from "./item-layout";

/** The box around every item this viewer has; none → null. */
export function itemsBox(items: readonly OverviewItemView[], measure: MeasureText): Box | null {
  if (items.length === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const b = itemBox(item, measure);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface OverviewFit extends Camera {
  /** The free rectangle the fit used; null with no items. */
  rect: Box | null;
}

/**
 * FR-OVW-12: `box` as large as fits, centred, in the candidate free rectangle (FR-SHELL-44, clear
 * of windows and the toast obstacles) that takes it largest. No candidate: the work area right of
 * the rail, as the map's fit. No items: origin at 100 %.
 */
export function fitOverview(box: Box | null, view: Size, room: FitRoom): OverviewFit {
  if (!box) return { x: 0, y: 0, scale: 1, rect: null };
  const areas = room.areas.length > 0 ? room.areas : room.windowsOnly;
  const rect = bestFreeRect(box, areas, areas[0] ?? railArea(view), box, workArea(view));
  const inner = fitCamera(box, rect, FIT_MARGIN);
  return {
    x: rect.x + inner.x - box.x * inner.scale,
    y: rect.y + inner.y - box.y * inner.scale,
    scale: inner.scale,
    rect,
  };
}

/**
 * FR-OVW-12: where each overview's camera was left on this page, so it fits only when it first
 * opens here (a Show of a battle scene and back keeps the player's view).
 */
const cameras = new Map<string, Camera>();

export const rememberedCamera = (overviewId: string): Camera | null =>
  cameras.get(overviewId) ?? null;

export function rememberCamera(overviewId: string, cam: Camera): void {
  cameras.set(overviewId, cam);
}
