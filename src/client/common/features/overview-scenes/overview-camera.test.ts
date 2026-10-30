// FR-OVW-12 Fit (OVW §13 unit): every item the viewer has, in the free area, with the map's helpers.
import { describe, expect, test } from "bun:test";
import { TOP_BAR_H } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";
import type { FitRoom } from "../scenes-map/camera";
import { FIT_MARGIN, ZOOM_MAX, ZOOM_MIN } from "../scenes-map/camera";
import type { OverviewItemView } from "./item-layout";
import { fitOverview, itemsBox } from "./overview-camera";

const image = (x: number, y: number, w: number, h: number): OverviewItemView => ({
  id: `${x},${y}`,
  campaignId: "c",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "image",
  x,
  y,
  w,
  h,
  hidden: false,
  assetId: "a",
  text: null,
  style: null,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
});
const measure = () => 0;
const view = { w: 1440, h: 900 };
const roomOf = (...areas: { x: number; y: number; w: number; h: number }[]): FitRoom => ({
  areas,
  obstacles: [],
  windowsOnly: areas,
});

describe("FR-OVW-12 fit", () => {
  test("FR-OVW-12 fit frames the items: all of them inside the free area, centred, with the margin", () => {
    const items = [image(-500, 200, 1000, 400), image(1500, 1000, 500, 500)];
    const free = { x: 300, y: 100, w: 1000, h: 700 };
    const box = itemsBox(items, measure);
    expect(box).toEqual({ x: -500, y: 200, w: 2500, h: 1300 });
    const f = fitOverview(box, view, roomOf(free));
    expect(f.rect).toEqual(free);
    if (!box) throw new Error("no box");
    const left = f.x + box.x * f.scale;
    const top = f.y + box.y * f.scale;
    const right = left + box.w * f.scale;
    const bottom = top + box.h * f.scale;
    expect(left).toBeGreaterThanOrEqual(free.x + FIT_MARGIN - 1e-6);
    expect(top).toBeGreaterThanOrEqual(free.y + FIT_MARGIN - 1e-6);
    expect(right).toBeLessThanOrEqual(free.x + free.w - FIT_MARGIN + 1e-6);
    expect(bottom).toBeLessThanOrEqual(free.y + free.h - FIT_MARGIN + 1e-6);
    // One axis touches the margin, and both are centred.
    expect(right - left).toBeCloseTo(free.w - 2 * FIT_MARGIN, 6);
    expect((left + right) / 2).toBeCloseTo(free.x + free.w / 2, 6);
    expect((top + bottom) / 2).toBeCloseTo(free.y + free.h / 2, 6);
  });

  test("FR-OVW-12 no items → origin at 100 %", () => {
    expect(itemsBox([], measure)).toBeNull();
    expect(fitOverview(null, view, roomOf({ x: 300, y: 100, w: 1000, h: 700 }))).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rect: null,
    });
  });

  test("FR-OVW-12 of the free rectangles, the one that frames them largest", () => {
    const tall = { x: 100, y: 48, w: 400, h: 800 };
    const wide = { x: 600, y: 48, w: 800, h: 400 };
    const box = itemsBox([image(0, 0, 800, 400)], measure);
    expect(fitOverview(box, view, roomOf(tall, wide)).rect).toEqual(wide);
  });

  test("FR-OVW-12 no free rectangle: the work area right of the rail", () => {
    const f = fitOverview(itemsBox([image(0, 0, 100, 100)], measure), view, roomOf());
    expect(f.rect?.x).toBe(RAIL_CLEAR);
    expect(f.rect?.y).toBe(TOP_BAR_H);
  });

  test("FR-OVW-11 the fit stays in the zoom range, 10–400 %", () => {
    const free = { x: 100, y: 48, w: 1000, h: 800 };
    expect(fitOverview(itemsBox([image(0, 0, 8, 8)], measure), view, roomOf(free)).scale).toBe(
      ZOOM_MAX,
    );
    expect(
      fitOverview(itemsBox([image(0, 0, 32000, 32000)], measure), view, roomOf(free)).scale,
    ).toBe(ZOOM_MIN);
  });
});
