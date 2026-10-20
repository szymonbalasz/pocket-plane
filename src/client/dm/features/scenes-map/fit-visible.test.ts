import { expect, mock, test } from "bun:test";
import { fitObstacles, freeAreas, renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { summaryStrip, toastKeepOut } from "@ui/features/play-shell/toast-region";
import {
  allClear,
  FIT_HARD_MIN_CELL_PX,
  type FitToken,
  fitScene,
  footprintBox,
  visibleArea,
} from "@ui/features/scenes-map/camera";

// The players panel pulls in the DM session (localStorage, window.location at import); no DOM
// in bun test, and the shell only needs the window definition here.
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

/** The `battlemap` fixture (Goblin Ambush): 20 × 14 cells at 70 px. */
const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const MAP = { w: 1400, h: 980 };
const tok = (col: number, row: number, pc = false, size: FitToken["size"] = "medium") => ({
  col,
  row,
  size,
  pc,
});

/**
 * `session-sim-8` Goblin Ambush as the DM holds it (SHELL §13 sprint 5 token cells): Mira, Thorn,
 * Brakka; Goblin, Wolf (hidden), Elite (hidden), Goblin 2; the art tokens on rows 1–3 (Dragon
 * 3 × 3, Goblin 3, two Goblins, Wolf 2, Plain Brute, Ogre 2 × 2); Goblin Lurker; Crypt Ogre 2 × 2.
 */
const SIM8_AMBUSH_DM: FitToken[] = [
  tok(2, 7, true),
  tok(2, 9, true),
  tok(3, 8, true),
  tok(12, 6),
  tok(14, 4),
  tok(15, 8),
  tok(12, 8),
  tok(4, 1, false, "huge"),
  tok(8, 2),
  tok(9, 2),
  tok(10, 2),
  tok(12, 2),
  tok(14, 2),
  tok(17, 1, false, "large"),
  tok(17, 11),
  tok(18, 6, false, "large"),
];

const SIZES = [
  { w: 1280, h: 720 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
];

/**
 * The DM default layout (Game log + Initiative), optionally Scenes opened from the launcher;
 * `shown` = the shown stack at fit time (FR-SHELL-59; null = nothing shows).
 */
function dmFit(vp: { w: number; h: number }, scenes: boolean, shown: Rect | null = null) {
  const all = new Set(dmWindows.defs.map((d) => d.kind));
  let ws = defaultLayout(dmWindows, vp);
  if (scenes) {
    const ctx = { registry: dmWindows, viewport: vp, available: all };
    ws = [...reduce(ws, { type: "open", kind: "map.scenes" }, ctx)];
  }
  const open = ws.filter((w) => w.state === "open").map((w) => w.kind);
  expect(open.sort()).toEqual(
    ["cbt.initiative", "dice.log", ...(scenes ? ["map.scenes"] : [])].sort(),
  );
  const windows = renderedWindowRects(ws, dmWindows, all, vp);
  const obstacles = fitObstacles("dm", windows, keepOuts("dm", vp), vp, shown);
  const room = { areas: freeAreas(obstacles, vp), obstacles, windowsOnly: freeAreas(windows, vp) };
  return { windows, obstacles, fit: fitScene(SIM8_AMBUSH_DM, GRID, MAP, vp, room) };
}

const footprints = (tokens: readonly FitToken[]) =>
  tokens.flatMap((t) => footprintBox([t], GRID) ?? []);

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every footprint at `fit` (screen px). */
const onScreen = (fit: { x: number; y: number; scale: number }, tokens: readonly FitToken[]) =>
  footprints(tokens).map((p) => ({
    x: fit.x + p.x * fit.scale,
    y: fit.y + p.y * fit.scale,
    w: p.w * fit.scale,
    h: p.h * fit.scale,
  }));

/** Sprint-6 named outcomes (scenes-map §12, OQ-MAP-57 D, #288): cell px per size. */
const D_CELLS = { plain: [36, 37, 42, 42], scenes: [30, 30, 38, 42] };

test("FR-MAP-59 every token visible: DM Game log + Initiative → all at 36 / 37 / 42 / 42 px; + Scenes → all at 30 / 30 / 38 / 42 px (sprint 6: the summary strip, not the box, FR-MAP-80; was pcs at 1280×720 / + Scenes, OQ-SHELL-40)", () => {
  const cells: string[] = [];
  for (const [i, vp] of SIZES.entries()) {
    for (const scenes of [false, true]) {
      const at = `${vp.w}×${vp.h}${scenes ? " + Scenes" : ""}`;
      const { windows, obstacles, fit } = dmFit(vp, scenes);
      const cell = fit.scale * GRID.gridCellSize;
      cells.push(`${at}: ${fit.visible} ${cell.toFixed(1)} px`);
      expect({ at, visible: fit.visible, cell: Math.round(cell) }).toEqual({
        at,
        visible: "all",
        cell: (scenes ? D_CELLS.scenes : D_CELLS.plain)[i] as number,
      });
      // Every footprint (hidden ones too) inside the inset work area, clear of every window and
      // the summary strip; an integer cell ≥ 24 px.
      expect(allClear(fit, footprints(SIM8_AMBUSH_DM), obstacles, visibleArea(vp))).toBe(true);
      expect(cell).toBeGreaterThanOrEqual(FIT_HARD_MIN_CELL_PX);
      // FR-MAP-44: the map's top row stays at or below the top bar.
      expect(fit.y).toBeGreaterThanOrEqual(TOP_BAR_H - 1e-6);
      expect(Math.abs(cell - Math.round(cell))).toBeLessThan(1e-9);
      for (const s of onScreen(fit, SIM8_AMBUSH_DM)) {
        const under = windows.some((w) => overlaps(s, w));
        expect(under ? `${at}: a token under a window` : "ok").toBe("ok");
      }
    }
  }
  console.info(`FR-MAP-59 DM cells: ${cells.join("; ")}`);
});

test("FR-MAP-80 fit without the empty box: nothing shown → obstacles = windows + the summary strip (not the 356 × 238 box), all at §12's cells, no footprint under the strip; a shown card below the strip → every footprint clear of it", () => {
  for (const [i, vp] of SIZES.entries()) {
    for (const scenes of [false, true]) {
      const at = `${vp.w}×${vp.h}${scenes ? " + Scenes" : ""}`;
      const { windows, obstacles, fit } = dmFit(vp, scenes);
      const strip = summaryStrip(vp);
      expect(strip).toEqual({ x: Math.round((vp.w - 320) / 2), y: 100, w: 320, h: 57 });
      expect(obstacles).toEqual([...windows, strip]);
      expect(obstacles).not.toContainEqual(toastKeepOut("dm", vp));
      expect({ at, visible: fit.visible }).toEqual({ at, visible: "all" });
      const want = (scenes ? D_CELLS.scenes : D_CELLS.plain)[i] as number;
      expect({ at, cell: Math.round(fit.scale * GRID.gridCellSize) }).toEqual({ at, cell: want });
      const under = onScreen(fit, SIM8_AMBUSH_DM).filter((s) => overlaps(s, strip)).length;
      expect({ at, under }).toEqual({ at, under: 0 });
    }
  }
  // A sticky card showing below the strip (320 × 175 at 1440×900): the shown stack is an
  // obstacle too; every footprint clear of it and of the strip.
  const vp = { w: 1440, h: 900 };
  const card = { x: 560, y: 165, w: 320, h: 175 };
  const { obstacles, fit } = dmFit(vp, false, card);
  expect(obstacles).toContainEqual(card);
  expect(fit.visible).toBe("all");
  for (const s of onScreen(fit, SIM8_AMBUSH_DM)) {
    expect(overlaps(s, card)).toBe(false);
    expect(overlaps(s, summaryStrip(vp))).toBe(false);
  }
  expect(allClear(fit, footprints(SIM8_AMBUSH_DM), obstacles, visibleArea(vp))).toBe(true);
  console.info(
    `FR-MAP-80 with a card at 1440×900: ${(fit.scale * GRID.gridCellSize).toFixed(1)} px`,
  );
});
