import { describe, expect, test } from "bun:test";
import {
  dmStackLefts,
  dmStackPlacement,
  dmStackSpot,
  MIN_SHIFT_LEFT,
  pushedByPlan,
  STACK_W,
  type StackWindow,
} from "./keep-out";
import { cappedPlacement, cappedSpot, noFarSlide } from "./keep-out-capped";

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
    const low = { x: 412, y: 400, w: 400, h: 200 };
    expect(dmStackPlacement(vp, low, 200)).toEqual({ left: 352, top });
    expect(dmStackPlacement(vp, low, 300)).toEqual({ left: 412 - 12 - STACK_W, top });
    // FR-NOTE-70: a shift to x 68 (no 12 px to the rail) doesn't count: never x 68.
    expect(dmStackPlacement(vp, { ...low, x: 400 }, 300).left).not.toBe(68);
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
    // FR-NOTE-42: it moves down (below the goblin) at its home, not sideways.
    expect(at).toEqual({ left: 560, top: goblin.y + goblin.h + 12 });
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
    expect(at.top + h).toBeLessThanOrEqual(720 - 12);
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
    expect(at.top + h).toBeLessThanOrEqual(900 - 12);
  });

  test("FR-NOTE-32 toast keep-out: a window under the default spot → below it (FR-NOTE-42: never beside it)", () => {
    // The Notifications window dragged to the top centre: its body is under the default spot.
    const notes = { x: 540, y: 60, w: 360, h: 480 };
    const at = dmStackPlacement(vp, init, 120, STACK_W, [], [notes]);
    expect(over(stack(at, 120), notes)).toBe(false);
    expect(at).toEqual({ left: 560, top: 60 + 480 + 8 });
  });

  test("FR-NOTE-32 toast keep-out: no spot clear of the bodies → over a body, never a title bar", () => {
    // One window filling the work area left of Initiative; a token under the default spot.
    const big = { x: 0, y: 48, w: 1016, h: 788 };
    const wolf = { x: 700, y: 120, w: 50, h: 50 };
    const at = dmStackPlacement({ w: 1440, h: 900 }, init, 120, STACK_W, [wolf], [big]);
    const r = stack(at, 120);
    expect(over(r, { ...big, h: 32 })).toBe(false);
    // FR-NOTE-71: no body-clear spot → nearest the home row (tokens rank only off the bodies),
    // below the window's title bar + first 40 px (ruling B).
    expect(at).toEqual({ left: 560, top: 48 + 72 + 8 });
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
  });
});

// Sprint 6 (sim-9 a01, b01; OQ-NOTE-25 A, #288).
type Box = { x: number; y: number; w: number; h: number };
/**
 * FR-NOTE-77: a left outside the column lefts is a slide: at most half the stack's width right of
 * home (left of home any distance, DM #364), ≥ 80 px, and its spot covers no window (and
 * Initiative + 12 px).
 */
const slideOk = (
  p: { left: number; top: number },
  h: number,
  home: number,
  boxes: readonly (Box | null)[],
) =>
  p.left - home <= STACK_W / 2 &&
  p.left >= 80 &&
  boxes.every((b) => b === null || !hit(rectOf(p, h), b));
