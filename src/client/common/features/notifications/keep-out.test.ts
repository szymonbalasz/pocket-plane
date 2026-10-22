import { describe, expect, test } from "bun:test";
import { dmStackLefts, dmStackPlacement, pushedByPlan, STACK_W } from "./keep-out";

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
    expect(over(r, wolf)).toBe(false);
    expect(at.top).toBeGreaterThanOrEqual(48 + 32);
    expect(at.left + STACK_W + 12).toBeLessThanOrEqual(init.x);
  });
});

// Sprint 6 (sim-9 a01, b01; OQ-NOTE-25 A, #288).
type Box = { x: number; y: number; w: number; h: number };
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
const LOG = { x: 68, y: 584, w: 1150, h: 240 };
const COMPENDIUM = { x: 164, y: 172, w: 344, h: 400 };
const PARTY = { x: 576, y: 60, w: 440, h: 512 };
const DRAGON = { x: 70, y: 100, w: 90, h: 90 };
const GOBLIN_2 = { x: 300, y: 330, w: 45, h: 45 };
/** The Fog bar wrapped at its home spot (1440×900, FR-FOG-58). */
const FOG_BAR = { x: 62, y: 56, w: 472, h: 92 };

describe("FR-NOTE-42 stack stays home", () => {
  const vp = { w: 1440, h: 900 };

  // a01: with windows open the summary (320 × 57) jumped to x 68, over the Dragon.
  test("FR-NOTE-42 stack stays home: sim-9 a01 → the home (560), never x 68; moves down past Party instead of sideways", () => {
    const windows = [LOG, COMPENDIUM, PARTY];
    const at = dmStackPlacement(vp, INIT, 57, STACK_W, [GOBLIN_2], windows);
    expect(at.left).toBe(560);
    expect(hit(rectOf(at, 57), DRAGON)).toBe(false);
    for (const w of windows) expect(hit(rectOf(at, 57), { ...w, h: 32 })).toBe(false);
    // Without the Game log below it: below Party's body, still at the home.
    const down = dmStackPlacement(vp, INIT, 57, STACK_W, [GOBLIN_2], [COMPENDIUM, PARTY]);
    expect(down).toEqual({ left: 560, top: 60 + 512 + 8 });
    // Two cards (300 high) no longer fit below Party: home, on Party's body, never beside it.
    expect(dmStackPlacement(vp, INIT, 300, STACK_W, [GOBLIN_2], windows)).toEqual({
      left: 560,
      top: 100,
    });
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

  test("FR-NOTE-42 stack stays home: every chosen left ∈ {home, left-of-Initiative shift} at the four sizes", () => {
    expect(SIZES.map((s) => dmStackLefts(s, null))).toEqual([[480], [480], [560], [640]]);
    for (const size of SIZES) {
      const home = (size.w - STACK_W) / 2;
      for (const ix of [68, 300, 480, 600, 760, size.w - 412]) {
        for (const iy of [60, 300]) {
          const initiative = { x: ix, y: iy, w: 400, h: Math.min(648, size.h - 72 - iy) };
          const lefts = dmStackLefts(size, initiative);
          expect(lefts[0]).toBe(home);
          for (const l of lefts) expect(l).toBeGreaterThanOrEqual(68);
          for (const h of [57, 190, 330]) {
            for (const windows of [[], [PARTY], [LOG, COMPENDIUM], [LOG, COMPENDIUM, PARTY]]) {
              for (const avoid of [
                [],
                [DRAGON],
                [GOBLIN_2, { x: home + 40, y: 110, w: 50, h: 50 }],
              ]) {
                for (const hard of [[], [FOG_BAR]]) {
                  const at = dmStackPlacement(size, initiative, h, STACK_W, avoid, windows, hard);
                  expect(lefts).toContain(at.left);
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
  test("FR-NOTE-43 never over a tool bar: sim-9 b01 (Scenes pushed to 546, Fog tool) → no overlap, at the home", () => {
    const scenes = { x: 546, y: 61, w: 260, h: 440 };
    for (const h of [57, 190]) {
      const at = dmStackPlacement(vp, INIT, h, STACK_W, [GOBLIN_2], [LOG, scenes], [FOG_BAR]);
      expect(hit(rectOf(at, h), FOG_BAR)).toBe(false);
      expect(at.left).toBe(560);
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
    const at = dmStackPlacement(vp, INIT, 57, STACK_W, targets, [LOG, scenes], [FOG_BAR]);
    expect(hit(rectOf(at, 57), strip)).toBe(false);
    expect(hit(rectOf(at, 57), FOG_BAR)).toBe(false);
    expect(at).toEqual({ left: 560, top: 60 + 72 + 8 }); // at home (FR-NOTE-42), below the strip
    // No tool bar shown (nothing pushed): only the title bar blocks, as before (b05's spot).
    const free = dmStackPlacement(vp, INIT, 57, STACK_W, targets, [LOG, scenes], []);
    expect(free).toEqual({ left: 560, top: 60 + 32 + 8 });
  });

  test("FR-NOTE-44 no room in the band below the strip → over a body, never over the strip", () => {
    const tall = 900 - 64 - (60 + 72 + 8) + 1; // taller than the room below the strip
    const at = dmStackPlacement(vp, INIT, tall, STACK_W, [], [scenes], [FOG_BAR]);
    expect(hit(rectOf(at, tall), strip)).toBe(false);
  });
});

describe("FR-NOTE-44 walkthrough U4 (20261021-fu1-frame): Scenes' first row stays hit-testable", () => {
  // The report's rects at 1440×900: Fog bar 62,56 472×154; Scenes pushed to 546,60 260×360, its
  // first row "Goblin Ambush · Live" 559,145 198×34; Initiative 1028,60 400×512; Game log 68,584
  // 1150×240; the stack 320×152 ("2 pending actions" + Brakka's card).
  const vp = { w: 1440, h: 900 };
  const bar = { x: 62, y: 56, w: 472, h: 154 };
  const scenes = { x: 546, y: 60, w: 260, h: 360 };
  const init = { x: 1028, y: 60, w: 400, h: 512 };
  const log = { x: 68, y: 584, w: 1150, h: 240 };
  const row = { x: 546, y: 60, bottom: 145 + 34 };
  const probe = { x: 658, y: 162 }; // the row's centre (elementFromPoint)
  // The card's target under the lower spots (what made the stack take 140 in the run).
  const target = [{ x: 560, y: 300, w: 320, h: 280 }];
  const inside = (p: { x: number; y: number }, r: Box) =>
    p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

  test("FR-NOTE-44 toast clear of a pushed window's first row: with the row reported, the stack clears title bar + 40 px and the row; the row's centre isn't under it", () => {
    // The walkthrough's spot without the row report: below title + 40 (133) at 140, on the row.
    const before = dmStackPlacement(vp, init, 152, STACK_W, target, [log, scenes], [bar], []);
    expect(before.top).toBe(140);
    expect(inside(probe, rectOf(before, 152))).toBe(true);
    const at = dmStackPlacement(vp, init, 152, STACK_W, target, [log, scenes], [bar], [row]);
    expect(inside(probe, rectOf(at, 152))).toBe(false);
    expect(hit(rectOf(at, 152), { ...scenes, h: row.bottom - scenes.y })).toBe(false);
    expect(hit(rectOf(at, 152), bar)).toBe(false);
    expect(at.left).toBe(560); // still at home (FR-NOTE-42)
    // A report for another spot (the window before it was pushed) doesn't count.
    const stale = dmStackPlacement(
      vp,
      init,
      152,
      STACK_W,
      target,
      [log, scenes],
      [bar],
      [{ x: 68, y: 60, bottom: 179 }],
    );
    expect(stale).toEqual(before);
    // No tool bar: rows don't count (only title bars, as before).
    expect(dmStackPlacement(vp, init, 152, STACK_W, target, [log, scenes], [], [row]).top).toBe(
      100,
    );
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

  test("FR-NOTE-53 stack reads the plan: only a pushed window's title bar + 40 px block the stack, whether or not a bar shows", () => {
    // The card's targets below Scenes (sim-10 b05): the stack stays on Scenes' body.
    const targets = [
      { x: 600, y: 460, w: 45, h: 45 },
      { x: 600, y: 520, w: 45, h: 45 },
    ];
    // Pushed per the plan, no bar in the list: below its title bar + 40 px.
    const log = { ...LOG, pushed: false };
    const plan = [log, { ...scenes, pushed: true }];
    const pushed = dmStackPlacement(vp, INIT, 57, STACK_W, targets, plan, []);
    expect(pushed).toEqual({ left: 560, top: 60 + 72 + 8 });
    // Not pushed (a window the user dropped there) while the Fog bar shows: its title bar only.
    const dropped = [log, { ...scenes, pushed: false }];
    const user = dmStackPlacement(vp, INIT, 57, STACK_W, targets, dropped, [FOG_BAR]);
    expect(user).toEqual({ left: 560, top: 60 + 32 + 8 });
    expect(hit(rectOf(user, 57), FOG_BAR)).toBe(false);
  });
});
