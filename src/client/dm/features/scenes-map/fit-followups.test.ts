// Sprint 7 FU3 (scenes-map §13): the DM map follow-ups from `session-sim-10`, replayed with the
// exact window rects read off the walkthrough's screenshots (b00, b06) and the registry layouts.
import { expect, mock, test } from "bun:test";
import { fitObstacles, freeAreas, renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect, Viewport } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import { defaultLayout, reduce, type Windows } from "@ui/features/play-shell/manager";
import {
  AMBUSH_GRID,
  AMBUSH_MAP,
  type AmbushToken,
  SIM10_AMBUSH_DM,
} from "@ui/features/play-shell/test-cells";
import { summaryStrip } from "@ui/features/play-shell/toast-region";
import {
  allClear,
  appearanceKeeps,
  type Box,
  type Camera,
  FIT_HARD_MIN_CELL_PX,
  FIT_PAST_TOASTS_SHARE,
  type FitRoom,
  fitPastToasts,
  fitScene,
  footprintBox,
  visibleArea,
} from "@ui/features/scenes-map/camera";

// The players panel pulls in the DM session (localStorage, window.location at import); no DOM
// in bun test, and the shell only needs the window definition here.
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

/**
 * `session-sim-10` Goblin Ambush after End and Start "Escort to the Ford": Mira's Fire Elemental
 * dismissed (a11), Fire Elemental 2's token removed at End, Fire Elemental 3 turned hostile (a14:
 * no owner, a plain monster); the pets stay owned.
 */
const ESCORT: readonly AmbushToken[] = SIM10_AMBUSH_DM.filter(
  (t) => t.name !== "Fire Elemental" && t.name !== "Fire Elemental 2",
).map((t) =>
  t.name === "Fire Elemental 3"
    ? { name: t.name, col: t.col, row: t.row, size: t.size, pc: false }
    : t,
);

const V1440 = { w: 1440, h: 900 };
/** Read off b00 / b06 (1440×900). */
const GAME_LOG = { x: 68, y: 584, w: 1150, h: 240 };
const INITIATIVE = { x: 1028, y: 60, w: 404, h: 512 };
const SCENES_HOME = { x: 68, y: 60, w: 260, h: 440 };
const SCENES_PUSHED = { x: 546, y: 60, w: 260, h: 440 };
const PARTY = { x: 576, y: 60, w: 364, h: 400 };
/** b06's card toast "Mira: 10 to hit (Shortsword)" at the home band. */
const CARD = { x: 560, y: 100, w: 320, h: 86 };

const boxOf = (t: AmbushToken) => footprintBox([t], AMBUSH_GRID) as Box;
const named = (...names: string[]) => ESCORT.filter((t) => names.includes(t.name));
const cellPx = (c: Camera) => c.scale * AMBUSH_GRID.gridCellSize;

/** The DM's room: rendered windows + the summary strip + the shown stack (FR-MAP-80). */
function room(vp: Viewport, windows: readonly Rect[], shown: Rect | null = null): FitRoom {
  const obstacles = fitObstacles("dm", windows, keepOuts("dm", vp), vp, shown);
  return { areas: freeAreas(obstacles, vp), obstacles, windowsOnly: freeAreas(windows, vp) };
}

/** The tokens among `tokens` whose footprint at `cam` is outside the area or under a window. */
const covered = (
  cam: Camera,
  tokens: readonly AmbushToken[],
  windows: readonly Rect[],
  vp: Viewport,
) => tokens.filter((t) => !allClear(cam, [boxOf(t)], windows, visibleArea(vp))).map((t) => t.name);

test("FR-MAP-90 no jump at Start: sim-10 b00 (1440×900, Scenes + Party + Initiative + Game log) → Thorn, Brakka and the Owlbear clear of every window (was 53 px at pan 225, 72 with Thorn under the Game log); with 7 obstacles (past the old cap of 6) too", () => {
  const windows = [SCENES_HOME, PARTY, INITIATIVE, GAME_LOG];
  const fit = fitScene(ESCORT, AMBUSH_GRID, AMBUSH_MAP, V1440, room(V1440, windows));
  const kept = named("Thorn", "Brakka", "Owlbear");
  expect(covered(fit, kept, windows, V1440)).toEqual([]);
  // Not b00's camera (the FR-MAP-46 centring the old `pcs` fallback kept).
  expect({ x: Math.round(fit.x), y: Math.round(fit.y), cell: Math.round(cellPx(fit)) }).not.toEqual(
    {
      x: 225,
      y: 72,
      cell: 53,
    },
  );
  // The PCs at least as clear as any other pan at that scale: Mira only partly under Party.
  console.info(
    `FR-MAP-90 b00: ${cellPx(fit).toFixed(1)} px ${fit.visible} at ${fit.x}, ${fit.y}; covered: ${
      covered(
        fit,
        ESCORT.filter((t) => t.pc),
        windows,
        V1440,
      ).join(", ") || "none"
    }`,
  );
  // 7 obstacles: + the card toast (shown stack) and a Dice tray beside the Game log.
  const tray = { x: 1228, y: 590, w: 190, h: 230 };
  const seven = room(V1440, [...windows, tray], CARD);
  expect(seven.obstacles.length).toBe(7);
  const fit7 = fitScene(ESCORT, AMBUSH_GRID, AMBUSH_MAP, V1440, seven);
  expect(covered(fit7, kept, [...windows, tray, CARD], V1440)).toEqual([]);
});

