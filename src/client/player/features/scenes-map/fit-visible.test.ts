import { expect, test } from "bun:test";
import { fitObstacles, freeAreas, renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import { TOP_BAR_H } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import {
  AMBUSH_GRID,
  AMBUSH_MAP,
  type AmbushToken,
  SIM9_AMBUSH_PLAYER,
} from "@ui/features/play-shell/test-cells";
import { toastKeepOut } from "@ui/features/play-shell/toast-region";
import {
  allClear,
  FIT_HARD_MIN_CELL_PX,
  type FitToken,
  fitScene,
  footprintBox,
  revealRefit,
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

/**
 * Sim-9 r02 → r05 as player 2 holds it (the running fight: sheet + Game log + Initiative): at the
 * Show the PCs and Goblin 2; through the door and party vision 7 more come into sight (Goblin,
 * the art tokens on rows 1–2, Wolf 2, Plain Brute; session-sim-9 notes r05).
 */
const R02 = ["Mira", "Thorn", "Brakka", "Goblin 2"];
const R05 = ["Goblin", "Dragon", "Goblin 3", "Goblin A", "Goblin B", "Wolf 2", "Plain Brute"];

test("FR-SHELL-60 player sheet 1280×800: fit on the 4 r02 tokens, 7 more come into sight → one reveal refit (FR-MAP-82) → no footprint under char.sheet or any window at 1280×800, 1280×720, 1440×900, 1600×900", () => {
  const byName = (names: readonly string[]) =>
    names.map((n) => SIM9_AMBUSH_PLAYER.find((t) => t.name === n) as AmbushToken);
  const shown = byName(R02);
  const later = [...shown, ...byName(R05)];
  const refits: string[] = [];
  for (const vp of SIZES) {
    const all = new Set(playerWindows.defs.map((d) => d.kind));
    const ws = defaultLayout(playerWindows, vp);
    const windows = renderedWindowRects(ws, playerWindows, all, vp);
    const sheet = renderedWindowRects(
      ws.filter((w) => w.kind === "char.sheet"),
      playerWindows,
      all,
      vp,
    )[0];
    expect(sheet).toBeDefined();
    // K5: the sheet fits 12 px above the toast corner, 52 px lower than before (418 → 440).
    if (vp.w === 1280 && vp.h === 800) expect(sheet).toEqual({ x: 948, y: 60, w: 320, h: 440 });
    const obstacles = fitObstacles("player", windows, keepOuts("player", vp), vp);
    const room = {
      areas: freeAreas(obstacles, vp),
      obstacles,
      windowsOnly: freeAreas(windows, vp),
    };
    const area = visibleArea(vp);
    const first = fitScene(shown, AMBUSH_GRID, AMBUSH_MAP, vp, room);
    const drawn = later.map((t) => ({ id: t.name, box: footprintBox([t], AMBUSH_GRID) as Rect }));
    const prev = new Set(R02);
    const refit = revealRefit(prev, drawn, first, obstacles, area, "fitted");
    const cam = refit ? fitScene(later, AMBUSH_GRID, AMBUSH_MAP, vp, room) : first;
    refits.push(`${vp.w}×${vp.h}: ${refit ? `refit ${Math.round(cam.scale * 70)} px` : "none"}`);
    const check = "visible" in cam && cam.visible === "pcs" ? later.filter((t) => t.pc) : later;
    for (const t of check) {
      const p = footprintBox([t], AMBUSH_GRID) as Rect;
      expect({
        at: `${vp.w}×${vp.h}`,
        t: t.name,
        clear: allClear(cam, [p], obstacles, area),
      }).toEqual({
        at: `${vp.w}×${vp.h}`,
        t: t.name,
        clear: true,
      });
    }
  }
  // BL-42: where the newly seen tokens land under the sheet or off-screen → a refit. K5 (the
  // taller sheet and work area): 1280×800 frames them all already; 1280×720 still refits.
  expect(refits[0]).toMatch(/^1280×720: refit/);
  expect(refits[1]).toBe("1280×800: none");
  console.info(`FR-SHELL-60 reveal refits: ${refits.join("; ")}`);
});