const hit = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rectOf = (p: { left: number; top: number }, h: number): Box => ({
  x: p.left,
  y: p.top,
  w: STACK_W,
  h,
});
const SIZES = [
  { w: 1280, h: 720 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
];
// sim-9 at 1440×900: Initiative and the Game log by default; Compendium and Party from a01.
const INIT = { x: 1028, y: 60, w: 400, h: 648 };
const LOG = { x: 68, y: 608, w: 1150, h: 280 };
const COMPENDIUM = { x: 164, y: 172, w: 344, h: 400 };
const PARTY = { x: 576, y: 60, w: 440, h: 512 };
const DRAGON = { x: 70, y: 100, w: 90, h: 90 };
const GOBLIN_2 = { x: 300, y: 330, w: 45, h: 45 };
/**
 * A window filling the left of the band (walkthrough WF4): with it, no spot beside a window in
 * the band is clear, so FR-NOTE-44's strip rule decides on Scenes' body.
 */
const LEFT_COL = { x: 68, y: 60, w: 466, h: 500 };
/** The Fog bar wrapped at its home spot (1440×900, FR-FOG-58). */
const FOG_BAR = { x: 62, y: 56, w: 472, h: 92 };

describe("FR-NOTE-42 stack stays home", () => {
  const vp = { w: 1440, h: 900 };

  // a01: with windows open the summary (320 × 57) jumped to x 68, over the Dragon.
  test("FR-NOTE-42 stack stays home: sim-9 a01 → never x 68; down past Party first, never beside it (FR-NOTE-70)", () => {
    const windows = [LOG, COMPENDIUM, PARTY];
    // Party's body under the home and the Game log below it: no body-clear spot in the column →
    // home, nearest the home row, `covers` > 0 (the runtime folds; never beside Party).
    const at = cappedSpot(vp, INIT, 57, STACK_W, [GOBLIN_2], windows);
    expect(at).toMatchObject({ left: 560, top: 60 + 72 + 8 }); // below Party's first row (B)
    expect(at.covers).toBeGreaterThan(0);
    expect(hit(rectOf(at, 57), DRAGON)).toBe(false);
    expect(hit(rectOf(at, 57), { ...PARTY, h: 32 })).toBe(false);
    // Without the Game log below it: below Party's body, still at the home (down before aside).
    const down = cappedPlacement(vp, INIT, 57, STACK_W, [GOBLIN_2], [COMPENDIUM, PARTY]);
    expect(down).toEqual({ left: 560, top: 60 + 512 + 8 });
    // Two cards (300 high) fit nowhere clear: home, on Party's body (`covers` > 0: the runtime
    // folds a toast into "+N more" first).
    const tall = cappedSpot(vp, INIT, 300, STACK_W, [GOBLIN_2], windows);
    expect(tall.covers).toBeGreaterThan(0);
  });

  test("FR-NOTE-42 stack stays home: FR-NOTE-32 unchanged (shift left of Initiative, below it when no room)", () => {
    const small = { w: 1024, h: 768 };
    expect(dmStackPlacement(small, { x: 612, y: 60, w: 400, h: 600 }, 200)).toEqual({
      left: 612 - 12 - STACK_W,
      top: 100,
    });
    expect(dmStackPlacement(small, { x: 300, y: 60, w: 600, h: 500 }, 200)).toEqual({
      left: 352,
      top: 572,
    });
    // Initiative moved onto the home band, a window open: the shift is the only other left.
    const moved = { x: 700, y: 60, w: 400, h: 648 };
    expect(dmStackPlacement(vp, moved, 57, STACK_W, [], [COMPENDIUM])).toEqual({
      left: 700 - 12 - STACK_W,
      top: 100,
    });
  });

  test("FR-NOTE-42 stack stays home: avoidTokens still ranks target-token cover first", () => {
    // A target under the home top and a window body below it: off the token, onto the body.
    const wolf = { x: 600, y: 120, w: 50, h: 50 };
    const body = { x: 500, y: 150, w: 400, h: 300 };
    const at = dmStackPlacement(vp, INIT, 57, STACK_W, [wolf], [body]);
    expect(hit(rectOf(at, 57), wolf)).toBe(false);
    expect(hit(rectOf(at, 57), { ...body, h: 32 })).toBe(false);
    expect(at.left).toBe(560);
  });

  test("FR-NOTE-42 stack stays home: every chosen left ∈ {home, left-of-Initiative shift} or a slide in the band clear of every window (FR-NOTE-70, -77) at the four sizes", () => {
    expect(SIZES.map((s) => dmStackLefts(s, null))).toEqual([[480], [480], [560], [640]]);
    for (const size of SIZES) {
      const home = (size.w - STACK_W) / 2;
      for (const ix of [68, 300, 480, 600, 760, size.w - 412]) {
        for (const iy of [60, 300]) {
          const initiative = { x: ix, y: iy, w: 400, h: Math.min(648, size.h - 72 - iy) };
          const lefts = dmStackLefts(size, initiative);
          expect(lefts[0]).toBe(home);
          for (const l of lefts) expect(l).toBeGreaterThanOrEqual(80);
          for (const h of [57, 190, 330]) {
            for (const windows of [[], [PARTY], [LOG, COMPENDIUM], [LOG, COMPENDIUM, PARTY]]) {
              for (const avoid of [
                [],
                [DRAGON],
                [GOBLIN_2, { x: home + 40, y: 110, w: 50, h: 50 }],
              ]) {
                for (const hard of [[], [FOG_BAR]]) {
                  const at = dmStackPlacement(size, initiative, h, STACK_W, avoid, windows, hard);
                  if (lefts.includes(at.left)) continue;
                  const grown = {
                    ...initiative,
                    x: ix - 12,
                    y: iy - 12,
                    w: 424,
                    h: initiative.h + 24,
                  };
                  expect(slideOk(at, h, home, [...windows, grown])).toBe(true);
                }
              }
            }
          }
        }
      }
    }
  });
});

describe("FR-NOTE-43 never over a tool bar", () => {
  const vp = { w: 1440, h: 900 };

  test("FR-NOTE-43 never over a tool bar: Initiative moved to x 600 → the shifted stack drops below the bar (bar bottom + 8)", () => {
    const init = { x: 600, y: 60, w: 400, h: 648 };
    const at = dmStackPlacement(vp, init, 57, STACK_W, [], [], [FOG_BAR]);
    expect(at).toEqual({ left: 600 - 12 - STACK_W, top: 56 + 92 + 8 });
    expect(hit(rectOf(at, 57), FOG_BAR)).toBe(false);
    // No bar: FR-NOTE-32's shift at the top row.
    expect(dmStackPlacement(vp, init, 57)).toEqual({ left: 600 - 12 - STACK_W, top: 100 });
    // With a window and a target token too: still off the bar.
    const wolf = { x: 300, y: 200, w: 50, h: 50 };
    const p = dmStackPlacement(vp, init, 57, STACK_W, [wolf], [LOG], [FOG_BAR]);
    expect(hit(rectOf(p, 57), FOG_BAR)).toBe(false);
    expect(hit(rectOf(p, 57), wolf)).toBe(false);
  });

  // b01: 6 of 16 Fog bar controls under the summary at 68..388 × 100..157.
  test("FR-NOTE-43 never over a tool bar: sim-9 b01 (Scenes pushed to 546, Fog tool) → no overlap, never x 68", () => {
    const scenes = { x: 546, y: 61, w: 260, h: 440 };
    for (const h of [57, 190]) {
      const at = dmStackPlacement(vp, INIT, h, STACK_W, [GOBLIN_2], [LOG, scenes], [FOG_BAR]);
      expect(hit(rectOf(at, h), FOG_BAR)).toBe(false);
      expect(at.left).toBeGreaterThan(68);
    }
    // 1280×720: the bar (≤ 390 wide) ends before the home (480).
    const small = { w: 1280, h: 720 };
    const bar = { x: 62, y: 56, w: 390, h: 140 };
    const init = { x: 868, y: 60, w: 400, h: 578 };
    expect(dmStackPlacement(small, init, 57, STACK_W, [], [], [bar])).toEqual({
      left: 480,
      top: 100,
    });
  });

  test("FR-NOTE-43 never over a tool bar: a hard region under the home top → below it, with nothing else to avoid", () => {
    const wide = { x: 62, y: 56, w: 900, h: 92 };
    expect(dmStackPlacement(vp, null, 57, STACK_W, [], [], [wide])).toEqual({
      left: 560,
      top: 56 + 92 + 8,
    });
    // Taller than the room: the top row, off the bar where it can be.
    const corner = { x: 900, y: 56, w: 100, h: 50 };
    const tall = dmStackPlacement(vp, null, 800, STACK_W, [], [], [corner]);
    expect(hit(rectOf(tall, 800), corner)).toBe(false);
  });
});

describe("FR-NOTE-44 never over a pushed window's first row", () => {
  const vp = { w: 1440, h: 900 };
  // sim-10 b05: Scenes pushed by the Fog bar to 546, 60, inside the stack's band; Initiative at 1028.
  const scenes = { x: 546, y: 60, w: 260, h: 440 };
  const strip = { ...scenes, h: 32 + 40 };

  test("FR-NOTE-44 toast clear of a pushed window: the stack never covers Scenes' title bar or its first 40 px of body; it drops below that strip", () => {
    // The card's targets below Scenes (b05): the spots clear of them are on Scenes' body, and
    // the stack took the first, on top of Scenes' first row ("Goblin Ambush").
    const targets = [
      { x: 600, y: 460, w: 45, h: 45 },
      { x: 600, y: 520, w: 45, h: 45 },
    ];
    const at = dmStackSpot(vp, INIT, 57, STACK_W, targets, [LOG, scenes], [FOG_BAR]);
    expect(hit(rectOf(at, 57), strip)).toBe(false);
    expect(hit(rectOf(at, 57), FOG_BAR)).toBe(false);
    // FR-NOTE-70, -71: never beside Scenes; below it, off every body (b05: on Scenes' first row).
    expect(at).toMatchObject({ left: 560, top: 60 + 440 + 8, covers: 0 });
    // Scenes down to the Game log (no body-clear spot): nearest home, below the strip.
    const long = { ...scenes, h: 500 };
    const windows = [LOG, LEFT_COL, long];
    const blocked = dmStackPlacement(vp, INIT, 57, STACK_W, targets, windows, [FOG_BAR]);
    expect(blocked).toEqual({ left: 560, top: 60 + 72 + 8 });
    // No tool bar shown (nothing pushed): ruling B, every window's title bar + 40 px blocks too.
    const free = dmStackPlacement(vp, INIT, 57, STACK_W, targets, windows, []);
    expect(free).toEqual({ left: 560, top: 60 + 72 + 8 });
  });

  test("FR-NOTE-44 no room in the band below the strip → over a body, never over the strip", () => {
    const tall = 900 - 12 - (60 + 72 + 8) + 1; // taller than the room below the strip
    const at = dmStackPlacement(vp, INIT, tall, STACK_W, [], [scenes], [FOG_BAR]);
    expect(hit(rectOf(at, tall), strip)).toBe(false);
  });
});

describe("FR-NOTE-44 walkthrough U4 (20261021-fu1-frame): Scenes' first row stays hit-testable", () => {
  // The report's rects at 1440×900: Fog bar 62,56 472×154; Scenes pushed to 546,60 260×360, its
  // first row "Goblin Ambush · Live" 559,145 198×34; Initiative 1028,60 400×512; Game log 68,608
  // 1150×280 (K5); the stack 320×152 ("2 pending actions" + Brakka's card).
  const vp = { w: 1440, h: 900 };
  const bar = { x: 62, y: 56, w: 472, h: 154 };
  const scenes = { x: 546, y: 60, w: 260, h: 360 };
  const init = { x: 1028, y: 60, w: 400, h: 512 };
  const log = { x: 68, y: 608, w: 1150, h: 280 };
  const row = { x: 546, y: 60, bottom: 145 + 34 };
  const probe = { x: 658, y: 162 }; // the row's centre (elementFromPoint)
  // The card's target under the lower spots (what made the stack take 140 in the run).
  const target = [{ x: 560, y: 300, w: 320, h: 280 }];
  // Walkthrough WF4: a window left of Scenes below the bar. FR-NOTE-71: Scenes reaching the Game
  // log, so no spot clears every body and the stack takes the clear one nearest home.
  const left = { x: 68, y: 214, w: 466, h: 360 };
  const scenesLong = { ...scenes, h: 480 };
  const inside = (p: { x: number; y: number }, r: Box) =>
    p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

  test("FR-NOTE-44 toast clear of a pushed window's first row: with the row reported, the stack clears title bar + 40 px and the row; the row's centre isn't under it", () => {
    // The walkthrough's spot without the row report: below title + 40 (132), on the row.
    const before = dmStackPlacement(
      vp,
      init,
      152,
      STACK_W,
      target,
      [log, left, scenesLong],
      [bar],
      [],
    );
    expect(before.top).toBeGreaterThanOrEqual(60 + 72);
    expect(inside(probe, rectOf(before, 152))).toBe(true);
    const at = dmStackPlacement(
      vp,
      init,
      152,
      STACK_W,
      target,
      [log, left, scenesLong],
      [bar],
      [row],
    );
    expect(inside(probe, rectOf(at, 152))).toBe(false);
    expect(hit(rectOf(at, 152), { ...scenes, h: row.bottom - scenes.y })).toBe(false);
    expect(at.top).toBe(row.bottom + 8); // FR-NOTE-71: the clear spot nearest home
    expect(hit(rectOf(at, 152), bar)).toBe(false);
    expect(at.left).toBe(560); // still at home (FR-NOTE-42)
    // A report for another spot (the window before it was pushed) doesn't count.
    const stale = dmStackPlacement(
      vp,
      init,
      152,
      STACK_W,
      target,
      [log, left, scenesLong],
      [bar],
      [{ x: 68, y: 60, bottom: 179 }],
    );
    expect(stale).toEqual(before);
    // No tool bar: rows don't count, only title bar + 40 px (ruling B).
    expect(
      dmStackPlacement(vp, init, 152, STACK_W, target, [log, left, scenesLong], [], [row]).top,
    ).toBeGreaterThanOrEqual(60 + 72);
  });
});

describe("FR-NOTE-53 stack reads the plan", () => {
  const vp = { w: 1440, h: 900 };
  const scenes = { x: 546, y: 60, w: 260, h: 440 };

  test("FR-NOTE-53 stack reads the plan: pushed = `data-placed` pushed, or displaced with a toolbar cause", () => {
    expect(pushedByPlan("pushed", [])).toBe(true);
    expect(pushedByPlan("displaced", ["toolbar:map.toolbar"])).toBe(true);
    expect(pushedByPlan("displaced", ["viewport:1280×720"])).toBe(false);
    expect(pushedByPlan("displaced", ["window:cbt.initiative"])).toBe(false);
    for (const how of ["auto", "stored", "returned", "zone", "grown", undefined]) {
      expect(pushedByPlan(how, ["toolbar:map.toolbar"])).toBe(false);
    }
  });

  test("FR-NOTE-53 stack reads the plan: a pushed window's reported first row blocks the stack, whether or not a bar shows; any other window's too (FR-NOTE-75; was title bar + 40 px)", () => {
    // The card's targets below Scenes (sim-10 b05); Scenes reaching the Game log, so no spot
    // clears every body and the stack stays on Scenes' body (FR-NOTE-71: nearest home).
    const targets = [
      { x: 600, y: 460, w: 45, h: 45 },
      { x: 600, y: 520, w: 45, h: 45 },
    ];
    const long = { ...scenes, h: 500 };
    // Pushed per the plan, no bar in the list: below its title bar + 40 px.
    const log = { ...LOG, pushed: false };
    const col = { ...LEFT_COL, pushed: false };
    const plan = [log, col, { ...long, pushed: true }];
    // Its first content row reported 80 px into the body.
    const rows = [{ x: 546, y: 60, bottom: 60 + 32 + 80 }];
    const pushed = dmStackPlacement(vp, INIT, 57, STACK_W, targets, plan, [], rows);
    expect(pushed).toEqual({ left: 560, top: 60 + 32 + 80 + 8 });
    // Not pushed (a window the user dropped there) while the Fog bar shows: its first row too
    // (FR-NOTE-75, sprint 10; sprint 9 kept only title bar + 40 px).
    const dropped = [log, col, { ...long, pushed: false }];
    const user = dmStackPlacement(vp, INIT, 57, STACK_W, targets, dropped, [FOG_BAR], rows);
    expect(user).toEqual({ left: 560, top: 60 + 32 + 80 + 8 });
    expect(hit(rectOf(user, 57), FOG_BAR)).toBe(false);
  });
});

describe("FR-NOTE-42 windows in the home band (walkthrough WF4)", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 500 };
  // DM 1440×900: Stats auto-placed at 555,60 under the home spot; the Game log below.
  const stats = { x: 555, y: 60, w: 400, h: 412 };
  const log = { x: 68, y: 608, w: 1150, h: 280 };

  test("FR-NOTE-42 home band: the stack never covers a window under the home spot while a body-clear spot exists (below it); none → home, folded, never beside it (FR-NOTE-70)", () => {
    const at = cappedSpot(vp, init, 57, STACK_W, [], [stats, log]);
    expect(at.covers).toBe(0);
    expect(hit(rectOf(at, 57), stats)).toBe(false);
    expect(at).toMatchObject({ left: 560, top: 60 + 412 + 8 }); // down first (FR-NOTE-42)
    // Taller (2 cards): nothing below fits above the Game log → home, nearest the home row,
    // `covers` > 0 (the runtime folds), never beside Stats.
    const two = cappedSpot(vp, init, 190, STACK_W, [], [stats, log]);
    expect(two).toMatchObject({ left: 560, top: 60 + 72 + 8 }); // below Stats' first row (B)
    expect(two.covers).toBeGreaterThan(0);
  });

  test("FR-NOTE-42 home band: no clear spot (Notifications on the left, Initiative right, Game log below) → `covers` > 0, so the runtime folds toasts into '+N more'", () => {
    const notes = { x: 68, y: 92, w: 360, h: 478 };
    const at = dmStackSpot(vp, init, 375, STACK_W, [], [notes, stats, log]);
    expect(at.covers).toBeGreaterThan(0);
    // Folded to the summary + one card (≈ 150 px): still on a body (a full screen); folded to
    // the summary alone it fits below Stats.
    expect(dmStackSpot(vp, init, 57, STACK_W, [], [notes, stats, log]).covers).toBe(0);
  });
});

