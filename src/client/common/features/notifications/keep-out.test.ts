import { describe, expect, test } from "bun:test";
import { dmStackPlacement, STACK_W } from "./keep-out";

describe("FR-NOTE-32 toast keep-out", () => {
  const top = 48 + 12 + 32 + 8;
  test("FR-NOTE-32 toast keep-out: Initiative clear of the centred stack → default place", () => {
    const vp = { w: 1440, h: 900 };
    expect(dmStackPlacement(vp, null, 200)).toEqual({ left: (1440 - STACK_W) / 2, top });
    // Default layout: Initiative top-right, 400 wide → no overlap.
    expect(dmStackPlacement(vp, { x: 1028, y: 60, w: 400, h: 700 }, 200)).toEqual({
      left: 560,
      top,
    });
  });

  test("FR-NOTE-32 toast keep-out: overlapping Initiative → stack left of it with a 12 px gap", () => {
    const vp = { w: 1024, h: 768 };
    const init = { x: 612, y: 60, w: 400, h: 600 };
    const at = dmStackPlacement(vp, init, 200);
    expect(at).toEqual({ left: 612 - 12 - STACK_W, top });
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
  });

  test("FR-NOTE-32 toast keep-out: too narrow left of it → below its bottom edge; minimised / closed → default", () => {
    const vp = { w: 1024, h: 768 };
    const init = { x: 300, y: 60, w: 600, h: 500 };
    expect(dmStackPlacement(vp, init, 200)).toEqual({ left: 352, top: 60 + 500 + 12 });
    // Measured stack height: an Initiative below the stack's bottom (+ gap) leaves it alone;
    // a taller stack reaching it shifts.
    const low = { x: 400, y: 400, w: 400, h: 200 };
    expect(dmStackPlacement(vp, low, 200)).toEqual({ left: 352, top });
    expect(dmStackPlacement(vp, low, 300)).toEqual({ left: 400 - 12 - STACK_W, top });
    // Minimised / closed: the runtime passes no rect.
    expect(dmStackPlacement(vp, null, 200)).toEqual({ left: 352, top });
  });

  // P3 glitch 2 (d03, r03): card toasts covered the Wolf and the goblins at the top centre.
  test("FR-NOTE-32 toast keep-out: the stack moves off the cards' likely targets, never over Initiative", () => {
    const vp = { w: 1440, h: 900 };
    const init = { x: 1028, y: 60, w: 400, h: 610 };
    const wolf = { x: 815, y: 160, w: 50, h: 50 };
    const goblin = { x: 708, y: 265, w: 50, h: 50 };
    const at = dmStackPlacement(vp, init, 190, STACK_W, [wolf, goblin]);
    const covers = (t: { x: number; y: number; w: number; h: number }) =>
      at.left < t.x + t.w && t.x < at.left + STACK_W && at.top < t.y + t.h && t.y < at.top + 190;
    expect(covers(wolf) || covers(goblin)).toBe(false);
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
    expect(at.top).toBe(top);
    // Nothing to avoid under the default spot → the default spot.
    expect(dmStackPlacement(vp, init, 190, STACK_W, [{ x: 100, y: 600, w: 50, h: 50 }])).toEqual({
      left: 560,
      top,
    });
    // 1280×720: still clear of Initiative (and its Undo) wherever the tokens are.
    const small = { w: 1280, h: 720 };
    const init2 = { x: 868, y: 60, w: 400, h: 578 };
    const p = dmStackPlacement(small, init2, 120, STACK_W, [{ x: 420, y: 180, w: 50, h: 50 }]);
    expect(p.left + STACK_W + 12).toBeLessThanOrEqual(init2.x);
  });
});
