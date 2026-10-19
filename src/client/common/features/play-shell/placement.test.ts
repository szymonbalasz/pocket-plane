import { describe, expect, test } from "bun:test";
import { EDGE_GAP, LAUNCHER_CLEAR, type Rect, TOP_BAR_H } from "./geometry";
import {
  fittedDefaultRect,
  type Placeable,
  type PlaceInput,
  placeWindow,
  RAIL_CLEAR,
  usableArea,
} from "./placement";

const vp = { w: 1600, h: 900 };
const small = { w: 1280, h: 720 };
const wide = { w: 1440, h: 900 };
const def = (over: Partial<Placeable> = {}): Placeable => ({
  defaultPosition: { anchor: "top-left" },
  defaultSize: { w: 300, h: 200 },
  minSize: { w: 200, h: 100 },
  ...over,
});
const place = (d: Placeable, v: { w: number; h: number }, input: PlaceInput = {}) =>
  placeWindow(d, v, input).rect;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("open placement (FR-SHELL-08, -45)", () => {
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

  test("default rect clear → default rect", () => {
    const home = { x: EDGE_GAP, y: TOP_BAR_H + EDGE_GAP, w: 300, h: 200 };
    expect(placeWindow(def(), vp)).toEqual({ rect: home, clear: true });
    const elsewhere = { x: 800, y: 300, w: 300, h: 300 };
    expect(place(def(), vp, { windows: [elsewhere] })).toEqual(home);
  });

  test("default rect taken → nearest clear slot in the default column, then the other edge", () => {
    const open = place(def(), vp);
    const r = place(def(), vp, { windows: [open] });
    expect(overlaps(r, open)).toBe(false);
    expect(r).toEqual({ x: open.x, y: open.y + open.h + EDGE_GAP, w: 300, h: 200 });
    const third = place(def(), vp, { windows: [open, r] });
    expect(overlaps(third, open) || overlaps(third, r)).toBe(false);
  });

  test("fixedDefault (test-mode windows) always opens at its default rect", () => {
    const home = fittedDefaultRect(def(), vp);
    expect(place(def({ fixedDefault: true }), vp, { windows: [home] })).toEqual(home);
  });

  test("a moved window stays right of the tool rail", () => {
    const wall = { x: 0, y: 0, w: 900, h: vp.h };
    const r = place(def({ defaultPosition: { anchor: "top-right" } }), vp, { windows: [wall] });
    expect(r.x).toBeGreaterThanOrEqual(RAIL_CLEAR);
  });

  test("FR-SHELL-45 full size before shrunk; shrunk clear before anything over a window", () => {
    const a = usableArea(vp);
    const tall = def({ defaultSize: { w: 300, h: 400 }, minSize: { w: 200, h: 150 } });
    // The default (left) column has only 200 above a log: the right edge has full size.
    const log = { x: EDGE_GAP, y: 272, w: 300, h: 200 };
    expect(place(tall, vp, { windows: [log] })).toEqual({
      x: a.right - 300,
      y: a.top,
      w: 300,
      h: 400,
    });
    // Both edges short of 400 → shrunk but clear, never over a window.
    const right = { x: a.right - 300, y: 372, w: 300, h: 100 };
    const r = place(tall, vp, { windows: [log, right] });
    expect(r.h).toBeLessThan(400);
    expect(overlaps(r, log) || overlaps(r, right)).toBe(false);
  });

  test("FR-SHELL-45 sim-8 FAIL j regression: equal token cover never ranks a window overlap first, and two launcher opens never share a rect", () => {
    // 1440×900 DM: Initiative right, a wide Game log along the bottom.
    const init = { x: 1028, y: 60, w: 400, h: 500, protected: true };
    const log = { x: 68, y: 584, w: 1150, h: 240, protected: true };
    const cmp = def({
      defaultSize: { w: 440, h: 560 },
      minSize: { w: 320, h: 360 },
      defaultPosition: { anchor: "top-left", dx: 56 },
      minOpenH: 400,
    });
    const party = def({
      defaultSize: { w: 440, h: 560 },
      minSize: { w: 340, h: 360 },
      defaultPosition: { anchor: "top-left", dx: 56 },
      minOpenH: 400,
    });
    const tokens = [{ x: 300, y: 300, w: 60, h: 60 }];
    const first = place(cmp, wide, { windows: [init, log], tokens });
    expect(first).toEqual({ x: 68, y: 60, w: 440, h: 512 });
    const second = place(party, wide, { windows: [init, log, first], tokens });
    expect(second).not.toEqual(first);
    for (const o of [init, log, first]) expect(overlaps(second, o)).toBe(false);
  });

  test("FR-SHELL-45 (1b) minOpenH takes a free slot: clear at ≥ minOpenH beats a taller one over a window", () => {
    const note = def({
      defaultPosition: { anchor: "bottom-right", dy: 64 },
      defaultSize: { w: 360, h: 480 },
      minSize: { w: 280, h: 240 },
      minOpenH: 480,
    });
    // DM at 1280×720: Initiative right, log bottom-left → the band left of Initiative, 412 high.
    const init = { x: 868, y: 60, w: 400, h: 500, protected: true };
    const log = { x: 68, y: 484, w: 690, h: 160, protected: true };
    const r = place(note, small, { windows: [init, log] });
    expect(r.h).toBe(412);
    for (const o of [init, log]) expect(overlaps(r, o)).toBe(false);
    // Where a clear 480 exists it takes it.
    expect(place(note, vp, { windows: [] }).h).toBe(480);
  });

  test("FR-SHELL-40 a slot shorter than the height the window renders at (`need`) is not taken: M8, Initiative's rows need 302 px", () => {
    const init = def({
      defaultPosition: { anchor: "top-right" },
      defaultSize: { w: 400, h: 500 },
      minSize: { w: 320, h: 240 },
    });
    const log = { x: 68, y: 404, w: 460, h: 240 };
    const comp = { x: 828, y: 60, w: 440, h: 560 };
    const r = place(init, small, { windows: [log, comp], need: 302 });
    expect(r.h).toBeGreaterThanOrEqual(302);
    for (const o of [log, comp]) expect(overlaps(r, o)).toBe(false);
    const a = usableArea(small);
    expect(place(init, small, { need: 2000 }).h).toBe(a.bottom - a.top);
  });

  test("FR-SHELL-45 (5) least token area among clear candidates, a shrunk one included; ties → default column, nearest", () => {
    const corner = def({ defaultPosition: { anchor: "top-right" } });
    const home = fittedDefaultRect(corner, vp);
    const onHome = [{ x: home.x + 10, y: home.y + 10, w: 50, h: 50 }];
    const r = place(corner, vp, { tokens: onHome });
    expect(overlaps(r, onHome[0] as Rect)).toBe(false);
    // Tokens under no candidate: the default rect.
    expect(place(corner, vp, { tokens: [{ x: 800, y: 450, w: 10, h: 10 }] })).toEqual(home);
  });
});