// Sprint 9 (track FX, BL-83 / BL-75 / BL-88; sim-12 c01, c03, r03, WF4 re-test).
describe("FR-NOTE-70 stack never leaves its column", () => {
  // sim-12 c01 (1280×720): Initiative and the Game log at their defaults, Scenes dragged to
  // 400, 112; Mira's token at the left (the stack landed on her at x 68).
  const small = { w: 1280, h: 720 };
  const init = { x: 868, y: 60, w: 400, h: 578 };
  const log = { x: 68, y: 444, w: 788, h: 212 };
  const mira = { x: 120, y: 140, w: 50, h: 50 };

  test("FR-NOTE-70 stack never leaves its column: sim-12 c01 → left 480, never 68", () => {
    const scenes = { x: 400, y: 112, w: 260, h: 360 };
    // The summary, then two cards (taller than the room: the runtime folds before placing).
    for (const h of [57, 190]) {
      const at = dmStackSpot(small, init, h, STACK_W, [mira], [log, scenes]);
      expect(at.left).toBe(480);
      expect(hit(rectOf(at, h), { ...scenes, h: 32 })).toBe(false);
      expect(hit(rectOf(at, h), mira)).toBe(false);
      // On Scenes' body: the runtime folds (`covers` > 0), never moves beside it.
      expect(at.covers).toBeGreaterThan(0);
    }
  });

  test("FR-NOTE-70 stack never leaves its column: sim-12 c03 (1440×900, Fog bar, Scenes pushed) → 560 or the shift, below the bar; never 68 or 276", () => {
    const vp = { w: 1440, h: 900 };
    const scenes = { x: 546, y: 60, w: 260, h: 440, pushed: true };
    const party = { x: 68, y: 160, w: 466, h: 400 };
    for (const h of [57, 190]) {
      const at = dmStackSpot(vp, INIT, h, STACK_W, [GOBLIN_2], [LOG, party, scenes], [FOG_BAR]);
      expect([560, INIT.x - 12 - STACK_W]).toContain(at.left);
      expect(at.left).not.toBe(68);
      expect(at.left).not.toBe(276);
      expect(hit(rectOf(at, h), FOG_BAR)).toBe(false);
      expect(hit(rectOf(at, h), { ...scenes, h: 32 + 40 })).toBe(false);
    }
  });

  test("FR-NOTE-70 stack never leaves its column: 500 seeded random window sets at the four sizes → every left ∈ {home, shift ≥ 80} or a slide in the band clear of every window (FR-NOTE-77)", () => {
    let seed = 20261023;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    const box = (vp: { w: number; h: number }): StackWindow => {
      const w = 200 + rnd(500);
      const h = 120 + rnd(500);
      const x = 68 + rnd(Math.max(1, vp.w - 68 - w));
      return { x, y: 48 + rnd(Math.max(1, vp.h - 112 - h)), w, h };
    };
    for (let i = 0; i < 500; i++) {
      const vp = SIZES[i % SIZES.length] as { w: number; h: number };
      const home = (vp.w - STACK_W) / 2;
      const initiative = rnd(3) === 0 ? null : { ...box(vp), w: 400 };
      const windows = Array.from({ length: rnd(6) }, () => ({ ...box(vp), pushed: rnd(4) === 0 }));
      // FR-NOTE-72: sometimes one of them is this client's open Notifications window.
      const first = windows[0];
      if (first && rnd(3) === 0) windows[0] = { ...first, blocks: true };
      const hard = rnd(3) === 0 ? [FOG_BAR] : [];
      const h = [57, 150, 190, 330][rnd(4)] as number;
      const at = dmStackSpot(vp, initiative, h, STACK_W, [], windows, hard);
      const shifts = [initiative, ...windows.filter((w) => w.blocks)]
        .filter((b) => b !== null)
        .map((b) => Math.round(b.x - 12 - STACK_W))
        .filter((l) => l >= MIN_SHIFT_LEFT && l < home);
      expect(at.left).toBeGreaterThanOrEqual(80);
      if ([home, ...shifts].includes(at.left)) continue;
      const grown = initiative && {
        x: initiative.x - 12,
        y: initiative.y - 12,
        w: 424,
        h: initiative.h + 24,
      };
      expect(slideOk(at, h, home, [...windows, ...hard, grown])).toBe(true);
    }
  });
});

