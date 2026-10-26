import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import {
  contentHeights,
  FREE_AREAS_MAX,
  fitObstacles,
  freeArea,
  freeAreas,
  isAppearance,
  noteAppearance,
  notedAppearances,
  railArea,
  renderedWindowRects,
  reportContentHeight,
} from "./free-area";
import type { Rect } from "./geometry";
import { keepOuts } from "./keep-outs";
import { createWindowRegistry, defineWindow } from "./registry";
import { reportShownStack, summaryStrip, toastKeepOut } from "./toast-region";

const VP = { w: 1440, h: 900 };
/** Work area right of the rail at 1440×900: x 68…1440, y 48…888. */
const RAIL = { x: 68, y: 48, w: 1372, h: 840 };

describe("FR-SHELL-34 free area", () => {
  test("FR-SHELL-34 no windows → the work area right of the rail", () => {
    expect(railArea(VP)).toEqual(RAIL);
    expect(freeArea([], VP)).toEqual(RAIL);
  });

  test("FR-SHELL-34 largest rect beside a right-edge window", () => {
    const init = { x: 1028, y: 60, w: 400, h: 500 };
    expect(freeArea([init], VP)).toEqual({ x: 68, y: 48, w: 960, h: 840 });
  });

  test("FR-SHELL-34 DM default layout at 1440×900: left of Initiative, above the log", () => {
    const init = { x: 1028, y: 60, w: 400, h: 500 };
    const log = { x: 68, y: 584, w: 460, h: 240 };
    expect(freeArea([init, log], VP)).toEqual({ x: 68, y: 48, w: 960, h: 536 });
  });

  test("FR-SHELL-34 overlapping windows count once", () => {
    const a = { x: 900, y: 60, w: 400, h: 400 };
    const b = { x: 1000, y: 100, w: 440, h: 400 };
    expect(freeArea([a, b], VP)).toEqual({ x: 68, y: 48, w: 832, h: 840 });
  });

  test("FR-SHELL-34 the rail strip is excluded; a window over it doesn't count there", () => {
    const left = { x: 0, y: 48, w: 200, h: 840 };
    expect(freeArea([left], VP)).toEqual({ x: 200, y: 48, w: 1240, h: 840 });
  });

  test("FR-SHELL-34 tie → the higher, then the more left one", () => {
    // A full-width band across the middle: equal halves above and below → the upper one.
    const band = { x: 0, y: 444, w: 1440, h: 48 };
    expect(freeArea([band], VP)).toEqual({ x: 68, y: 48, w: 1372, h: 396 });
    // A full-height column in the middle: equal halves left and right → the left one.
    const col = { x: 704, y: 0, w: 100, h: 900 };
    expect(freeArea([col], { w: 1440, h: 900 })).toEqual({ x: 68, y: 48, w: 636, h: 840 });
  });

  test("FR-SHELL-34 window wider than the area → the larger strip it leaves", () => {
    const wide = { x: -100, y: 336, w: 2000, h: 300 };
    expect(freeArea([wide], VP)).toEqual({ x: 68, y: 48, w: 1372, h: 288 });
  });

  test("FR-SHELL-34 < 320×240 or < 25 % of the work area → the work area right of the rail", () => {
    // Only a 1372 × 200 strip is left: too low.
    const big = { x: 0, y: 248, w: 1440, h: 700 };
    expect(freeArea([big], VP)).toEqual(RAIL);
    // 600 × 400 is ≥ 320×240 but < 25 % of 1440 × 840.
    const frame = [
      { x: 0, y: 48, w: 1440, h: 200 },
      { x: 0, y: 648, w: 1440, h: 200 },
      { x: 668, y: 0, w: 800, h: 900 },
    ];
    expect(freeArea(frame, VP)).toEqual(RAIL);
  });
});