describe("sprint 5 placement (FR-SHELL-46–48, -51)", () => {
  const tall = def({
    defaultSize: { w: 300, h: 500 },
    minSize: { w: 300, h: 400 },
    defaultPosition: { anchor: "top-left", dx: 56 },
  });

  test("FR-SHELL-46 inward column: edges full → beside an open window, the one over fewer tokens first; never while an edge slot is clear and covers no PC", () => {
    const a = usableArea(vp);
    const leftWin = { x: 68, y: 60, w: 300, h: a.bottom - 60 };
    const rightWin = { x: a.right - 300, y: 60, w: 300, h: a.bottom - 60 };
    const r = placeWindow(tall, vp, { windows: [leftWin, rightWin] });
    expect(r.clear).toBe(true);
    expect([leftWin.x + leftWin.w + EDGE_GAP, rightWin.x - EDGE_GAP - 300]).toContain(r.rect.x);
    // Tokens beside the left window → beside the right one.
    const t = [{ x: leftWin.x + leftWin.w + 40, y: 60, w: 70, h: a.bottom - 60 }];
    const r2 = place(tall, vp, { windows: [leftWin, rightWin], tokens: t });
    expect(r2.x).toBe(rightWin.x - EDGE_GAP - 300);
    // An edge slot clear and over no PC: no inward column (even over a monster).
    const monster = [{ x: 100, y: 100, w: 70, h: 70 }];
    expect(place(tall, vp, { tokens: monster }).x).toBe(RAIL_CLEAR);
  });

  test("FR-SHELL-46 PC cover: Brakka under the left-edge slot → a clear inward slot wins, no PC token centre inside", () => {
    const init = { x: 1028, y: 60, w: 400, h: 500, protected: true };
    const log = { x: 68, y: 584, w: 1150, h: 240, protected: true };
    const cmp = def({
      defaultSize: { w: 440, h: 560 },
      minSize: { w: 320, h: 360 },
      defaultPosition: { anchor: "top-left", dx: 56 },
      minOpenH: 400,
    });
    const brakka = { x: 200, y: 200, w: 48, h: 48, pc: true };
    const r = place(cmp, wide, { windows: [init, log], tokens: [brakka] });
    expect(r.x).toBeGreaterThan(RAIL_CLEAR);
    const c = { x: brakka.x + 24, y: brakka.y + 24 };
    expect(c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.h).toBe(false);
    for (const o of [init, log]) expect(overlaps(r, o)).toBe(false);
  });

  test("FR-SHELL-46 inward column ≤ 5 ms best-of-5 for 10 windows × 200 token boxes", () => {
    const windows = Array.from({ length: 10 }, (_, i) => ({
      x: 68 + i * 140,
      y: 60 + (i % 3) * 200,
      w: 120,
      h: 180,
    }));
    const tokens = Array.from({ length: 200 }, (_, i) => ({
      x: (i * 37) % 1500,
      y: 60 + ((i * 53) % 760),
      w: 48,
      h: 48,
      pc: i % 20 === 0,
    }));
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      placeWindow(tall, vp, { windows, tokens });
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThanOrEqual(5);
  });

  test("FR-SHELL-47 screen full: no clear candidate → clear false; the fallback covers no protected window and no title bar", () => {
    const a = usableArea(small);
    const prot = { x: 68, y: 60, w: 1188, h: 80, protected: true };
    const other = { x: 68, y: 200, w: 1188, h: a.bottom - 200 };
    const p = placeWindow(tall, small, { windows: [prot, other] });
    expect(p.clear).toBe(false);
    expect(overlaps(p.rect, prot)).toBe(false);
    expect(overlaps(p.rect, { x: other.x, y: other.y, w: other.w, h: 32 })).toBe(false);
  });

  test("FR-SHELL-48 keep-outs: a hard region blocks like a window; a soft one only ranks (a window may sit under it when nothing clear of it exists)", () => {
    const corner = def({
      defaultPosition: { anchor: "bottom-right" },
      defaultSize: { w: 300, h: 200 },
    });
    const home = fittedDefaultRect(corner, vp);
    const box = { x: home.x - 20, y: home.y - 20, w: 356, h: 238 };
    const hard = place(corner, vp, { hard: [box] });
    expect(overlaps(hard, box)).toBe(false);
    const soft = place(corner, vp, { soft: [box] });
    expect(overlaps(soft, box)).toBe(false);
    // Nothing clear of the soft box: it sits under it, clear of every window.
    const fill = { x: 0, y: 0, w: vp.w, h: vp.h };
    const under = placeWindow(def(), vp, { soft: [fill] });
    expect(under.clear).toBe(true);
    // The same region hard: screen full.
    expect(placeWindow(def(), vp, { hard: [fill] }).clear).toBe(false);
  });

  test("FR-SHELL-51 fitted default: a top-anchored rect over a hard region below it ends 12 px above it, never below min; others left as is", () => {
    const sheet = def({
      defaultPosition: { anchor: "top-right" },
      defaultSize: { w: 320, h: 440 },
      minSize: { w: 280, h: 320 },
    });
    const corner720 = { x: 908, y: 410, w: 356, h: 238 };
    expect(fittedDefaultRect(sheet, small, [corner720])).toEqual({ x: 948, y: 60, w: 320, h: 338 });
    const corner800 = { x: 908, y: 490, w: 356, h: 238 };
    expect(fittedDefaultRect(sheet, { w: 1280, h: 800 }, [corner800]).h).toBe(418);
    // Below min (a corner at 300): left unfitted.
    const high = { x: 908, y: 300, w: 356, h: 238 };
    expect(fittedDefaultRect(sheet, small, [high]).h).toBe(440);
    // Bottom-anchored: left as is.
    const low = def({
      defaultPosition: { anchor: "bottom-right" },
      defaultSize: { w: 320, h: 440 },
    });
    expect(fittedDefaultRect(low, small, [corner720])).toEqual(fittedDefaultRect(low, small));
    // A size function per viewport class.
    const fn = def({ defaultSize: (v) => (v.w >= 1440 ? { w: 500, h: 200 } : { w: 300, h: 150 }) });
    expect(fittedDefaultRect(fn, small)).toMatchObject({ w: 300, h: 150 });
    expect(fittedDefaultRect(fn, wide)).toMatchObject({ w: 500, h: 200 });
  });
});