describe("FR-NOTE-71 nearest home, not the least body", () => {
  // WF4 re-test (1440×900): Notifications left of home, Stats in the home band, Initiative right,
  // the Game log 1150×280 at the bottom (its roll bar is its bottom 48 px).
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 500 };
  const notes = { x: 68, y: 92, w: 360, h: 478, blocks: true };
  const stats = { x: 555, y: 60, w: 400, h: 412 };
  const log = { x: 68, y: 608, w: 1150, h: 280 };
  const rollBar = { x: 68, y: 608 + 280 - 48, w: 1150, h: 48 };

  test("FR-NOTE-71 nearest home, not the least body: no body-clear spot → the smallest clear top; the Game log's roll bar is never under the stack", () => {
    for (const h of [150, 190, 375]) {
      const at = dmStackSpot(vp, init, h, STACK_W, [], [notes, stats, log]);
      expect(at.covers).toBeGreaterThan(0);
      // Below Stats' title bar + 40 px (ruling B), never down at the Game log.
      expect(at).toMatchObject({ left: 560, top: 60 + 72 + 8 });
      expect(hit(rectOf(at, h), rollBar)).toBe(false);
    }
  });

  test("FR-NOTE-71 nearest home, not the least body: a body-clear spot still wins, the least token area first", () => {
    // Below Stats is clear of every body (the summary alone).
    expect(dmStackSpot(vp, init, 57, STACK_W, [], [notes, stats, log])).toMatchObject({
      left: 560,
      top: 60 + 412 + 8,
      covers: 0,
    });
    // `avoidTokens` ranks first among body-clear spots: a token under the home top moves the
    // stack down onto the free map, not onto a body.
    const free = { x: 555, y: 60, w: 400, h: 32 };
    const wolf = { x: 600, y: 110, w: 40, h: 40 };
    const at = dmStackSpot(vp, init, 57, STACK_W, [wolf], [free, log]);
    expect(at.covers).toBe(0);
    expect(hit(rectOf(at, 57), wolf)).toBe(false);
    expect(at.left).toBe(560);
  });
});

describe("FR-NOTE-53 every window's first row (sprint 9 ruling B)", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 500 };

  test("FR-NOTE-53 every window's first row keeps the stack off (ruling B): title bar + 40 px of any window; no spot clears them → FR-NOTE-71 as before (title bars only)", () => {
    // Stats under the home spot, the Game log below: no body-clear spot; the stack goes below
    // Stats' first 40 px of body (its tabs), not right under its title bar.
    const stats = { x: 555, y: 60, w: 400, h: 412 };
    const log = { x: 68, y: 608, w: 1150, h: 280 };
    const tabs = { x: 555, y: 60 + 32, w: 400, h: 40 };
    for (const h of [190, 330]) {
      const at = cappedSpot(vp, init, h, STACK_W, [], [stats, log]);
      expect(at).toMatchObject({ left: 560, top: 60 + 72 + 8 });
      expect(hit(rectOf(at, h), tabs)).toBe(false);
    }
    // A stack too tall to clear any window's first 40 px (it must sit by 136): the title bars
    // alone decide, nearest home (FR-NOTE-71 as before).
    const low = { x: 500, y: 100, w: 440, h: 600 };
    expect(cappedSpot(vp, init, 752, STACK_W, [], [low])).toMatchObject({ left: 560, top: 136 });
  });
});

describe("FR-NOTE-72 an open Notifications window counts like Initiative", () => {
  const vp = { w: 1440, h: 900 };
  // r03 (1440×900): Notifications at 592, 60 (over the home column), Brakka's card pending.
  const notes = { x: 592, y: 60, w: 360, h: 480, blocks: true };

  test("FR-NOTE-72 keep clear of an open Notifications window: shift left of it, else below it", () => {
    for (const h of [57, 190]) {
      const at = dmStackSpot(vp, INIT, h, STACK_W, [], [notes, LOG]);
      expect(at).toMatchObject({ left: 592 - 12 - STACK_W, top: 100, covers: 0 });
      expect(hit(rectOf(at, h), notes)).toBe(false);
    }
    // No room left of it (shift < 80): K12 (kit round 3) the clear spot nearest home, beside it
    // (12 px gap, within the half-width slide) over the map, before below it (60 + 480 + 12).
    const wide = { ...notes, x: 300 };
    const at = dmStackSpot(vp, INIT, 57, STACK_W, [], [wide]);
    expect(at).toMatchObject({ left: 300 + 360 + 12, top: 100, covers: 0 });
    expect(hit(rectOf(at, 57), wide)).toBe(false);
    expect(hit(rectOf(at, 57), wide)).toBe(false);
    // Not marked (any other window): never a shift beside it.
    expect(dmStackLefts(vp, INIT, STACK_W, [{ ...notes, blocks: false }])).toEqual([560]);
    expect(dmStackLefts(vp, INIT, STACK_W, [notes])).toEqual([560, 592 - 12 - STACK_W]);
  });
});

