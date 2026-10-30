// FR-OVW-15, -16, -22, -23: the geometry of editing items.
import { describe, expect, test } from "bun:test";
import { IMAGE_SIDE, MINIATURE_SIDE, POSITION_MAX } from "@shared/overview-scenes/schemas";
import {
  clampDelta,
  type ItemHandle,
  imagePlacement,
  itemsInBox,
  resizeKeepingShape,
  swappedSides,
} from "./item-edit";
import type { OverviewItemView } from "./item-layout";

const image = (over: Partial<OverviewItemView>): OverviewItemView => ({
  id: "i",
  campaignId: "c",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "image",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  hidden: false,
  assetId: "a",
  text: null,
  style: null,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
  ...over,
});

const from = { x: 100, y: 200, w: 400, h: 100 };

describe("FR-OVW-23 keeps its shape", () => {
  const drags: [ItemHandle, { x: number; y: number }, { x: number; y: number }][] = [
    ["se", { x: 900, y: 300 }, { x: 100, y: 200 }],
    ["nw", { x: -300, y: 300 }, { x: 500, y: 300 }],
    ["ne", { x: 900, y: 200 }, { x: 100, y: 300 }],
    ["sw", { x: -300, y: 300 }, { x: 500, y: 200 }],
  ];
  for (const [handle, to, fixed] of drags) {
    test(`FR-OVW-23 keeps its shape: ${handle}, the opposite corner fixed`, () => {
      const box = resizeKeepingShape(from, handle, to, IMAGE_SIDE);
      expect(box.w).toBe(800);
      expect(box.h).toBe(200);
      const east = handle === "ne" || handle === "se";
      const south = handle === "sw" || handle === "se";
      expect(east ? box.x : box.x + box.w).toBe(fixed.x);
      expect(south ? box.y : box.y + box.h).toBe(fixed.y);
    });
  }

  test("FR-OVW-23 keeps its shape at the 8 and 16384 bounds", () => {
    const small = resizeKeepingShape(from, "se", { x: 100, y: 200 }, IMAGE_SIDE);
    expect(small).toEqual({ x: 100, y: 200, w: 32, h: 8 });
    const large = resizeKeepingShape(from, "se", { x: 90000, y: 300 }, IMAGE_SIDE);
    expect(large).toEqual({ x: 100, y: 200, w: 16384, h: 4096 });
    // A miniature's bounds are tighter (FR-OVW-34).
    const square = { x: 0, y: 0, w: 64, h: 64 };
    const big = resizeKeepingShape(square, "se", { x: 9000, y: 9000 }, MINIATURE_SIDE);
    expect(big).toEqual({ x: 0, y: 0, w: 4096, h: 4096 });
  });

  test("FR-OVW-23 a west handle stops where the top-left would leave ±16384", () => {
    const edge = { x: -16300, y: 0, w: 100, h: 100 };
    const box = resizeKeepingShape(edge, "nw", { x: -20000, y: -20000 }, IMAGE_SIDE);
    expect(box.x).toBe(-POSITION_MAX);
    expect(box.w).toBe(box.h);
    expect(box.x + box.w).toBe(edge.x + edge.w);
  });

  test("FR-OVW-23 2 decimals and the shape, within a rounding", () => {
    const f = { x: 0, y: 0, w: 333, h: 217 };
    const box = resizeKeepingShape(f, "se", { x: 411.123, y: 10 }, IMAGE_SIDE);
    expect(Math.round(box.w * 100)).toBeCloseTo(box.w * 100, 6);
    expect(box.w / box.h).toBeCloseTo(f.w / f.h, 3);
  });

  test("FR-OVW-23 Image… keeps the width and takes the new shape", () => {
    expect(swappedSides(500, { displayWidth: 1000, displayHeight: 2000 })).toEqual({
      w: 500,
      h: 1000,
    });
    // A very thin picture: as near as the 8-unit floor lets it.
    const thin = swappedSides(100, { displayWidth: 2000, displayHeight: 40 });
    expect(thin).toEqual({ w: 400, h: 8 });
  });
});

describe("FR-OVW-22 where an image lands", () => {
  const view = { x: 100, y: 50, scale: 0.5, w: 1600, h: 900 };

  test("FR-OVW-22 an empty overview: its display size, at the origin", () => {
    const box = imagePlacement({ displayWidth: 4096, displayHeight: 2731 }, view, true);
    expect(box).toEqual({ x: 0, y: 0, w: 4096, h: 2731 });
  });

  test("FR-OVW-22 otherwise the view's centre, its long side half the view's", () => {
    const box = imagePlacement({ displayWidth: 1000, displayHeight: 500 }, view, false);
    // The view is 3200 × 1800 units, centred at (1400, 800).
    expect(box.w).toBe(1600);
    expect(box.h).toBe(800);
    expect(box.x + box.w / 2).toBe(1400);
    expect(box.y + box.h / 2).toBe(800);
    const tall = imagePlacement({ displayWidth: 500, displayHeight: 1000 }, view, false);
    expect(tall.h).toBe(1600);
    expect(tall.w).toBe(800);
  });

  test("FR-OVW-22 a tiny image stays inside the side bounds, its shape kept", () => {
    const box = imagePlacement({ displayWidth: 4, displayHeight: 2 }, view, true);
    expect(box).toEqual({ x: 0, y: 0, w: 16, h: 8 });
  });

  test("FR-OVW-15 the view far away: the top-left stays inside ±16384", () => {
    const far = { x: 900000, y: 0, scale: 1, w: 1000, h: 1000 };
    const box = imagePlacement({ displayWidth: 100, displayHeight: 100 }, far, false);
    expect(box.x).toBe(-POSITION_MAX);
  });
});

describe("FR-OVW-16 FR-OVW-18 selection geometry", () => {
  const measure = () => 0;

  test("FR-OVW-16 a box takes unlocked items whose centre is inside, any direction", () => {
    const items = [
      image({ id: "in", x: 0, y: 0, w: 10, h: 10 }),
      image({ id: "locked", x: 0, y: 0, w: 10, h: 10, locked: true }),
      image({ id: "edge-out", x: 90, y: 90, w: 40, h: 40 }),
    ];
    expect(itemsInBox(items, measure, { x0: 100, y0: 100, x1: -1, y1: -1 })).toEqual(["in"]);
  });

  test("FR-OVW-18 a group's delta stops where its first item would leave ±16384", () => {
    const items = [
      { x: 16000, y: 0 },
      { x: 0, y: -16000 },
    ];
    expect(clampDelta(items, 1000, -1000)).toEqual({ dx: 384, dy: -384 });
    expect(clampDelta(items, -5, 5)).toEqual({ dx: -5, dy: 5 });
  });
});
