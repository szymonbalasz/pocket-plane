import { describe, expect, test } from "bun:test";
import { EDGE_GAP, LAUNCHER_CLEAR, type Rect, TOP_BAR_H } from "./geometry";
import { fittedDefaultRect, placeRect, RAIL_CLEAR, usableArea } from "./placement";

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

  test("#162 edge-first: default column, then the other edge column, then least overlap at an edge; never mid-map", () => {
    const a = usableArea(vp);
    const tall = def({ defaultSize: { w: 300, h: 400 }, minSize: { w: 200, h: 150 } });
    // A log in the left column leaves 200 px above it and 340 below: less than the 400 asked,
    // so a full-size slot at the other edge beats the shorter one in the default column
    // (FR-NOTE-31 ruling).
    const log = { x: EDGE_GAP, y: 272, w: 300, h: 200 };
    expect(placeRect(tall, vp, [log])).toEqual({ x: a.right - 300, y: a.top, w: 300, h: 400 });
    // Both edges short of 400 → the tallest free slot in the default column.
    const rightLog = { x: a.right - 300, y: 272, w: 300, h: 200 };
    expect(placeRect(tall, vp, [log, rightLog])).toEqual({
      x: EDGE_GAP,
      y: log.y + log.h + EDGE_GAP,
      w: 300,
      h: 340,
    });
    // No room ≥ min height in the default column → the right edge, full size.
    const block = { x: EDGE_GAP, y: 140, w: 300, h: 600 };
    expect(placeRect(tall, vp, [block])).toEqual({ x: a.right - 300, y: a.top, w: 300, h: 400 });
    // Both edge columns taken, the middle free → overlap at an edge, never mid-map.
    const right = { x: a.right - 400, y: 0, w: 400, h: vp.h };
    const left = { x: 0, y: 0, w: 400, h: 740 };
    const r = placeRect(tall, vp, [left, right]);
    expect(r.x === EDGE_GAP || r.x + r.w === a.right ? "edge" : `mid-map x${r.x}`).toBe("edge");
    // Least overlap: min height at the bottom of the left column, over the block's last 66 px.
    expect(r).toEqual({ x: EDGE_GAP, y: a.bottom - 150, w: 300, h: 150 });
  });

  test("FR-NOTE-31 ruling: no full-size free slot → a `minOpenH` window opens at that height on top, covering the least; others shrink", () => {
    const a = usableArea(small);
    const tall = def({
      defaultPosition: { anchor: "bottom-right" },
      defaultSize: { w: 360, h: 480 },
      minSize: { w: 280, h: 240 },
    });
    // Right column: a window down to 560; left column: a log from 404.
    const init = { x: a.right - 400, y: a.top, w: 400, h: 500 };
    const log = { x: RAIL_CLEAR, y: 404, w: 460, h: 240 };
    const shrunk = placeRect(tall, small, [init, log]);
    expect(shrunk.h).toBeLessThan(480);
    const r = placeRect({ ...tall, minOpenH: 480 }, small, [init, log]);
    expect(r.h).toBe(480);
    expect(r.y + r.h).toBeLessThanOrEqual(a.bottom);
    expect(r.x === RAIL_CLEAR || r.x + r.w === a.right).toBe(true);
    // A full-size free slot still wins (no overlap).
    expect(overlaps(placeRect({ ...tall, minOpenH: 480 }, small, [log]), log)).toBe(false);
    // Clamped to the usable area.
    const huge = placeRect({ ...tall, minOpenH: 5000 }, small, [init, log]);
    expect(huge.y + huge.h).toBeLessThanOrEqual(a.bottom);
  });

  test("fixedDefault (test-mode windows) always opens at its default rect", () => {
    const open = placeRect(def(), vp, []);
    expect(placeRect(def({ fixedDefault: true }), vp, [open])).toEqual(open);
  });

  test("a moved window stays right of the tool rail", () => {
    const d = def({ defaultPosition: { anchor: "top-left", dx: 356 } });
    const open = placeRect(d, vp, []);
    for (const obstacles of [[open], [open, { ...open, y: open.y + open.h + EDGE_GAP }]]) {
      expect(placeRect(d, vp, obstacles).x).toBeGreaterThanOrEqual(RAIL_CLEAR);
    }
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

describe("P3 glitch 13: new windows keep clear of map tokens", () => {
  // Notifications-like window (360×480, minOpenH 480) at 1440×900, the right edge taken.
  const notes = def({
    defaultPosition: { anchor: "bottom-right" },
    defaultSize: { w: 360, h: 480 },
    minSize: { w: 280, h: 240 },
    minOpenH: 480,
  });
  const wide = { w: 1440, h: 900 };
  const log = { x: 68, y: 584, w: 460, h: 240 };

  test("FR-SHELL-08 two full-size free slots: the one over fewer tokens wins, whatever the column", () => {
    // Free at both edges; tokens near the right edge (the default column).
    const tokens = [{ x: 1200, y: 400, w: 50, h: 50 }];
    const r = placeRect(notes, wide, [log], tokens);
    expect(r.h).toBe(480);
    expect(tokens.some((t) => overlaps(r, t))).toBe(false);
    expect(overlaps(r, log)).toBe(false);
    // No tokens: the default column, as before.
    expect(placeRect(notes, wide, [log], []).x).toBe(placeRect(notes, wide, [log]).x);
    expect(placeRect(notes, wide, [log]).x).toBeGreaterThan(1000);
  });

  test("FR-SHELL-08 a free full-size slot still beats covering a window, even over tokens", () => {
    const init = { x: 1028, y: 60, w: 400, h: 600 };
    const pcs = [
      { x: 180, y: 320, w: 50, h: 50 },
      { x: 180, y: 425, w: 50, h: 50 },
    ];
    const r = placeRect(notes, wide, [init, log], pcs);
    expect(r.h).toBe(480);
    expect(overlaps(r, init) || overlaps(r, log)).toBe(false);
  });
});

describe("auto placement (FR-SHELL-40)", () => {
  const init = def({
    defaultPosition: { anchor: "top-right" },
    defaultSize: { w: 300, h: 400 },
    minSize: { w: 200, h: 150 },
  });
  const a = usableArea(vp);
  // Left column: 360 px free above it (shrunk); the right column is free at full size.
  const leftLog = { x: RAIL_CLEAR, y: 432, w: 300, h: 392 };
  const coveredBy = (r: Rect, boxes: readonly Rect[]) =>
    boxes.reduce((n, t) => n + (overlaps(r, t) ? 1 : 0), 0);

  test("FR-SHELL-40 placement: of the window-free candidates the one covering the least token area wins, a shrunk one included; no tokens → default rect", () => {
    const base = fittedDefaultRect(init, vp);
    expect(placeRect(init, vp, [leftLog], [])).toEqual(base);
    // Tokens down the whole right column: the shrunk slot at the left edge covers none.
    const monsters = [
      { x: 1400, y: 100, w: 70, h: 70 },
      { x: 1400, y: 500, w: 70, h: 70 },
      { x: 1400, y: 740, w: 70, h: 70 },
    ];
    const r = placeRect(init, vp, [leftLog], monsters);
    expect(r).toEqual({ x: RAIL_CLEAR, y: a.top, w: 300, h: leftLog.y - EDGE_GAP - a.top });
    expect(coveredBy(r, monsters)).toBe(0);
    // Tokens only under the default rect: the full-size slot lower in the default column.
    const top = [{ x: 1400, y: 100, w: 70, h: 70 }];
    const low = placeRect(init, vp, [leftLog], top);
    expect({ x: low.x, h: low.h, tokens: coveredBy(low, top) }).toEqual({
      x: base.x,
      h: 400,
      tokens: 0,
    });
  });

  test("FR-SHELL-40 placement ties → today's order: default column, nearest", () => {
    // Tokens no candidate covers (mid-map): every candidate scores 0.
    const midMap = [{ x: 700, y: 300, w: 70, h: 70 }];
    expect(placeRect(init, vp, [leftLog], midMap)).toEqual(fittedDefaultRect(init, vp));
    // Free at full size at both edges: the default column wins.
    expect(placeRect(init, vp, [], midMap).x).toBe(fittedDefaultRect(init, vp).x);
  });

  test("FR-SHELL-40 toast keep-out: a candidate over the box drops out while a clear one exists; none clear → least overlap", () => {
    const corner = def({
      defaultPosition: { anchor: "bottom-right" },
      defaultSize: { w: 300, h: 300 },
    });
    const box = { x: vp.w - 16 - 356, y: vp.h - 72 - 304, w: 356, h: 304 };
    const base = fittedDefaultRect(corner, vp);
    expect(overlaps(base, box)).toBe(true);
    const r = placeRect(corner, vp, [], [], box);
    expect(overlaps(r, box)).toBe(false);
    expect(r.x).toBe(base.x); // still its default column, above the box
    // Token cover comes first: tokens everywhere but the box → the default rect, over it.
    const elsewhere = [
      { x: 0, y: 0, w: box.x, h: vp.h },
      { x: box.x, y: 0, w: vp.w - box.x, h: box.y },
    ];
    expect(placeRect(corner, vp, [], elsewhere, box)).toEqual(base);
    // The box over the whole screen: every candidate overlaps it → least overlap, then today's
    // order (the default rect).
    expect(placeRect(corner, vp, [], [], { x: 0, y: 0, w: vp.w, h: vp.h })).toEqual(base);
    // No window-free candidate: covering less of other windows beats staying off the box
    // (toasts are transient; a feature never opens a window over another, G35).
    const tall = def({
      defaultPosition: { anchor: "bottom-right" },
      defaultSize: { w: 300, h: 700 },
      minSize: { w: 200, h: 700 },
    });
    const a2 = usableArea(vp);
    const leftWin = { x: 0, y: 0, w: 400, h: vp.h };
    const rightWin = { x: a2.right - 300, y: a2.top, w: 300, h: 100 };
    const onRight = { x: a2.right - 356, y: a2.top + 200, w: 356, h: 200 };
    const r2 = placeRect(tall, vp, [leftWin, rightWin], [], onRight);
    expect(r2.x).toBe(a2.right - 300); // the right edge: least window overlap, over the box
    expect(overlaps(r2, onRight)).toBe(true);
    // Over the right half only: the left edge, which overlaps it least (not at all).
    const right = { x: 800, y: 0, w: 800, h: vp.h };
    expect(placeRect(corner, vp, [], [], right).x).toBe(RAIL_CLEAR);
  });
});