describe("FR-NOTE-50 toast policy: dialogs (walkthrough T4)", () => {
  const vp = { w: 1440, h: 900 };
  // The HP dialog at 496,293 448×314; the DM stack keeps off it like a hard keep-out.
  const dialog = { x: 496, y: 293, w: 448, h: 314 };

  test("FR-NOTE-50 toast policy: an open dialog keeps the DM stack off it (above it while it fits, else below), never under or over it", () => {
    const small = dmStackPlacement(vp, INIT, 111, STACK_W, [], [], [dialog]);
    expect(hit(rectOf(small, 111), dialog)).toBe(false);
    expect(small).toEqual({ left: 560, top: 100 });
    const big = dmStackPlacement(vp, INIT, 200, STACK_W, [], [], [dialog]);
    expect(hit(rectOf(big, 200), dialog)).toBe(false);
    expect(big.top).toBe(293 + 314 + 8);
  });

  test("FR-NOTE-50 toast policy: with a dialog open the stack's room is the larger band above or below it", async () => {
    const { dialogRoom } = await import("./ToastRuntime");
    const full = 900 - 12 - 100;
    expect(dialogRoom(vp, [], full)).toBe(full);
    // FR-NOTE-76: the stack fits left of the dialog (shift 164) → the full column.
    expect(dialogRoom(vp, [dialog], full)).toBe(full);
    // A wide dialog (shift < 80). Above: 293 − 12 − 100 = 181; below: 900 − 12 − (607 + 12) = 269.
    expect(dialogRoom(vp, [{ ...dialog, x: 300 }], full)).toBe(269);
    expect(dialogRoom(vp, [{ x: 300, y: 100, h: 792 }], full)).toBe(0);
  });

  test("FR-NOTE-50 toast policy: only modal dialogs count (the attack popup opens over its toast, FR-CBT-75)", async () => {
    const { OPEN_DIALOG_SELECTOR } = await import("./dialog-rects");
    expect(OPEN_DIALOG_SELECTOR).toContain('[role="dialog"][data-state="open"]');
    expect(OPEN_DIALOG_SELECTOR).toContain(':not([aria-modal="false"])');
    expect(OPEN_DIALOG_SELECTOR).toContain('[role="alertdialog"][data-state="open"]');
  });
});

// Sprint 10 (H3, BL-101; session-sim-13 glitch 5, `.verify/20261023-193558-session-sim-13/`).
// Rects read off the screenshots; `used` = where each window's drawn content ends (the runtime
// measures it), `rows` = ShellWindow's first-row reports. Stack heights as drawn there.
describe("FR-NOTE-75 keep off window bodies' first rows", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 512 };
  const log = { ...LOG, used: LOG.y + LOG.h };
  const logRow = { x: LOG.x, y: LOG.y, bottom: LOG.y + 54 };

  test("FR-NOTE-75 sim-13 h07 (1280×720, Scenes at 400, 112, 5 cards): the stack keeps off Scenes' rows, over its empty body only", () => {
    const small = { w: 1280, h: 720 };
    const init720 = { x: 868, y: 60, w: 400, h: 578 };
    const log720 = { x: 68, y: 508, w: 688, h: 200, used: 708 };
    // New scene row, then "Goblin Ambush" (first row, to 232) and "Town" (to 268).
    const scenes = { x: 400, y: 112, w: 260, h: 410, used: 268 };
    const rows = [
      { x: 400, y: 112, bottom: 232 },
      { x: 68, y: 508, bottom: 544 },
    ];
    // One card + "+4 more" + the kill-feed callout, as drawn (h07: 192..365).
    const at = dmStackSpot(small, init720, 173, STACK_W, [], [log720, scenes], [], rows);
    expect(at).toMatchObject({ left: 480, top: 268 + 8, covers: 0 });
    expect(hit(rectOf(at, 173), { ...scenes, h: 268 - 112 })).toBe(false);
    expect(hit(rectOf(at, 173), log720)).toBe(false);
  });

  test("FR-NOTE-75 sim-13 h08 (1440×900, Fog bar, Scenes at 400, 222): K12: beside Scenes over the map (before: below its rows, on its empty body), off the bar", () => {
    const fog = { x: 62, y: 56, w: 470, h: 154 };
    const scenes = { x: 400, y: 222, w: 260, h: 400, used: 376, pushed: false };
    const rows = [{ x: 400, y: 222, bottom: 342 }, logRow];
    const at = dmStackSpot(vp, init, 173, STACK_W, [], [log, scenes], [fog], rows);
    expect(at).toMatchObject({ left: 400 + 260 + 12, top: 100, covers: 0 });
    expect(hit(rectOf(at, 173), scenes)).toBe(false);
    expect(hit(rectOf(at, 173), fog)).toBe(false);
  });

  test("FR-NOTE-75 sim-13 h09 (1440×900, Notifications open, Scenes at 316, 48): the shift left of Notifications; K12: below Scenes, on no window (before: on its empty body below its rows)", () => {
    const scenes = { x: 316, y: 48, w: 260, h: 412, used: 204 };
    const notes = { x: 656, y: 64, w: 360, h: 480, used: 544, blocks: true };
    const rows = [{ x: 316, y: 48, bottom: 168 }, logRow];
    // Two info toasts ("Party loot: …" on two lines, "Goblin Lurker falls").
    const at = dmStackSpot(vp, init, 127, STACK_W, [], [log, scenes, notes], [], rows);
    expect(at).toMatchObject({ left: 656 - 12 - STACK_W, top: 48 + 412 + 8, covers: 0 });
    expect(hit(rectOf(at, 127), scenes)).toBe(false);
    expect(hit(rectOf(at, 127), log)).toBe(false);
    expect(hit(rectOf(at, 127), notes)).toBe(false);
  });

  test("FR-NOTE-75 sim-13 f04 (1440×900, Rules at 430, 212): 'Saved …' toasts keep off the tabs and the search box (no spot clears all its content: below its first row)", () => {
    // Tabs (two rows) and search to 363, the first rule card to 452, the footer to 558.
    const rules = { x: 430, y: 212, w: 440, h: 360, used: 558 };
    const rows = [{ x: 430, y: 212, bottom: 452 }, logRow];
    const at = cappedSpot(vp, init, 119, STACK_W, [], [log, rules], [], rows);
    expect(at).toMatchObject({ left: 560, top: 452 + 8 });
    expect(hit(rectOf(at, 119), { ...rules, h: 452 - 212 })).toBe(false);
    expect(hit(rectOf(at, 119), log)).toBe(false);
  });
});

