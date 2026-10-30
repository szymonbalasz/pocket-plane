// The geometry of editing overview items (FR-OVW-15, -16, -18, -22, -23), generic over kind: the box
// select, a group's clamped delta, corner handles that keep the shape, and where a new image lands.
// In units; everything sent is rounded to the wire's 2 decimals. DOM-free for `bun test`.
import { IMAGE_SIDE, POSITION_MAX } from "@shared/overview-scenes/schemas";
import type { Box, Camera, Size } from "../scenes-map/camera";
import type { Box as DragBox } from "../scenes-map/selection-logic";
import {
  itemBox,
  type MeasureText,
  MINIATURE_SIDE_DEFAULT,
  type OverviewItemView,
} from "./item-layout";

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** FR-OVW-16: unlocked items whose drawn box's centre lies inside the box (any drag direction). */
export function itemsInBox(
  items: readonly OverviewItemView[],
  measure: MeasureText,
  box: DragBox,
): string[] {
  const [left, right] = box.x0 <= box.x1 ? [box.x0, box.x1] : [box.x1, box.x0];
  const [top, bottom] = box.y0 <= box.y1 ? [box.y0, box.y1] : [box.y1, box.y0];
  const out: string[] = [];
  for (const item of items) {
    if (item.locked) continue;
    const b = itemBox(item, measure);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (cx >= left && cx <= right && cy >= top && cy <= bottom) out.push(item.id);
  }
  return out;
}

/** FR-OVW-15, -18: the delta as far as every moved item stays inside ±16384. */
export function clampDelta(
  items: readonly Pick<OverviewItemView, "x" | "y">[],
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  let x = dx;
  let y = dy;
  for (const i of items) {
    x = clamp(x, -POSITION_MAX - i.x, POSITION_MAX - i.x);
    y = clamp(y, -POSITION_MAX - i.y, POSITION_MAX - i.y);
  }
  return { dx: x, dy: y };
}

/** An item moved by the delta, as `ovw.moveItems` takes it and the canvas draws it. */
export const movedBy = (item: Pick<OverviewItemView, "x" | "y">, dx: number, dy: number) => ({
  x: round2(item.x + dx),
  y: round2(item.y + dy),
});

export type ItemHandle = "nw" | "ne" | "sw" | "se";

export const ITEM_HANDLES: readonly ItemHandle[] = ["nw", "ne", "sw", "se"];

/** A corner's position in the box. */
export function handlePoint(box: Box, handle: ItemHandle): { x: number; y: number } {
  return {
    x: handle === "ne" || handle === "se" ? box.x + box.w : box.x,
    y: handle === "sw" || handle === "se" ? box.y + box.h : box.y,
  };
}

/** The corner within `reach` units of the point, if any. */
export function handleAt(box: Box, x: number, y: number, reach: number): ItemHandle | null {
  for (const h of ITEM_HANDLES) {
    const p = handlePoint(box, h);
    if (Math.abs(x - p.x) <= reach && Math.abs(y - p.y) <= reach) return h;
  }
  return null;
}

/** The box a kind's handles resize: an image's, or a miniature's square without its name. */
export const sideBox = (item: OverviewItemView): Box => {
  const w = item.w ?? MINIATURE_SIDE_DEFAULT;
  return { x: item.x, y: item.y, w, h: item.h ?? w };
};

/**
 * FR-OVW-23: the box with `handle` dragged to the point, the opposite corner fixed and the shape
 * kept, each side inside `bounds` and the top-left inside ±16384. A shape no scale can fit inside
 * the bounds (a 4096 × 1 image) gives way to them: the server refuses anything else (FR-OVW-24).
 */
export function resizeKeepingShape(
  from: Box,
  handle: ItemHandle,
  p: { x: number; y: number },
  bounds: { min: number; max: number },
): Box {
  const east = handle === "ne" || handle === "se";
  const south = handle === "sw" || handle === "se";
  const ax = east ? from.x : from.x + from.w;
  const ay = south ? from.y : from.y + from.h;
  const want = Math.max(
    (east ? p.x - ax : ax - p.x) / from.w,
    (south ? p.y - ay : ay - p.y) / from.h,
  );
  let most = bounds.max / Math.max(from.w, from.h);
  if (!east) most = Math.min(most, (ax + POSITION_MAX) / from.w);
  if (!south) most = Math.min(most, (ay + POSITION_MAX) / from.h);
  const s = Math.min(most, Math.max(bounds.min / Math.min(from.w, from.h), want));
  const w = clamp(round2(from.w * s), bounds.min, bounds.max);
  const h = clamp(round2(from.h * s), bounds.min, bounds.max);
  return { x: east ? from.x : round2(ax - w), y: south ? from.y : round2(ay - h), w, h };
}

/** Sides `factor` × the given ones, as near as the image bounds let the shape stay. */
function imageSides(w: number, h: number, factor: number): { w: number; h: number } {
  const s = Math.min(
    IMAGE_SIDE.max / Math.max(w, h),
    Math.max(IMAGE_SIDE.min / Math.min(w, h), factor),
  );
  return {
    w: clamp(round2(w * s), IMAGE_SIDE.min, IMAGE_SIDE.max),
    h: clamp(round2(h * s), IMAGE_SIDE.min, IMAGE_SIDE.max),
  };
}

export type OverviewView = Camera & Size;

/**
 * FR-OVW-22: on an empty overview, at its display size at the origin (the camera then fits, which
 * frames it wherever it is). Otherwise in the view's centre, its long side half the view's.
 */
export function imagePlacement(
  display: { displayWidth: number; displayHeight: number },
  view: OverviewView,
  empty: boolean,
): Box {
  const { displayWidth: dw, displayHeight: dh } = display;
  if (empty) return { x: 0, y: 0, ...imageSides(dw, dh, 1) };
  const vw = view.w / view.scale;
  const vh = view.h / view.scale;
  const sides = imageSides(dw, dh, Math.max(vw, vh) / 2 / Math.max(dw, dh));
  const cx = (view.w / 2 - view.x) / view.scale;
  const cy = (view.h / 2 - view.y) / view.scale;
  return {
    x: clamp(round2(cx - sides.w / 2), -POSITION_MAX, POSITION_MAX),
    y: clamp(round2(cy - sides.h / 2), -POSITION_MAX, POSITION_MAX),
    ...sides,
  };
}

/** FR-OVW-23 Image…: the sides for a new picture: this width, its shape. */
export function swappedSides(
  width: number,
  display: { displayWidth: number; displayHeight: number },
): { w: number; h: number } {
  return imageSides(display.displayWidth, display.displayHeight, width / display.displayWidth);
}