test("FR-MAP-90 no jump at Start: sim-10 b00 as the spec words it (Scenes + Game log + Initiative) → every token clear; an appearance with every token clear keeps the camera", () => {
  const windows = [SCENES_HOME, INITIATIVE, GAME_LOG];
  const r = room(V1440, windows);
  const fit = fitScene(ESCORT, AMBUSH_GRID, AMBUSH_MAP, V1440, r);
  expect(fit.visible).toBe("all");
  expect(covered(fit, ESCORT, windows, V1440)).toEqual([]);
  const boxes = ESCORT.map(boxOf);
  // The camera from that fit: an appearance (Initiative's rows) with every token still clear
  // keeps it (no jump).
  expect(appearanceKeeps(fit, boxes, r.obstacles, V1440)).toBe(true);
  // Fit with Scenes + Game log before Start (Initiative minimised, 42 px): Start opens Initiative
  // over the right-hand tokens → the appearance refits, to the fit above (none under a window).
  const before = fitScene(
    ESCORT,
    AMBUSH_GRID,
    AMBUSH_MAP,
    V1440,
    room(V1440, [SCENES_HOME, GAME_LOG]),
  );
  expect(appearanceKeeps(before, boxes, r.obstacles, V1440)).toBe(false);
  // Initiative grown further over tokens → no keep.
  const grown = { ...INITIATIVE, x: fit.x + 10 * cellPx(fit), w: 600 };
  expect(appearanceKeeps(fit, boxes, [...r.obstacles, grown], V1440)).toBe(false);
});

test("FR-MAP-91 Fit with Scenes and a toast: sim-10 b06 at 1440×900 (Game log + Initiative + Scenes, the 320 × 86 card toast at the home band) → cells ≥ 75 % of the strip-only fit, never 24 px; no toast → as FR-MAP-80", () => {
  // The registry layout (Scenes opened from the launcher), as U5 replays it.
  const all = new Set(dmWindows.defs.map((d) => d.kind));
  const ctx = { registry: dmWindows, viewport: V1440, available: all };
  const ws: Windows = reduce(
    defaultLayout(dmWindows, V1440),
    { type: "open", kind: "map.scenes" },
    ctx,
  );
  const windows = renderedWindowRects(ws, dmWindows, all, V1440);
  const card = { ...CARD, x: summaryStrip(V1440).x };
  const strip = room(V1440, windows);
  const withCard = room(V1440, windows, card);
  const plain = fitPastToasts(ESCORT, AMBUSH_GRID, AMBUSH_MAP, V1440, strip, strip);
  const fit = fitPastToasts(ESCORT, AMBUSH_GRID, AMBUSH_MAP, V1440, withCard, strip);
  expect(cellPx(fit)).toBeGreaterThanOrEqual(FIT_PAST_TOASTS_SHARE * cellPx(plain) - 1e-9);
  expect(cellPx(fit)).toBeGreaterThan(FIT_HARD_MIN_CELL_PX);
  // Kept clear (the card costs ≤ 25 %): every footprint clear of the card and every window.
  if (!fit.pastToasts) expect(covered(fit, ESCORT, [...windows, card], V1440)).toEqual([]);
  expect(plain).toMatchObject(fitScene(ESCORT, AMBUSH_GRID, AMBUSH_MAP, V1440, strip));
  console.info(
    `FR-MAP-91 b06 (registry layout): ${cellPx(fit).toFixed(1)} px${fit.pastToasts ? " past the toast" : ""}; strip only ${cellPx(plain).toFixed(1)} px`,
  );
  // b06's exact rects: the 24 px came from Scenes at its pushed spot (546, 60), toast or not;
  // back at its spot (FU1's return, OQ-SHELL-54 A) the Fit keeps the card clear at ≥ 75 %.
  const pushed = [GAME_LOG, INITIATIVE, SCENES_PUSHED];
  const atPushed = fitPastToasts(
    ESCORT,
    AMBUSH_GRID,
    AMBUSH_MAP,
    V1440,
    room(V1440, pushed, CARD),
    room(V1440, pushed),
  );
  expect(Math.round(cellPx(atPushed))).toBe(24);
  const home = [GAME_LOG, INITIATIVE, SCENES_HOME];
  const homeStrip = room(V1440, home);
  const atHome = fitPastToasts(
    ESCORT,
    AMBUSH_GRID,
    AMBUSH_MAP,
    V1440,
    room(V1440, home, CARD),
    homeStrip,
  );
  const homePlain = fitScene(ESCORT, AMBUSH_GRID, AMBUSH_MAP, V1440, homeStrip);
  expect(atHome.pastToasts).toBe(false);
  expect(cellPx(atHome)).toBeGreaterThanOrEqual(FIT_PAST_TOASTS_SHARE * cellPx(homePlain) - 1e-9);
  expect(covered(atHome, ESCORT, [...home, CARD], V1440)).toEqual([]);
});