describe("FR-NOTE-76 an open modal dialog counts like Initiative", () => {
  test("FR-NOTE-76 sim-13 b07 (1280×720, the Start dialog at 416, 94 over the home column): the stack shifts left of it, never over its title", () => {
    const small = { w: 1280, h: 720 };
    const dialog = { x: 416, y: 94, w: 448, h: 532 };
    const encounters = { x: 68, y: 60, w: 440, h: 410 };
    const log720 = { x: 68, y: 508, w: 688, h: 200 };
    const init720 = { x: 868, y: 60, w: 400, h: 578 };
    // Windows, Initiative and tool bars under the modal's overlay are inert: only the dialog counts.
    const at = dmStackSpot(small, init720, 57, STACK_W, [], [encounters, log720], [], [], [dialog]);
    expect(at).toMatchObject({ left: 416 - 12 - STACK_W, top: 100 });
    expect(hit(rectOf(at, 57), dialog)).toBe(false);
    // At 1440×900 the same dialog is centred at 496, 184: the summary fits above it at home; a
    // taller stack shifts to 164 (never over it).
    const centred = { ...dialog, x: 496, y: 184 };
    const above = dmStackSpot(vp1440, INIT, 57, STACK_W, [], [LOG], [], [], [centred]);
    expect(above).toMatchObject({ left: 560, top: 100 });
    const tall = dmStackSpot(vp1440, INIT, 190, STACK_W, [], [LOG], [], [], [centred]);
    expect(tall).toMatchObject({ left: 496 - 12 - STACK_W, top: 100 });
    expect(hit(rectOf(tall, 190), centred)).toBe(false);
    // No room left of a wide dialog (shift < 80): above it while it fits (the home row), else
    // below it.
    const wideDialog = { x: 384, y: 300, w: 512, h: 300 };
    const home = dmStackSpot(small, init720, 57, STACK_W, [], [], [], [], [wideDialog]);
    expect(home).toMatchObject({ left: 480, top: 100 });
    const low = { ...wideDialog, y: 140, h: 420 };
    const under = dmStackSpot(small, init720, 57, STACK_W, [], [], [], [], [low]);
    expect(under).toMatchObject({ left: 480, top: 140 + 420 + 12 });
  });
});
const vp1440 = { w: 1440, h: 900 };

// Walkthrough H3 re-test inputs (`.verify/20261024-h3/report.md`, steps 1b, 2, 4): rects as the
// browser reported them. `pcs`: the PC tokens' footprints + 4 px (play-shell `pcBoxes`).
describe("FR-NOTE-77 a clear spot beside a window beats the first rows", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 512 };
  const log = { ...LOG, used: LOG.y + LOG.h, head: LOG.y + 60 };
  const pcs = [
    { x: 288, y: 334, w: 58, h: 66 },
    { x: 341, y: 334, w: 58, h: 66 },
  ];

  test("FR-NOTE-77 walkthrough H3 1b (1440×900, Fog on, Scenes at 400, 222): K12: beside Scenes at 672, 100 again (a spot on no window beats Scenes' empty body; K5 had it home over that body), never over the Town row", () => {
    const fog = { x: 62, y: 56, w: 470, h: 154 };
    const scenes = { x: 400, y: 222, w: 260, h: 410, used: 375, head: 339, pushed: false };
    const town = { x: 413, y: 341, w: 234, h: 34 };
    const rows = [{ x: 400, y: 222, bottom: 339 }];
    const at = dmStackSpot(vp, init, 206, STACK_W, [], [log, scenes], [fog], rows, [], pcs);
    expect(at).toMatchObject({ left: 672, top: 100, covers: 0 });
    expect(hit(rectOf(at, 206), scenes)).toBe(false);
    expect(hit(rectOf(at, 206), town)).toBe(false);
    expect(hit(rectOf(at, 206), fog)).toBe(false);
  });

  test("FR-NOTE-77 walkthrough H3 2 (1440×900, Rules at 430, 212, cards pending): no clear spot for the cards → they fold into the summary, which sits home above Rules, off its tabs and search box", () => {
    const rules = { x: 430, y: 212, w: 440, h: 360, used: 572, head: 418 };
    const tabs = { x: 451, y: 265, w: 398, h: 60 };
    const search = { x: 451, y: 333, w: 398, h: 30 };
    // Summary + 1 card + "+2 more" (186): left of Rules is 462 px from home (never, #288), right
    // of it is Initiative: on Rules' body, so the runtime folds.
    const unfolded = cappedSpot(vp, init, 186, STACK_W, [], [log, rules], [], [], [], pcs);
    expect(unfolded.covers).toBeGreaterThan(0);
    expect(unfolded.left).toBe(560);
    // Folded to the summary + "+3 more" (91): home, above Rules' title bar.
    const at = cappedSpot(vp, init, 91, STACK_W, [], [log, rules], [], [], [], pcs);
    expect(at).toMatchObject({ left: 560, top: 100, covers: 0 });
    for (const part of [{ ...rules, h: 32 }, tabs, search])
      expect(hit(rectOf(at, 91), part)).toBe(false);
  });
});

describe("FR-NOTE-77 after a dialog closes: home, or beside the window over it", () => {
  const small = { w: 1280, h: 720 };
  const init = { x: 868, y: 60, w: 400, h: 583 };
  const log = { x: 68, y: 508, w: 690, h: 200, used: 708, head: 564 };
  // The roll bar as drawn: input, Dis / Normal / Adv, hide, Roll, macro, more.
  const logControls = [
    { x: 81, y: 672, w: 320, h: 28 },
    { x: 408, y: 672, w: 33, h: 28 },
    { x: 441, y: 672, w: 56, h: 28 },
    { x: 497, y: 672, w: 38, h: 28 },
    { x: 545, y: 674, w: 22, h: 22 },
    { x: 576, y: 672, w: 48, h: 28 },
    { x: 632, y: 674, w: 24, h: 24 },
    { x: 666, y: 674, w: 24, h: 24 },
  ];
  // K5: the newest entries above the roll bar (the runtime's `logRows`; the 200-px log has room
  // for a folded stack above its roll bar).
  const logRows = [
    { x: 81, y: 598, w: 620, h: 21 },
    { x: 81, y: 619, w: 620, h: 21 },
    { x: 81, y: 640, w: 620, h: 21 },
  ];

  test("FR-NOTE-77 walkthrough H3 4 (1280×720, Encounters at 68, 60): next to home, off Encounters and never on the Game log", () => {
    // The editor's root carries `data-record-id`: the frame's first-row report is the whole body.
    const enc = { x: 68, y: 60, w: 440, h: 410, used: 470, head: 248 };
    const rows = [
      { x: 68, y: 60, bottom: 470 },
      { x: 68, y: 508, bottom: 564 },
    ];
    for (const h of [57, 186]) {
      const at = dmStackSpot(
        small,
        init,
        h,
        STACK_W,
        [],
        [{ ...log, controls: logControls }, enc],
        [],
        rows,
      );
      expect(at).toMatchObject({ left: 508 + 12, top: 100, covers: 0 });
      expect(hit(rectOf(at, h), log)).toBe(false);
    }
  });

  test("FR-NOTE-77 walkthrough H3 4 (1280×720, Encounters at 396, 60): no clear spot → the spot over the fewest controls, never the Goblin −/+ rows", () => {
    const row = (y: number) => [
      { x: 437, y, w: 24, h: 24 },
      { x: 501, y, w: 24, h: 24 },
      { x: 533, y, w: 188, h: 24 },
      { x: 751, y: y + 2, w: 40, h: 20 },
      { x: 799, y: y + 2, w: 20, h: 20 },
    ];
    const controls = [
      { x: 449, y: 105, w: 303, h: 36 },
      { x: 409, y: 153, w: 413, h: 28 },
      ...row(220),
      ...row(276),
      { x: 534, y: 314, w: 16, h: 16 },
      { x: 409, y: 425, w: 86, h: 33 },
      { x: 507, y: 430, w: 66, h: 24 },
    ];
    const enc = { x: 396, y: 60, w: 440, h: 410, used: 470, head: 248, controls };
    const windows = [{ ...log, controls: logControls, logRows }, enc];
    // Summary + 1 card (186): on a body, so the runtime folds the cards into "+N more".
    expect(dmStackSpot(small, init, 186, STACK_W, [], windows).covers).toBeGreaterThan(0);
    // Folded (summary + "+2 more", 91): the home row, over the name inputs only.
    const at = dmStackSpot(small, init, 91, STACK_W, [], windows);
    expect(at).toMatchObject({ left: 480, top: 100 });
    for (const c of [...row(220), ...row(276), ...logControls]) {
      expect(hit(rectOf(at, 91), c)).toBe(false);
    }
  });
});

