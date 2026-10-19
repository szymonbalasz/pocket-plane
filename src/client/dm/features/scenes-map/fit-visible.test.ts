import { expect, mock, test } from "bun:test";
import {
  fitObstacles,
  freeArea,
  freeAreas,
  renderedWindowRects,
} from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { toastKeepOut } from "@ui/features/play-shell/toast-region";
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

/** The DM default layout (Game log + Initiative), optionally Scenes opened from the launcher. */
function dmFit(vp: { w: number; h: number }, scenes: boolean) {
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
  const obstacles = fitObstacles(windows, keepOuts("dm", vp));
  const windowsOnly = { areas: freeAreas(windows, vp), area: freeArea(windows, vp) };
  const room = { areas: freeAreas(obstacles, vp), obstacles, windowsOnly };
  return { windows, obstacles, fit: fitScene(SIM8_AMBUSH_DM, GRID, MAP, vp, room) };
}

const footprints = (tokens: readonly FitToken[]) =>
  tokens.flatMap((t) => footprintBox([t], GRID) ?? []);

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("FR-MAP-59 every token visible: DM Game log + Initiative → all at 1280×800, 1440×900, 1600×900, pcs at 1280×720; + Scenes → all at 1280×800 only (play-shell §12, OQ-SHELL-40)", () => {
  const want = {
    plain: ["pcs", "all", "all", "all"],
    scenes: ["pcs", "all", "pcs", "pcs"],
  };
  const cells: string[] = [];
  for (const [i, vp] of SIZES.entries()) {
    for (const scenes of [false, true]) {
      const at = `${vp.w}×${vp.h}${scenes ? " + Scenes" : ""}`;
      const { windows, obstacles, fit } = dmFit(vp, scenes);
      // The DM's top-centre toast box is an obstacle (#256).
      expect(obstacles).toContainEqual(toastKeepOut("dm", vp));
      const cell = fit.scale * GRID.gridCellSize;
      cells.push(`${at}: ${fit.visible} ${cell.toFixed(1)} px`);
      expect({ at, visible: fit.visible }).toEqual({
        at,
        visible: (scenes ? want.scenes : want.plain)[i] as "all" | "pcs",
      });
      if (fit.visible === "all") {
        // Every footprint (hidden ones too) inside the inset work area, clear of every window
        // and the toast box; an integer cell ≥ 24 px.
        expect(allClear(fit, footprints(SIM8_AMBUSH_DM), obstacles, visibleArea(vp))).toBe(true);
        expect(cell).toBeGreaterThanOrEqual(FIT_HARD_MIN_CELL_PX);
        expect(Math.abs(cell - Math.round(cell))).toBeLessThan(1e-9);
      } else {
        // PCs first (FR-MAP-46): every PC clear of every window.
        for (const p of footprints(SIM8_AMBUSH_DM.filter((t) => t.pc))) {
          const s = {
            x: fit.x + p.x * fit.scale,
            y: fit.y + p.y * fit.scale,
            w: p.w * fit.scale,
            h: p.h * fit.scale,
          };
          const under = windows.some((w) => overlaps(s, w));
          expect(under ? `${at}: a PC under a window` : "ok").toBe("ok");
        }
      }
    }
  }
  console.info(`FR-MAP-59 DM cells: ${cells.join("; ")}`);
});