test("FR-MAP-92 resize refit: 1280×720 → 1440×900 while fitted (Game log + Initiative + Scenes, the card shown) → the same cell size as Fit at 1440×900 once the windows' render fit applied (b06: 26 px)", () => {
  const all = new Set(dmWindows.defs.map((d) => d.kind));
  const layout = (vp: Viewport) => {
    const ctx = { registry: dmWindows, viewport: vp, available: all };
    return reduce(defaultLayout(dmWindows, vp), { type: "open", kind: "map.scenes" }, ctx);
  };
  const V1280 = { w: 1280, h: 720 };
  const ws = layout(V1280);
  const fitAt = (vp: Viewport, windows: readonly Rect[]) => {
    const card = { ...CARD, x: summaryStrip(vp).x };
    return fitPastToasts(
      ESCORT,
      AMBUSH_GRID,
      AMBUSH_MAP,
      vp,
      room(vp, windows, card),
      room(vp, windows),
    );
  };
  // The refit reads the stored layout as rendered at the new viewport (after the render fit, the
  // settle wait in camera.test), with Fit's rules (FR-MAP-91): Fit pressed at 1440×900 reads the
  // same windows, so both end at one cell size.
  const windows = renderedWindowRects(ws, dmWindows, all, V1440);
  const resized = fitAt(V1440, windows);
  const card = { ...CARD, x: summaryStrip(V1440).x };
  const pressed = fitPastToasts(
    ESCORT,
    AMBUSH_GRID,
    AMBUSH_MAP,
    V1440,
    room(V1440, windows, card),
    room(V1440, windows),
  );
  expect(cellPx(resized)).toBe(cellPx(pressed));
  expect(cellPx(resized)).toBeGreaterThan(26);
  expect(covered(resized, ESCORT, windows, V1440)).toEqual([]);
  console.info(`FR-MAP-92: ${cellPx(resized).toFixed(1)} px after 1280×720 → 1440×900`);
});

test("FR-MAP-90 no jump at Start: U13 (1440×900, Scenes 260×360 + Game log + Initiative 400×512, the card plus Start's initiative roll popup shown) → the appearance refit takes Fit's rule: every token clear of the windows at 36 px (was pcs at 48 px, Ogre, Wolf, Elite and Plain Brute under Initiative)", () => {
  // fu-s7 after End (every Fire Elemental token removed) and Start "Escort to the Ford".
  const tokens = SIM10_AMBUSH_DM.filter((t) => !t.name.startsWith("Fire Elemental"));
  const windows = [{ x: 68, y: 60, w: 260, h: 360 }, GAME_LOG, { x: 1028, y: 60, w: 400, h: 512 }];
  // The shown stack: the card (560, 100, 320 × 86) and one roll popup (320 × 190) below it.
  const stack = { x: 560, y: 100, w: 320, h: 86 + 8 + 190 };
  const kept = fitScene(tokens, AMBUSH_GRID, AMBUSH_MAP, V1440, room(V1440, windows, stack));
  // The walkthrough's refit: the stack as an obstacle → pcs (at 44 px since FR-MAP-93's 4-px PC
  // margin, 48 before), monsters under Initiative.
  expect({ visible: kept.visible, cell: cellPx(kept) }).toEqual({ visible: "pcs", cell: 44 });
  expect(covered(kept, named("Ogre", "Plain Brute"), windows, V1440)).toEqual([
    "Plain Brute",
    "Ogre",
  ]);
  // Fit's rule (FR-MAP-91): the strip-only fit keeps every token clear, so it wins over pcs.
  const strip = room(V1440, windows);
  const fit = fitPastToasts(
    tokens,
    AMBUSH_GRID,
    AMBUSH_MAP,
    V1440,
    room(V1440, windows, stack),
    strip,
  );
  expect({ visible: fit.visible, cell: cellPx(fit), past: fit.pastToasts }).toEqual({
    visible: "all",
    cell: 36,
    past: true,
  });
  expect(covered(fit, tokens, windows, V1440)).toEqual([]);
  // = pressing Fit once the popup has gone (the card alone: kept, all at 36 px).
  const pressed = fitPastToasts(
    tokens,
    AMBUSH_GRID,
    AMBUSH_MAP,
    V1440,
    room(V1440, windows, { ...stack, h: 86 }),
    strip,
  );
  expect({ visible: pressed.visible, cell: cellPx(pressed) }).toEqual({ visible: "all", cell: 36 });
  // Both pcs (nothing keeps every token clear) → the toasts stay clear (the first fit).
  const crowded = [...windows, { x: 340, y: 60, w: 680, h: 520 }];
  const both = fitPastToasts(
    tokens,
    AMBUSH_GRID,
    AMBUSH_MAP,
    V1440,
    room(V1440, crowded, stack),
    room(V1440, crowded),
  );
  expect({ visible: both.visible, past: both.pastToasts }).toEqual({ visible: "pcs", past: false });
});