describe("FR-SHELL-44 freeAreas", () => {
  const init = { x: 1028, y: 60, w: 400, h: 500 };
  const log = { x: 68, y: 584, w: 460, h: 240 };
  const contains = (a: Rect, b: Rect) =>
    a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  test("FR-SHELL-44 freeAreas: every maximal free rectangle ≥ 320×240, largest first", () => {
    expect(freeAreas([], VP)).toEqual([RAIL]);
    // Left of Initiative (full height) and below it (full width); the 12 px above it is too low.
    expect(freeAreas([init], VP)).toEqual([
      { x: 68, y: 48, w: 960, h: 840 },
      { x: 68, y: 560, w: 1372, h: 328 },
    ]);
    const areas = freeAreas([init, log], VP);
    expect(areas[0]).toEqual({ x: 68, y: 48, w: 960, h: 536 });
    expect(areas).toContainEqual({ x: 528, y: 48, w: 500, h: 840 }); // between log and Initiative
    expect(areas).toContainEqual({ x: 528, y: 560, w: 912, h: 328 }); // right of the log
    for (const [i, a] of areas.entries()) {
      expect(a.w >= 320 && a.h >= 240).toBe(true);
      expect(overlaps(a, init) || overlaps(a, log)).toBe(false);
      expect(contains(RAIL, a)).toBe(true);
      // Maximal: no other candidate contains it; sorted by area.
      for (const b of areas) if (b !== a) expect(contains(b, a)).toBe(false);
      const prev = areas[i - 1];
      if (prev) expect(prev.w * prev.h).toBeGreaterThanOrEqual(a.w * a.h);
    }
  });

  test("FR-SHELL-44 freeAreas: at most 16, ties → the higher, then the more left one", () => {
    // A staggered grid of small windows leaves more than 16 maximal rectangles: the 16 largest.
    const dots: Rect[] = [];
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 4; j++)
        dots.push({ x: 68 + 330 * i + (j % 2) * 165, y: 48 + 250 * j, w: 10, h: 10 });
    const many = freeAreas(dots, VP);
    expect(many.length).toBe(FREE_AREAS_MAX);
    const sizes = many.map((r) => r.w * r.h);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    const band = { x: 0, y: 444, w: 1440, h: 48 };
    expect(freeAreas([band], VP)).toEqual([
      { x: 68, y: 48, w: 1372, h: 396 },
      { x: 68, y: 492, w: 1372, h: 396 },
    ]);
  });

  test("FR-SHELL-44 freeArea (FR-SHELL-34) is the first of them, or its fallback", () => {
    const cases: Rect[][] = [
      [],
      [init],
      [init, log],
      [{ x: 0, y: 48, w: 200, h: 840 }],
      [{ x: 0, y: 444, w: 1440, h: 48 }],
      [{ x: -100, y: 336, w: 2000, h: 300 }],
      [{ x: 0, y: 248, w: 1440, h: 700 }],
    ];
    let fellBack = 0;
    for (const rects of cases) {
      const area = freeArea(rects, VP);
      const first = freeAreas(rects, VP)[0];
      // The fallback (too small a free area → the whole area right of the rail) is freeArea's own.
      if (rects.length > 0 && JSON.stringify(area) === JSON.stringify(RAIL)) {
        fellBack += 1;
        continue;
      }
      expect(first).toEqual(area);
    }
    expect(fellBack).toBe(1);
  });
});

const Body = () => null;
const registry = createWindowRegistry("player", [
  defineWindow({
    kind: "char.sheet",
    title: "Sheet",
    clients: ["player"],
    defaultSize: { w: 320, h: 440 },
    minSize: { w: 280, h: 320 },
    defaultPosition: { anchor: "top-right" },
    component: Body,
  }),
  defineWindow({
    kind: "cbt.initiative",
    title: "Initiative",
    clients: ["player"],
    defaultSize: { w: 280, h: 400 },
    minSize: { w: 240, h: 200 },
    defaultPosition: { anchor: "bottom-right" },
    available: (s) => s.records.encounter !== undefined,
    component: Body,
  }),
  defineWindow({
    kind: "note.history",
    title: "Notifications",
    clients: ["player"],
    defaultSize: { w: 360, h: 300 },
    minSize: { w: 280, h: 240 },
    defaultPosition: { anchor: "bottom-right" },
    component: Body,
  }),
]);

const win = (kind: string, state: WindowState["state"], x: number, z: number): WindowState => ({
  kind,
  instance: "main",
  state,
  x,
  y: 60,
  w: 300,
  h: 300,
  z,
});

describe("FR-SHELL-34 rendered windows", () => {
  test("FR-SHELL-34 minimised, closed and unavailable windows don't cover", () => {
    const ws = [
      win("char.sheet", "minimised", 100, 1),
      win("note.history", "closed", 500, 2),
      win("cbt.initiative", "open", 900, 3),
    ];
    const none = new Set(["char.sheet", "note.history"]);
    expect(renderedWindowRects(ws, registry, none, VP)).toEqual([]);
    expect(freeArea(renderedWindowRects(ws, registry, none, VP), VP)).toEqual(RAIL);
    const all = new Set([...none, "cbt.initiative"]);
    expect(renderedWindowRects(ws, registry, all, VP)).toEqual([{ x: 900, y: 60, w: 300, h: 300 }]);
  });
});

