// Test-only token cells for the registry-driven layout tests (FR-SHELL-58, -62, -87; play-shell
// §13 sprints 6 and 7): the `session-sim-9` and `session-sim-10` Goblin Ambush as each client
// holds it, and their footprints on screen at the camera the scene fit gives for a layout.
// Nothing here runs in the app.
import { footprint } from "@shared/scenes-map/geometry";
import { type FitToken, fitScene } from "../scenes-map/camera";
import { fitObstacles, freeAreas } from "./free-area";
import type { Rect, Viewport } from "./geometry";
import { keepOuts } from "./keep-outs";
import type { PlacementToken } from "./placement";
import type { ShellClient } from "./registry";

/** The `battlemap` fixture (Goblin Ambush): 20 × 14 cells at 70 px. */
export const AMBUSH_GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
export const AMBUSH_MAP = { w: 1400, h: 980 };

export interface AmbushToken extends FitToken {
  name: string;
  /** Hidden: drawn for the DM only. */
  hidden?: true;
  /**
   * Owned but not a character (a pet or summon): a PC for the map's Fit (FR-MAP-46: owned),
   * not for auto placement's PC rule (FR-SHELL-57, -77: player characters only).
   */
  companion?: true;
}

const tok = (
  name: string,
  col: number,
  row: number,
  opts: { pc?: true; size?: FitToken["size"]; hidden?: true; companion?: true } = {},
): AmbushToken => ({
  name,
  col,
  row,
  size: opts.size ?? "medium",
  pc: opts.pc === true || opts.companion === true,
  ...(opts.hidden && { hidden: true as const }),
  ...(opts.companion && { companion: true as const }),
});

/**
 * `session-sim-9` Goblin Ambush, DM view: `session-sim-8`'s tokens (the sprint-5 cells: PCs, the
 * combat's monsters, the art tokens on rows 1–3, Goblin Lurker, Crypt Ogre) after sim-9's
 * `trail-moves` (Mira (2, 7) → (5, 6), Thorn (2, 9) → (4, 10), Goblin (12, 6) → (10, 6)).
 */
export const SIM9_AMBUSH_DM: readonly AmbushToken[] = [
  tok("Mira", 5, 6, { pc: true }),
  tok("Thorn", 4, 10, { pc: true }),
  tok("Brakka", 3, 8, { pc: true }),
  tok("Goblin", 10, 6),
  tok("Wolf", 14, 4, { hidden: true }),
  tok("Elite", 15, 8, { hidden: true }),
  tok("Goblin 2", 12, 8),
  tok("Dragon", 4, 1, { size: "huge" }),
  tok("Goblin 3", 8, 2),
  tok("Goblin A", 9, 2),
  tok("Goblin B", 10, 2),
  tok("Wolf 2", 12, 2),
  tok("Plain Brute", 14, 2),
  tok("Ogre", 17, 1, { size: "large" }),
  tok("Goblin Lurker", 17, 11),
  tok("Crypt Ogre", 18, 6, { size: "large" }),
];

/** The same for a player: hidden tokens never arrive. */
export const SIM9_AMBUSH_PLAYER: readonly AmbushToken[] = SIM9_AMBUSH_DM.filter((t) => !t.hidden);

/**
 * `session-sim-10` Goblin Ambush, DM view (read from the loaded bundle): sim-9's cells (no Crypt
 * Ogre) plus CP's tokens: Mira's Owlbear and Brakka's Drake Companion (pets) and the three Fire
 * Elementals (summons). The pets and summons are owned (the Fit's PCs, FR-MAP-46), not player
 * characters (auto placement's PCs, FR-SHELL-57).
 */
export const SIM10_AMBUSH_DM: readonly AmbushToken[] = [
  tok("Mira", 5, 6, { pc: true }),
  tok("Goblin", 10, 6),
  tok("Wolf", 14, 4, { hidden: true }),
  tok("Elite Goblin Warrior", 15, 8, { hidden: true }),
  tok("Goblin 2", 12, 8),
  tok("Thorn", 4, 10, { pc: true }),
  tok("Goblin Lurker", 17, 11),
  tok("Brakka", 3, 8, { pc: true }),
  tok("Goblin 3", 8, 2),
  tok("Goblin 4", 9, 2),
  tok("Elite Goblin Warrior 2", 10, 2),
  tok("Adult Red Dragon", 4, 1, { size: "huge" }),
  tok("Wolf 2", 12, 2),
  tok("Plain Brute", 14, 2),
  tok("Ogre", 17, 1, { size: "large", hidden: true }),
  tok("Owlbear", 0, 7, { companion: true, size: "large" }),
  tok("Drake Companion", 4, 8, { companion: true }),
  tok("Fire Elemental", 6, 5, { companion: true, size: "large" }),
  tok("Fire Elemental 2", 2, 9, { companion: true, size: "large" }),
  tok("Fire Elemental 3", 5, 9, { companion: true, size: "large" }),
];

/** The same for a player: hidden tokens never arrive. */
export const SIM10_AMBUSH_PLAYER: readonly AmbushToken[] = SIM10_AMBUSH_DM.filter((t) => !t.hidden);

/** The client's cells. */
export const ambushCells = (client: ShellClient) =>
  client === "dm" ? SIM9_AMBUSH_DM : SIM9_AMBUSH_PLAYER;

/** The client's `session-sim-10` cells. */
export const sim10Cells = (client: ShellClient) =>
  client === "dm" ? SIM10_AMBUSH_DM : SIM10_AMBUSH_PLAYER;

/**
 * The client's Goblin Ambush footprints on screen (FR-SHELL-57) at the camera the scene fit
 * (FR-MAP-59) gives with `windows` (rendered rects) open: what `tokenScreenBoxes` reads live.
 * The DM's at the sprint-6 fit with nothing shown (FR-MAP-80, OQ-MAP-57 D): the summary strip,
 * not the empty top-centre box.
 */
export function ambushTokens(
  client: ShellClient,
  vp: Viewport,
  windows: readonly Rect[],
  cells: readonly AmbushToken[] = ambushCells(client),
): PlacementToken[] {
  const obstacles = fitObstacles(client, windows, keepOuts(client, vp, new Map()), vp, null);
  const room = { areas: freeAreas(obstacles, vp), obstacles, windowsOnly: freeAreas(windows, vp) };
  const cam = fitScene(cells, AMBUSH_GRID, AMBUSH_MAP, vp, room);
  const c = AMBUSH_GRID.gridCellSize * cam.scale;
  return cells.map((t) => ({
    x: cam.x + t.col * c,
    y: cam.y + t.row * c,
    w: footprint(t.size) * c,
    h: footprint(t.size) * c,
    pc: t.pc && !t.companion,
  }));
}

/** `ambushTokens` on the `session-sim-10` cells (FR-SHELL-87 (f)). */
export const sim10Tokens = (client: ShellClient, vp: Viewport, windows: readonly Rect[]) =>
  ambushTokens(client, vp, windows, sim10Cells(client));
