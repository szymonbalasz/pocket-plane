import { describe, expect, test } from "bun:test";
import {
  clampRect,
  defaultRect,
  EDGE_GAP,
  MIN_VISIBLE_W,
  moveRect,
  resizeRect,
  TITLE_H,
  TOP_BAR_H,
} from "./geometry";

const vp = { w: 1600, h: 900 };

describe("geometry", () => {
  test("FR-SHELL-08 default rect by anchor", () => {
    const size = { w: 400, h: 300 };
    expect(defaultRect({ anchor: "top-left" }, size, vp)).toEqual({
      x: EDGE_GAP,
      y: TOP_BAR_H + EDGE_GAP,
      w: 400,
      h: 300,
    });
    expect(defaultRect({ anchor: "top-right" }, size, vp).x).toBe(1600 - 400 - EDGE_GAP);
    expect(defaultRect({ anchor: "top-left", dx: 10, dy: 20 }, size, vp)).toMatchObject({
      x: EDGE_GAP + 10,
      y: TOP_BAR_H + EDGE_GAP + 20,
    });
    expect(defaultRect({ anchor: "center" }, size, vp)).toMatchObject({ x: 600, y: 300 });
  });

  test("FR-SHELL-12 clamp: inside rect unchanged", () => {
    const r = { x: 100, y: 100, w: 400, h: 300 };
    expect(clampRect(r, vp)).toEqual(r);
  });

  test("FR-SHELL-12 clamp: ≤ viewport, title bar below top bar and inside, ≥ 120 px wide visible", () => {
    expect(clampRect({ x: 0, y: 0, w: 3000, h: 3000 }, vp)).toEqual({
      x: 0,
      y: TOP_BAR_H,
      w: 1600,
      h: 900 - TOP_BAR_H,
    });
    // Far right: 120 px stay visible.
    expect(clampRect({ x: 1590, y: 100, w: 400, h: 300 }, vp).x).toBe(1600 - MIN_VISIBLE_W);
    // Far left: 120 px of its width stay visible.
    expect(clampRect({ x: -1000, y: 100, w: 400, h: 300 }, vp).x).toBe(MIN_VISIBLE_W - 400);
    // Below the bottom: whole title bar stays in view.
    expect(clampRect({ x: 0, y: 2000, w: 400, h: 300 }, vp).y).toBe(900 - TITLE_H);
    // Narrow window: all of it stays visible.
    expect(clampRect({ x: 1590, y: 100, w: 80, h: 300 }, vp).x).toBe(1600 - 80);
  });

  test("FR-SHELL-12 clamp is render-only: same input after viewport shrinks and grows", () => {
    const stored = { x: 1300, y: 600, w: 400, h: 300 };
    const small = clampRect(stored, { w: 1280, h: 720 });
    expect(small.x).toBeLessThanOrEqual(1280 - MIN_VISIBLE_W);
    expect(small.y).toBeLessThanOrEqual(720 - TITLE_H);
    expect(clampRect(stored, vp)).toEqual(stored);
  });

  test("FR-SHELL-10 move by title bar, clamped", () => {
    const r = { x: 100, y: 100, w: 400, h: 300 };
    expect(moveRect(r, 50, 40, vp)).toEqual({ x: 150, y: 140, w: 400, h: 300 });
    expect(moveRect(r, 0, -500, vp).y).toBe(TOP_BAR_H);
  });

  test("FR-SHELL-10 resize: edges and corner, never below min or beyond the viewport", () => {
    const r = { x: 100, y: 100, w: 400, h: 300 };
    const min = { w: 200, h: 150 };
    expect(resizeRect(r, "se", 50, 60, min, vp)).toEqual({ x: 100, y: 100, w: 450, h: 360 });
    expect(resizeRect(r, "e", -1000, 0, min, vp).w).toBe(200);
    expect(resizeRect(r, "s", 0, -1000, min, vp).h).toBe(150);
    expect(resizeRect(r, "e", 5000, 0, min, vp).w).toBe(1600 - 100);
    expect(resizeRect(r, "s", 0, 5000, min, vp).h).toBe(900 - 100);
    // West edge keeps the right edge put.
    expect(resizeRect(r, "w", -50, 0, min, vp)).toEqual({ x: 50, y: 100, w: 450, h: 300 });
    expect(resizeRect(r, "w", 1000, 0, min, vp)).toEqual({ x: 300, y: 100, w: 200, h: 300 });
    expect(resizeRect(r, "w", -1000, 0, min, vp)).toEqual({ x: 0, y: 100, w: 500, h: 300 });
    expect(resizeRect(r, "sw", -10, 10, min, vp)).toEqual({ x: 90, y: 100, w: 410, h: 310 });
  });
});
