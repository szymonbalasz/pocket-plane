import { describe, expect, test } from "bun:test";
import { EDGE_GAP, LAUNCHER_CLEAR, type Rect, TOP_BAR_H } from "./geometry";
import { fittedDefaultRect, placeRect, usableArea } from "./placement";

const vp = { w: 1600, h: 900 };
const small = { w: 1280, h: 720 };
const def = (over: Partial<Parameters<typeof placeRect>[0]> = {}) => ({
  defaultPosition: { anchor: "top-left" as const },
  defaultSize: { w: 300, h: 200 },
  minSize: { w: 200, h: 100 },
  ...over,
});
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("open placement (FR-SHELL-08)", () => {
  test("fitted default: a tall window ends above the launcher, never below min size", () => {
    const tall = def({
      defaultPosition: { anchor: "top-right", dy: 200 },
      defaultSize: { w: 300, h: 900 },
    });
    const r = fittedDefaultRect(tall, small);
    expect(r.y).toBe(TOP_BAR_H + EDGE_GAP + 200);
    expect(r.y + r.h).toBe(small.h - EDGE_GAP - LAUNCHER_CLEAR);
    const tiny = fittedDefaultRect({ ...tall, minSize: { w: 200, h: 500 } }, small);
    expect(tiny.h).toBe(500);
    expect(tiny.y + tiny.h).toBeLessThanOrEqual(usableArea(small).bottom);
  });

  test("default rect free → default rect", () => {
    expect(placeRect(def(), vp, [])).toEqual({
      x: EDGE_GAP,
      y: TOP_BAR_H + EDGE_GAP,
      w: 300,
      h: 200,
    });
    const elsewhere = { x: 800, y: 300, w: 300, h: 300 };
    expect(placeRect(def(), vp, [elsewhere])).toEqual(placeRect(def(), vp, []));
  });

  test("default rect taken → nearest free slot, next to the open window", () => {
    const open = placeRect(def(), vp, []);
    const r = placeRect(def(), vp, [open]);
    expect(overlaps(r, open)).toBe(false);
    // Nearest to the default: directly below it, full size.
    expect(r).toEqual({ x: open.x, y: open.y + open.h + EDGE_GAP, w: 300, h: 200 });
    // A third one cascades again and covers neither.
    const third = placeRect(def(), vp, [open, r]);
    expect(overlaps(third, open) || overlaps(third, r)).toBe(false);
  });

  test("no full-size slot → tallest free slot ≥ min height", () => {
    const a = usableArea(vp);
    // Everything covered except a 150 px strip at the top.
    const block = { x: 0, y: a.top + 150 + EDGE_GAP, w: vp.w, h: vp.h };
    const r = placeRect(def(), vp, [block]);
    expect(r.h).toBe(150);
    expect(overlaps(r, block)).toBe(false);
  });

  test("nothing free → least overlap, inside the usable area", () => {
    const a = usableArea(vp);
    const cover = { x: 0, y: 0, w: vp.w, h: vp.h };
    const r = placeRect(def(), vp, [cover]);
    expect(r.x).toBeGreaterThanOrEqual(a.left);
    expect(r.y).toBeGreaterThanOrEqual(a.top);
    expect(r.y + r.h).toBeLessThanOrEqual(a.bottom);
  });
});