describe("FR-SHELL-39 rendered rects use the measured grown height", () => {
  const growing = createWindowRegistry("dm", [
    defineWindow({
      kind: "cbt.initiative",
      title: "Initiative",
      clients: ["dm"],
      defaultSize: { w: 400, h: 300 },
      minSize: { w: 320, h: 240 },
      defaultPosition: { anchor: "top-right" },
      growToContent: true,
      component: Body,
    }),
  ]);
  const init = { ...win("cbt.initiative", "open", 1028, 1), w: 400 };
  const all = new Set(["cbt.initiative"]);

  test("FR-SHELL-39 grown height (not the stored h) reaches renderedWindowRects and freeArea", () => {
    const stored = renderedWindowRects([init], growing, all, VP, new Map());
    expect(stored).toEqual([{ x: 1028, y: 60, w: 400, h: 300 }]);
    const measured = new Map([["cbt.initiative:main", 620]]);
    const grown = renderedWindowRects([init], growing, all, VP, measured);
    expect(grown).toEqual([{ x: 1028, y: 60, w: 400, h: 620 }]);
    // A full-width window: the free area below it shrinks as it grows.
    const wide = { ...init, x: 68, w: 1372 };
    const at = (m: Map<string, number>) =>
      freeArea(renderedWindowRects([wide], growing, all, VP, m), VP);
    expect(at(new Map())).toEqual({ x: 68, y: 360, w: 1372, h: 528 });
    expect(at(new Map([["cbt.initiative:main", 500]]))).toEqual({ x: 68, y: 560, w: 1372, h: 328 });
  });

  test("FR-SHELL-39 the reported heights are what consumers read by default", () => {
    reportContentHeight("cbt.initiative:main", 500);
    expect(contentHeights().get("cbt.initiative:main")).toBe(500);
    expect(renderedWindowRects([init], growing, all, VP)[0]?.h).toBe(500);
    // After a user resize (`fixedH`) the stored height wins.
    expect(renderedWindowRects([{ ...init, fixedH: true }], growing, all, VP)[0]?.h).toBe(300);
    reportContentHeight("cbt.initiative:main", null);
    expect(renderedWindowRects([init], growing, all, VP)[0]?.h).toBe(300);
  });
});

describe("FR-SHELL-34 appearances", () => {
  const key = "pp.layout.v1.c1.player.p1";
  const before = { key, kinds: new Set(["char.sheet", "note.history"]) };
  const withInit = { key, kinds: new Set([...before.kinds, "cbt.initiative"]) };
  const open = [win("char.sheet", "open", 100, 1), win("cbt.initiative", "open", 900, 2)];

  test("FR-SHELL-34 an open window whose kind becomes available is one appearance", () => {
    expect(isAppearance(before, withInit, open)).toBe(true);
  });

  test("FR-SHELL-34 a minimised window becoming available is not (nothing rendered)", () => {
    const ws = [win("cbt.initiative", "minimised", 900, 1)];
    expect(isAppearance(before, withInit, ws)).toBe(false);
  });

  test("FR-SHELL-34 two kinds first available in one reconnect snapshot count once", () => {
    const prev = { key, kinds: new Set(["char.sheet"]) };
    const ws = [...open, win("note.history", "open", 500, 3)];
    // One store change (the snapshot) → one boolean → one appearance.
    expect(isAppearance(prev, withInit, ws)).toBe(true);
  });

  test("FR-SHELL-34 a snapshot with no newly available kind doesn't count", () => {
    expect(isAppearance(withInit, { key, kinds: new Set(withInit.kinds) }, open)).toBe(false);
    expect(isAppearance(withInit, before, open)).toBe(false); // End: kind goes away
  });

  test("FR-SHELL-34 user open / restore doesn't count (availability unchanged)", () => {
    const after = [...open, win("note.history", "open", 500, 3)];
    expect(isAppearance(withInit, withInit, after)).toBe(false);
  });

  test("FR-SHELL-34 a layout restore (first snapshot, campaign switch) doesn't count", () => {
    expect(isAppearance(null, withInit, open)).toBe(false);
    expect(isAppearance({ key: null, kinds: new Set() }, withInit, open)).toBe(false);
    const other = { key: "pp.layout.v1.c2.player.p1", kinds: new Set<string>() };
    expect(isAppearance(other, withInit, open)).toBe(false);
  });

  test("FR-SHELL-34 noteAppearance() counts one per call", () => {
    const n = notedAppearances();
    noteAppearance();
    noteAppearance();
    expect(notedAppearances()).toBe(n + 2);
  });
});

describe("FR-SHELL-59 fit obstacles", () => {
  test("FR-SHELL-59 shown stack rect: fitObstacles('dm') takes the summary strip + the shown stack, not the 356 × 238 box; players keep their corner box", () => {
    const win = { x: 1028, y: 60, w: 400, h: 500 };
    const regions = keepOuts("dm", VP, new Map());
    const strip = summaryStrip(VP);
    expect(fitObstacles("dm", [win], regions, VP, null)).toEqual([win, strip]);
    const card = { x: 560, y: 165, w: 320, h: 175 };
    expect(fitObstacles("dm", [win], regions, VP, card)).toEqual([win, strip, card]);
    expect(fitObstacles("dm", [win], regions, VP, card)).not.toContainEqual(toastKeepOut("dm", VP));
    // The reported stack is read when none is passed.
    reportShownStack("test.stack", card);
    try {
      expect(fitObstacles("dm", [], regions, VP)).toEqual([strip, card]);
      // Players: their hard corner box, never the DM's stack.
      const player = keepOuts("player", VP, new Map());
      expect(fitObstacles("player", [win], player, VP)).toEqual([win, toastKeepOut("player", VP)]);
    } finally {
      reportShownStack("test.stack", null);
    }
    expect(fitObstacles("dm", [], regions, VP)).toEqual([strip]);
  });
});