// Walkthrough H3 re-test 2 (`.verify/20261024-h3r/report.md` 1a, O1): the runtime's fold, frame by
// frame. A cap change re-renders at once; the stack's new height is measured a frame later
// (ResizeObserver), so a fold must wait for it. Heights as drawn: summary + "+N more" 92, each card
// + 94 (summary + 3 cards 394; 1a drew summary + 1 card + "+4 more" 206).
describe("FR-NOTE-77 the fold drops only the cards that don't fit", () => {
  const small = { w: 1280, h: 720 };
  const init = { x: 868, y: 60, w: 400, h: 578 };
  const log = { x: 68, y: 508, w: 690, h: 200, used: 708, head: 564 };

  /** Runs the runtime's fold to rest; returns the cap and the spot at the last measured height. */
  async function settle(
    windows: StackWindow[],
    heightOf: (cards: number) => number,
    pcs: Box[] = [],
    pending = 4,
  ) {
    const { foldCap, MAX_VISIBLE } = await import("./toasts");
    let s = { cap: MAX_VISIBLE, foldedAt: null as number | null };
    let measured = heightOf(Math.min(s.cap, pending));
    for (let frame = 0; frame < 40; frame++) {
      const spot = dmStackSpot(small, init, measured, STACK_W, [], windows, [], [], [], pcs);
      const shown = Math.min(s.cap, pending);
      const next = foldCap(s, { need: spot.covers > 0, min: 0, stackH: measured, shown });
      if (next.cap !== s.cap) {
        s = next; // re-render; the height is still the old one
        continue;
      }
      const h = heightOf(Math.min(s.cap, pending));
      if (h === measured) return { cap: s.cap, spot, h };
      measured = h; // ResizeObserver: the new height
    }
    throw new Error("the fold never settled");
  }

  test("FR-NOTE-77 walkthrough H3 1a (1280×720, Scenes at 400, 112, 4 live cards): one card stays, at 480, 273 above the Game log", async () => {
    const scenes = { x: 400, y: 112, w: 260, h: 410, used: 265, head: 229 };
    const r = await settle([log, scenes], (cards) => (cards === 0 ? 92 : 206 + (cards - 1) * 94));
    expect(r.cap).toBe(1);
    expect(r.h).toBe(206);
    expect(r.spot).toMatchObject({ left: 480, top: 273, covers: 0 });
  });

  test("FR-NOTE-77 walkthrough H3 O1 (1280×720, Encounters at 68, 60, 440 wide, live cards): one card stays, at 520, 100", async () => {
    const enc = { x: 68, y: 60, w: 440, h: 410, used: 470, head: 248 };
    // Thorn and Mira right of Encounters (+ 4 px): a taller stack at 520 would cover them.
    const pcs = [
      { x: 522, y: 290, w: 52, h: 54 },
      { x: 570, y: 290, w: 52, h: 54 },
    ];
    const r = await settle([log, enc], (cards) => (cards === 0 ? 92 : 186 + (cards - 1) * 94), pcs);
    expect(r.cap).toBe(1);
    expect(r.h).toBe(186);
    expect(r.spot).toMatchObject({ left: 520, top: 100, covers: 0 });
  });
});

// Walkthrough H3 re-test 3 (`.verify/20261024-h3r2/report.md` 4 @ 396, O2, O3): the summary alone
// (cards from before a reload) takes the same spots as a card stack. Rects as the browser gave
// them; `logRows`: the Game log's newest entries (what the DM reads first, like a first row).
describe("FR-NOTE-77 the summary alone takes a card stack's spots", () => {
  const small = { w: 1280, h: 720 };
  const init720 = { x: 868, y: 60, w: 400, h: 583 };
  const rollBar = [
    { x: 81, y: 672, w: 320, h: 28 },
    { x: 408, y: 672, w: 33, h: 28 },
    { x: 441, y: 672, w: 56, h: 28 },
    { x: 497, y: 672, w: 38, h: 28 },
    { x: 545, y: 674, w: 22, h: 22 },
    { x: 576, y: 672, w: 48, h: 28 },
    { x: 632, y: 674, w: 24, h: 24 },
    { x: 666, y: 674, w: 24, h: 24 },
  ];
  const log720 = {
    x: 68,
    y: 508,
    w: 690,
    h: 200,
    used: 708,
    head: 558,
    controls: rollBar,
    logRows: [
      { x: 81, y: 598, w: 620, h: 21 },
      { x: 81, y: 619, w: 620, h: 21 },
      { x: 81, y: 640, w: 620, h: 21 },
    ],
  };
  const onLog = (p: { left: number; top: number }, h: number) =>
    hit(rectOf(p, h), { x: 68, y: 508 + 33, w: 690, h: 167 });

  test("FR-NOTE-77 walkthrough H3 re-test 3, 4 @ 396 (1280×720, Encounters 396, 60 376 wide, reload: summary only) → near home over the fewest Encounters controls, never on the Game log", () => {
    const row = (y: number) => [
      { x: 421, y, w: 24, h: 24 },
      { x: 485, y, w: 24, h: 24 },
      { x: 509, y, w: 190, h: 24 },
      { x: 727, y: y + 2, w: 36, h: 20 },
    ];
    const enc = {
      x: 396,
      y: 60,
      w: 376,
      h: 410,
      used: 470,
      head: 248,
      controls: [
        { x: 413, y: 108, w: 24, h: 24 },
        { x: 449, y: 105, w: 240, h: 36 },
        { x: 409, y: 153, w: 350, h: 28 },
        ...row(220),
        ...row(276),
        { x: 409, y: 314, w: 16, h: 16 },
        { x: 534, y: 314, w: 16, h: 16 },
        { x: 409, y: 425, w: 86, h: 33 },
        { x: 507, y: 430, w: 66, h: 24 },
      ],
    };
    for (const h of [58, 92]) {
      const at = dmStackSpot(small, init720, h, STACK_W, [], [log720, enc], [], []);
      expect(at.left).toBe(480);
      expect(at.top).toBeLessThanOrEqual(140);
      expect(onLog(at, h)).toBe(false);
      for (const c of [...row(220), ...row(276)]) expect(hit(rectOf(at, h), c)).toBe(false);
    }
  });

  test("FR-NOTE-77 walkthrough H3 re-test 3, O3 (1280×720, Roll requests at 496, 60): K5: the summary + '+3 more' below the request form, over its empty body (before: home over the form), never on the Game log's entries or roll bar", () => {
    const requests = {
      x: 496,
      y: 60,
      w: 360,
      h: 410,
      used: 404,
      controls: [
        { x: 509, y: 138, w: 146, h: 28 },
        { x: 661, y: 138, w: 182, h: 28 },
        { x: 509, y: 174, w: 52, h: 24 },
        { x: 568, y: 174, w: 56, h: 24 },
        { x: 628, y: 174, w: 40, h: 24 },
        { x: 674, y: 174, w: 50, h: 24 },
        { x: 509, y: 205, w: 56, h: 28 },
        { x: 571, y: 211, w: 16, h: 16 },
        { x: 647, y: 205, w: 116, h: 28 },
        { x: 771, y: 207, w: 24, h: 24 },
        { x: 509, y: 239, w: 56, h: 28 },
        { x: 645, y: 361, w: 125, h: 26 },
        { x: 781, y: 361, w: 48, h: 26 },
      ],
    };
    const pcs = [
      { x: 366, y: 286, w: 52, h: 54 },
      { x: 414, y: 286, w: 52, h: 54 },
    ];
    const at = cappedSpot(small, init720, 92, STACK_W, [], [log720, requests], [], [], [], pcs);
    expect(at).toMatchObject({ left: 480, top: 404 + 8, covers: 0 });
    expect(onLog(at, 92)).toBe(false);
  });

  test("FR-NOTE-77 walkthrough H3 re-test 3, O2 (1440×900, Notifications closed, Scenes 316, 48, summary only) → K12: beside Scenes like the card stack (both on no window), not on its empty body nor far down below it", () => {
    const vp = { w: 1440, h: 900 };
    const scenes = { x: 316, y: 48, w: 260, h: 440, used: 201, head: 167 };
    const log = { ...LOG, used: LOG.y + LOG.h, head: LOG.y + 60 };
    const init = { x: 1028, y: 60, w: 400, h: 512 };
    const summary = dmStackSpot(vp, init, 58, STACK_W, [], [log, scenes], [], []);
    const cards = dmStackSpot(vp, init, 340, STACK_W, [], [log, scenes], [], []);
    expect(cards).toMatchObject({ left: 316 + 260 + 12, top: 100, covers: 0 });
    expect(summary).toMatchObject({ left: 316 + 260 + 12, top: 100, covers: 0 });
  });
});

