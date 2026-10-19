import { describe, expect, test } from "bun:test";
import {
  clampRect,
  defaultRect,
  EDGE_GAP,
  fitRect,
  grownRect,
  growsToContent,
  LAUNCHER_CLEAR,
  MIN_VISIBLE_W,
  moveRect,
  type Rect,
  renderedRect,
  resizeRect,
  TITLE_H,
  TOP_BAR_H,
  windowRect,
  workArea,
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

  describe("FR-SHELL-29 fit", () => {
    const big = { w: 1440, h: 900 };
    const small = { w: 1280, h: 720 };
    const area = workArea(big);
    const min = { w: 200, h: 150 };
    const render = (r: Rect, vp: { w: number; h: number }) => renderedRect({ ...r, area }, min, vp);
    const inWorkArea = (r: Rect, vp: { w: number; h: number }) =>
      r.x >= 0 && r.x + r.w <= vp.w && r.y >= TOP_BAR_H && r.y + r.h <= TOP_BAR_H + workArea(vp).h;

    test("work area = viewport below the top bar, above the launcher", () => {
      expect(workArea(big)).toEqual({ w: 1440, h: 900 - TOP_BAR_H - LAUNCHER_CLEAR });
    });

    test("1440×900 → 1280×720: right-edge window keeps its gap, ends above the launcher", () => {
      // shell.test's default (bottom-right, 320×220): 12 px from the right and the launcher.
      const r = defaultRect({ anchor: "bottom-right" }, { w: 320, h: 220 }, big);
      const out = render(r, small);
      expect(out).toEqual({
        x: 1280 - EDGE_GAP - 320,
        y: 720 - LAUNCHER_CLEAR - EDGE_GAP - 220,
        w: 320,
        h: 220,
      });
      expect(inWorkArea(out, small)).toBe(true);
    });

    test("1440×900 → 1280×720: a mid window moves only as far as needed", () => {
      expect(render({ x: 900, y: 400, w: 400, h: 300 }, small)).toEqual({
        x: 1280 - 400,
        y: TOP_BAR_H + workArea(small).h - 300,
        w: 400,
        h: 300,
      });
      // Fits already: unchanged.
      const fits = { x: 300, y: 200, w: 400, h: 300 };
      expect(render(fits, small)).toEqual(fits);
    });

    test("1440×900 → 1280×720: then shrinks, never below min size", () => {
      const tall = { x: 12, y: TOP_BAR_H + 12, w: 400, h: 700 };
      const out = render(tall, small);
      expect(out).toMatchObject({ y: TOP_BAR_H, h: workArea(small).h });
      expect(inWorkArea(out, small)).toBe(true);
      // Min size larger than the work area: fit stops at min, the clamp does the rest.
      const fitted = fitRect(tall, area, { w: 200, h: 700 }, small);
      expect(fitted.h).toBe(700);
    });

    test("parked window (stored partly outside) and no `area`: clamp only", () => {
      const parked = { x: 1300, y: 300, w: 400, h: 300 };
      expect(render(parked, small)).toEqual(clampRect(parked, small));
      const old = { x: 900, y: 400, w: 400, h: 300 };
      expect(renderedRect(old, min, small)).toEqual(clampRect(old, small));
    });

    test("render-only: back at the stored work area the window is at its stored geometry", () => {
      const r = { x: 900, y: 400, w: 400, h: 300 };
      render(r, small);
      expect(render(r, big)).toEqual(r);
      // A larger work area than the stored one changes nothing either.
      expect(render(r, { w: 1920, h: 1080 })).toEqual(r);
    });

    test("per axis: only the width smaller → only x / w change", () => {
      const r = { x: 900, y: 600, w: 400, h: 200 };
      expect(render(r, { w: 1280, h: 900 })).toEqual({ x: 880, y: 600, w: 400, h: 200 });
      expect(render(r, { w: 1440, h: 720 })).toMatchObject({ x: 900, w: 400 });
    });
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

describe("FR-SHELL-39 grow to content", () => {
  const grow = {
    minSize: { w: 320, h: 240 },
    defaultPosition: { anchor: "top-right" as const },
    growToContent: true as const,
  };
  const win = { x: 1188, y: 60, w: 400, h: 300 };
  /** Window height for `rows` rows of 36 px under a 34 px title bar + borders and 24 px padding. */
  const rows = (n: number) => 34 + 24 + 36 * n;
  // FR-SHELL-52: 12 px above the work area's bottom (the usable area), 824 at 1600×900.
  const waBottom = TOP_BAR_H + workArea(vp).h - EDGE_GAP;

  test("FR-SHELL-39 content 6 → 9 rows: rendered height grows, render-only", () => {
    expect(windowRect(win, grow, vp, rows(6))).toEqual(win); // 274 < stored 300: stored wins
    expect(windowRect(win, grow, vp, rows(9))).toEqual({ ...win, h: rows(9) });
    expect(win.h).toBe(300); // nothing written
  });

  test("FR-SHELL-39 FR-SHELL-52 capped 12 px above the work-area bottom (then the body scrolls)", () => {
    expect(windowRect(win, grow, vp, rows(40))).toEqual({ ...win, h: waBottom - win.y });
    // Already past the cap (a user-placed window): never shorter than its rendered rect.
    const low = { ...win, y: 700 };
    expect(windowRect(low, grow, vp, rows(40))).toEqual(low);
  });

  test("FR-SHELL-39 a bottom-anchored type keeps its bottom and grows up, to 12 px below the top bar", () => {
    const up = { ...grow, defaultPosition: { anchor: "bottom-right" as const } };
    const w = { x: 1188, y: 500, w: 280, h: 300 };
    expect(windowRect(w, up, vp, 400)).toEqual({ ...w, y: 400, h: 400 });
    const top = TOP_BAR_H + EDGE_GAP;
    expect(windowRect(w, up, vp, 2000)).toEqual({ ...w, y: top, h: 800 - top });
  });

  test("FR-SHELL-39 no growth after a user resize (`fixedH`), without opt-in, or unmeasured", () => {
    expect(windowRect({ ...win, fixedH: true }, grow, vp, rows(9))).toEqual(win);
    expect(windowRect(win, { ...grow, growToContent: undefined }, vp, rows(9))).toEqual(win);
    expect(windowRect(win, grow, vp, undefined)).toEqual(win);
    expect(growsToContent({}, grow)).toBe(true);
    expect(growsToContent({ fixedH: true }, grow)).toBe(false);
  });

  test("FR-SHELL-39 growth applies after the FR-SHELL-29 fit", () => {
    const small = { w: 1280, h: 720 };
    const stored = { ...win, x: 868, area: workArea(vp) };
    const fitted = renderedRect(stored, grow.minSize, small);
    expect(grownRect(fitted, rows(9), false, small)).toEqual(
      windowRect(stored, grow, small, rows(9)),
    );
    expect(windowRect(stored, grow, small, rows(40)).h).toBe(
      TOP_BAR_H + workArea(small).h - EDGE_GAP - fitted.y,
    );
  });

  test("FR-SHELL-52 growth cap: stops 12 px above the first window or hard keep-out below whose x-range overlaps it", () => {
    const log = { x: 68, y: 584, w: 1150, h: 240 };
    const init = { x: 1028, y: 60, w: 400, h: 500 };
    expect(windowRect(init, grow, { w: 1440, h: 900 }, 900, [log]).h).toBe(572 - 60);
    // Not across: the work area (12 px above the launcher strip).
    const aside = { x: 68, y: 484, w: 690, h: 160 };
    const init720 = { x: 868, y: 60, w: 400, h: 500 };
    expect(windowRect(init720, grow, { w: 1280, h: 720 }, 900, [aside]).h).toBe(644 - 60);
    // Already past a window below: never shorter than its rendered rect.
    expect(windowRect(init, grow, { w: 1440, h: 900 }, 900, [{ ...log, y: 300 }]).h).toBe(500);
  });
});
