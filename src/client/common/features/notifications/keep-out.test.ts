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

  // P3 retest: the summary toast at (68,100) covered the Notifications title bar at (68,92).
  test("FR-NOTE-32 toast keep-out: never over an open window's title bar", () => {
    const vp = { w: 1440, h: 900 };
    const init = { x: 1028, y: 60, w: 400, h: 610 };
    const bar = { x: 68, y: 92, w: 360, h: 32 };
    // Tokens push the stack to the left edge, where the bar is: it goes below the bar instead.
    const wolf = { x: 600, y: 120, w: 60, h: 60 };
    const at = dmStackPlacement(vp, init, 80, STACK_W, [wolf], [bar]);
    const r = { x: at.left, y: at.top, w: STACK_W, h: 80 };
    const over = (a: typeof r, b: typeof r) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(over(r, bar)).toBe(false);
    expect(over(r, { ...wolf })).toBe(false);
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
    // No tokens: the default spot when it is clear of the bar.
    expect(dmStackPlacement(vp, init, 80, STACK_W, [], [bar])).toEqual({ left: 560, top });
    // A bar under the default spot: another clear spot.
    const mid = { x: 500, y: 92, w: 400, h: 32 };
    const p = dmStackPlacement(vp, init, 80, STACK_W, [], [mid]);
    expect(over({ x: p.left, y: p.top, w: STACK_W, h: 80 }, mid)).toBe(false);
  });

  // P3 E3: at 1280×720 a 4-entry stack went below the Game log title bar (y 444) and off-screen.
  test("FR-NOTE-32 toast keep-out: the chosen spot holds the whole stack above the launcher", () => {
    const vp = { w: 1280, h: 720 };
    const init = { x: 868, y: 60, w: 400, h: 578 };
    const logBar = { x: 68, y: 404, w: 460, h: 32 };
    const goblins = [
      { x: 460, y: 160, w: 48, h: 48 },
      { x: 620, y: 200, w: 48, h: 48 },
      { x: 120, y: 200, w: 48, h: 48 },
    ];
    const h = 330;
    const at = dmStackPlacement(vp, init, h, STACK_W, goblins, [logBar]);
    expect(at.top + h).toBeLessThanOrEqual(720 - 64);
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
    // Taller than any slot: the top row (the runtime collapses toasts into "+N more").
    expect(dmStackPlacement(vp, init, 700, STACK_W, goblins, [logBar]).top).toBe(top);
  });
});

describe("FR-NOTE-32 sim-6 glitch 3: toasts keep off open windows' bodies", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 648 };
  type R = { x: number; y: number; w: number; h: number };
  const over = (a: R, b: R) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const stack = (p: { left: number; top: number }, h: number) => ({
    x: p.left,
    y: p.top,
    w: STACK_W,
    h,
  });

  // i01: 2 card toasts + "1 pending action" sat on the Notifications rows at the top-left.
  test("FR-NOTE-32 toast keep-out: a spot clear of the monsters, Initiative and every window body wins (i01)", () => {
    const notes = { x: 68, y: 92, w: 360, h: 480 };
    const log = { x: 68, y: 587, w: 460, h: 236 };
    const box = (x: number, y: number) => ({ x, y, w: 50, h: 50 });
    const monsters = [
      box(815, 160),
      box(497, 265),
      box(550, 318),
      box(708, 265),
      box(708, 370),
      box(866, 370),
    ];
    const h = 244;
    const at = dmStackPlacement(vp, init, h, STACK_W, monsters, [notes, log]);
    const r = stack(at, h);
    for (const w of [notes, log]) expect(over(r, w)).toBe(false);
    for (const t of monsters) expect(over(r, t)).toBe(false);
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
    expect(at.top + h).toBeLessThanOrEqual(900 - 64);
  });

  test("FR-NOTE-32 toast keep-out: a window under the default spot → beside it, not below its title bar", () => {
    // The Notifications window dragged to the top centre: its bar is under the default spot.
    const notes = { x: 540, y: 60, w: 360, h: 480 };
    const at = dmStackPlacement(vp, init, 120, STACK_W, [], [notes]);
    expect(over(stack(at, 120), notes)).toBe(false);
  });

  test("FR-NOTE-32 toast keep-out: no spot clear of the bodies → over a body, never a title bar", () => {
    // One window filling the work area left of Initiative; a token under the default spot.
    const big = { x: 0, y: 48, w: 1016, h: 788 };
    const wolf = { x: 700, y: 120, w: 50, h: 50 };
    const at = dmStackPlacement({ w: 1440, h: 900 }, init, 120, STACK_W, [wolf], [big]);
    const r = stack(at, 120);
    expect(over(r, { ...big, h: 32 })).toBe(false);
    expect(over(r, wolf)).toBe(false);
    expect(at.top).toBeGreaterThanOrEqual(48 + 32);
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
  });
});
