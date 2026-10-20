import { expect, test } from "bun:test";
import { fitObstacles, freeAreas, renderedWindowRects } from "@ui/features/play-shell/free-area";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";
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
import { playerWindows } from "../../windows";

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
 * `session-sim-8` Goblin Ambush as a player holds it (SHELL §13 sprint 5 token cells, the hidden
 * Wolf and Elite dropped): Mira, Thorn, Brakka; Goblin, Goblin 2; the art tokens on rows 1–3;
 * Goblin Lurker; Crypt Ogre 2 × 2.
 */
const SIM8_AMBUSH_PLAYER: FitToken[] = [
  tok(2, 7, true),
  tok(2, 9, true),
  tok(3, 8, true),
  tok(12, 6),
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

test("FR-MAP-59 every token visible: player sheet + Game log, then + Initiative → all at 1280×720, 1280×800, 1440×900, 1600×900 (play-shell §12)", () => {
  const footprints = SIM8_AMBUSH_PLAYER.flatMap((t) => footprintBox([t], GRID) ?? []);
  const cells: string[] = [];
  for (const vp of SIZES) {
    const all = new Set(playerWindows.defs.map((d) => d.kind));
    const before = new Set([...all].filter((k) => k !== "cbt.initiative"));
    const layout = defaultLayout(playerWindows, vp);
    // Start: Initiative becomes available and appears (FR-SHELL-18), then the map refits.
    const ctx = { registry: playerWindows, viewport: vp, available: all };
    const appeared = reduce(layout, { type: "appear", kind: "cbt.initiative" }, ctx);
    for (const [when, ws, available] of [
      ["sheet + log", layout, before],
      ["+ Initiative", appeared, all],
    ] as const) {
      const at = `${vp.w}×${vp.h} ${when}`;
      const windows = renderedWindowRects(ws, playerWindows, available, vp);
      expect(windows.length).toBe(when === "sheet + log" ? 2 : 3);
      const obstacles = fitObstacles("player", windows, keepOuts("player", vp), vp);
      // The players' bottom-right toast box is an obstacle (FR-SHELL-48 (a)).
      expect(obstacles).toContainEqual(toastKeepOut("player", vp));
      const windowsOnly = freeAreas(windows, vp);
      const room = { areas: freeAreas(obstacles, vp), obstacles, windowsOnly };
      const fit = fitScene(SIM8_AMBUSH_PLAYER, GRID, MAP, vp, room);
      const cell = fit.scale * GRID.gridCellSize;
      cells.push(`${at}: ${cell.toFixed(1)} px`);
      expect({ at, visible: fit.visible }).toEqual({ at, visible: "all" });
      expect(allClear(fit, footprints, obstacles, visibleArea(vp))).toBe(true);
      expect(cell).toBeGreaterThanOrEqual(FIT_HARD_MIN_CELL_PX);
      // FR-MAP-44: the map's top row stays at or below the top bar.
      expect(fit.y).toBeGreaterThanOrEqual(TOP_BAR_H - 1e-6);
    }
  }
  console.info(`FR-MAP-59 player cells: ${cells.join("; ")}`);
});