// K12 (kit round 3, DM #363, round-2 gap 2): the K6b parity run at 1440×900 (bundle
// `kit-parity`, the "3 pending actions" summary, 58 px; rects as the browser reported them).
describe("FR-NOTE-77 K12 a spot on no window beats a window's empty body", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 536 };
  const log = { ...LOG, used: LOG.y + LOG.h, head: LOG.y + 60 };

  test("FR-NOTE-77 K12 Roll requests at 656, 60 (360 × 460): the summary below it on the map (before: 560, 251 on its empty body)", () => {
    const requests = { x: 656, y: 60, w: 360, h: 460, used: 243 };
    const at = dmStackSpot(vp, init, 58, STACK_W, [], [log, requests], [], []);
    expect(at).toMatchObject({ left: 560, top: 60 + 460 + 8, covers: 0 });
    expect(hit(rectOf(at, 58), requests)).toBe(false);
    expect(hit(rectOf(at, 58), log)).toBe(false);
  });

  test("FR-NOTE-77 K12 no clear spot (Party Manager at 544, 60, 472 × 536, down to the Game log; a PC left of the column blocks #364's slide): the existing pass-1 spot on its empty body, no fold", () => {
    const party = { x: 544, y: 60, w: 472, h: 536, used: 331 };
    const at = cappedSpot(vp, init, 58, STACK_W, [], [log, party], [], []);
    expect(at).toMatchObject({ left: 560, top: 331 + 8, covers: 0 });
  });

  test("FR-NOTE-77 K12 both clear: the nearer home of the column's spot and the slide (a short window left of home)", () => {
    // Scenes 316..576: below it at 560, 496 (396 px from home) vs beside it at 588, 100 (28).
    const scenes = { x: 316, y: 48, w: 260, h: 440, used: 201, head: 167 };
    expect(dmStackSpot(vp, init, 58, STACK_W, [], [log, scenes], [], [])).toMatchObject({
      left: 588,
      top: 100,
    });
    // A window right of home only to y 160: below it in the column (60 px) beats any slide.
    const low = { x: 700, y: 60, w: 300, h: 100, used: 160 };
    expect(dmStackSpot(vp, init, 58, STACK_W, [], [log, low], [], [])).toMatchObject({
      left: 560,
      top: 168,
    });
  });
});

// DM #364 (amends #288): the stack may slide further left than half its width when that spot
// covers no window and no PC token (K6b parity run, 1440×900, bundle `kit-parity`, the 58-px
// summary; Thorn's and Mira's tokens as drawn + 4 px).
describe("FR-NOTE-77 #364 a slide further left onto no window and no PC", () => {
  const vp = { w: 1440, h: 900 };
  const init = { x: 1028, y: 60, w: 400, h: 536 };
  const log = { ...LOG, used: LOG.y + LOG.h, head: LOG.y + 60 };
  const pcs = [
    { x: 414, y: 353, w: 58, h: 66 },
    { x: 470, y: 353, w: 60, h: 66 },
  ];
  const clearOf = (at: { left: number; top: number }, boxes: readonly Box[]) =>
    boxes.every((b) => !hit(rectOf(at, 58), b));

  const cases: [string, StackWindow, number][] = [
    ["Party Manager at 544, 60 (472 × 536)", { x: 544, y: 60, w: 472, h: 536, used: 331 }, 212],
    ["Encounters at 540, 60 (440 × 512)", { x: 540, y: 60, w: 440, h: 512, used: 175 }, 208],
    ["Preferences at 656, 60 (360 × 536)", { x: 656, y: 60, w: 360, h: 536, used: 596 }, 324],
  ];
  for (const [name, win, left] of cases) {
    test(`FR-NOTE-77 #364 ${name}: the summary slides left of it onto the map (12 px gap), off every window and PC; no fold`, () => {
      const at = dmStackSpot(vp, init, 58, STACK_W, [], [log, win], [], [], [], pcs);
      expect(at).toMatchObject({ left, top: 100, covers: 0 });
      expect(left).toBe(win.x - 12 - STACK_W);
      expect(560 - left).toBeGreaterThan(STACK_W / 2);
      expect(clearOf(at, [win, log, init, ...pcs])).toBe(true);
    });
  }

  test("FR-NOTE-77 #364 PCs on every such spot → the existing rules (Party Manager: its empty body, 560, 339); one PC → the next clear spot down", () => {
    const party = { x: 544, y: 60, w: 472, h: 536, used: 331 };
    const crowd = { ...noFarSlide(vp), y: 60, h: 540 };
    const at = dmStackSpot(vp, init, 58, STACK_W, [], [log, party], [], [], [], [...pcs, crowd]);
    expect(at).toMatchObject({ left: 560, top: 339 });
    const mira = { x: 300, y: 90, w: 58, h: 66 };
    const below = dmStackSpot(vp, init, 58, STACK_W, [], [log, party], [], [], [], [...pcs, mira]);
    expect(below).toMatchObject({ left: 212, top: 90 + 66 + 12, covers: 0 });
  });

  test("FR-NOTE-77 #364 a clear spot within the cap still wins (Scenes at 400, 222: beside it at 672, 100, not far left)", () => {
    const scenes = { x: 400, y: 222, w: 260, h: 400, used: 376 };
    const at = dmStackSpot(vp, init, 206, STACK_W, [], [log, scenes], [], [], [], pcs);
    expect(at).toMatchObject({ left: 672, top: 100 });
  });

  test("FR-NOTE-77 #364 sim-9 a01 (Compendium + Party): left of Party at 244, 100, never x 68, off the Dragon and the rail", () => {
    const at = dmStackSpot(vp, INIT, 57, STACK_W, [GOBLIN_2], [LOG, COMPENDIUM, PARTY]);
    expect(at).toMatchObject({ left: PARTY.x - 12 - STACK_W, top: 100, covers: 0 });
    expect(at.left).toBeGreaterThanOrEqual(80);
    expect(clearOf(at, [DRAGON, COMPENDIUM, PARTY, LOG])).toBe(true);
  });
});
