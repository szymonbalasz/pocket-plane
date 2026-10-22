import { describe, expect, test } from "bun:test";
import type { TokenSize } from "@shared/scenes-map/schemas";
import { freeArea, freeAreas } from "../play-shell/free-area";
import { defaultRect, type Rect, TOP_BAR_H, workArea } from "../play-shell/geometry";
import {
  APPEARANCE_REFIT_MAX_WAITS,
  allClear,
  appearanceKeeps,
  type Box,
  bestFreeRect,
  type Camera,
  type CameraMode,
  cameraOn,
  contentBox,
  createAppearanceRefit,
  createResizeRefit,
  createRevealRefit,
  FIT_MARGIN,
  FIT_MIN_CELL_PX,
  FIT_PAST_TOASTS_SHARE,
  fitCamera,
  fitContent,
  fitPastToasts,
  fitScene,
  fitVisible,
  footprintBox,
  PCS_PAN_MAX_TOKENS,
  pcsPan,
  RESIZE_REFIT_MS,
  REVEAL_REFIT_MS,
  refitsOnReveal,
  revealRefit,
  type Timers,
  visibleArea,
  ZOOM_MAX,
} from "./camera";
import { labelMetrics } from "./label";

/** The `battlemap` fixture: 20 × 14 cells at 70 px, no offset. */
const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const MAP = { w: 1400, h: 980 };
const tok = (col: number, row: number, size: TokenSize = "medium") => ({ col, row, size });

/** Goblin Ambush in `session-sim`: Mira, Goblin, Goblin 2, Thorn; hidden Wolf, Elite. */
const VISIBLE = [tok(2, 7), tok(12, 6), tok(12, 8), tok(2, 9)];
const HIDDEN = [tok(14, 4), tok(15, 8)];
/** The PC tokens (owned): Mira, Thorn. */
const PCS = [tok(2, 7), tok(2, 9)];

/** `b` (map px) lies in `f` (screen px) minus the fit margin. */
const inside = (cam: Camera, b: Box, f: Box) => {
  const x0 = cam.x + b.x * cam.scale;
  const y0 = cam.y + b.y * cam.scale;
  return (
    x0 >= f.x + FIT_MARGIN - 1e-6 &&
    y0 >= f.y + FIT_MARGIN - 1e-6 &&
    x0 + b.w * cam.scale <= f.x + f.w - FIT_MARGIN + 1e-6 &&
    y0 + b.h * cam.scale <= f.y + f.h - FIT_MARGIN + 1e-6
  );
};

describe("FR-MAP-44 content box", () => {
  test("FR-MAP-44 content box: footprints + 1 cell per side (DM incl. hidden)", () => {
    expect(contentBox([...VISIBLE, ...HIDDEN], GRID, MAP)).toEqual({
      x: 70,
      y: 210,
      w: 1120,
      h: 560,
    });
  });

  test("FR-MAP-44 content box: the player's store only (hidden tokens never count)", () => {
    expect(contentBox(VISIBLE, GRID, MAP)).toEqual({ x: 70, y: 350, w: 910, h: 420 });
  });

  test("FR-MAP-44 content box: cut to the map", () => {
    expect(contentBox([tok(0, 0), tok(19, 13)], GRID, MAP)).toEqual({ x: 0, y: 0, ...MAP });
  });

  test("FR-MAP-44 content box: no tokens → the map", () => {
    expect(contentBox([], GRID, MAP)).toEqual({ x: 0, y: 0, ...MAP });
  });

  test("FR-MAP-44 content box: Large footprint (2 × 2) and grid offset", () => {
    const g = { ...GRID, gridOffsetX: 10, gridOffsetY: 20 };
    expect(contentBox([tok(5, 5, "large")], g, MAP)).toEqual({ x: 290, y: 300, w: 280, h: 280 });
  });

  test("FR-MAP-44 content box: only tokens off the map → the map", () => {
    expect(contentBox([tok(40, 40)], GRID, MAP)).toEqual({ x: 0, y: 0, ...MAP });
  });
});

describe("FR-MAP-44 fit", () => {
  const work = { w: 1440, h: 788 };
  const cap = fitCamera(MAP, work).scale;

  test("FR-MAP-44 scale cap: never above the whole-map fit into the work area", () => {
    const free = { x: 68, y: 48, w: 1372, h: 788 };
    const one = contentBox([tok(10, 7)], GRID, MAP);
    const cam = fitContent(one, free, MAP, work, 70, null);
    // One token: that zoom. BL-01: the whole map fits the work area at it, so it is centred
    // there (the token stays in the free area).
    expect(cam.scale).toBe(cap);
    expect(cam.x).toBeCloseTo(68 + (1372 - MAP.w * cap) / 2);
    expect(cam.y).toBeCloseTo(48 + (788 - MAP.h * cap) / 2);
    // Pre-R1 the scene opened at the viewport fit: never zoom in beyond that either.
    expect(cam.scale).toBeLessThanOrEqual(fitCamera(MAP, { w: 1440, h: 900 }).scale);
  });

  test("FR-MAP-44 fit: the box sets the scale (free area minus 16 px); BL-01 keeps the tokens in the free area across, the top row vertically", () => {
    const free = { x: 68, y: 48, w: 840, h: 500 };
    const box = contentBox([...VISIBLE, ...HIDDEN], GRID, MAP);
    const cam = fitContent(box, free, MAP, work, 70, null);
    expect(cam.scale).toBeCloseTo((840 - 2 * FIT_MARGIN) / box.w);
    // BL-01: the map (1010 × 707 px) fits the work area; panning it to the centre stops where the
    // tokens' footprints reach the free area's edge.
    const tokens = footprintBox([...VISIBLE, ...HIDDEN], GRID);
    if (!tokens) throw new Error("no tokens");
    expect(cam.x + (tokens.x + tokens.w) * cam.scale).toBeCloseTo(68 + 840);
    expect(cam.x + tokens.x * cam.scale).toBeGreaterThan(68);
    // Vertically the map is taller than the free area (707 > 500): the tokens in it would put
    // the top row under the top bar (FOG §13 step 26), so the top row shows and the tokens, with
    // their labels' lower half (6.6 px here), stay in the work area.
    expect(cam.y).toBe(48);
    const bottom = cam.y + (tokens.y + tokens.h) * cam.scale + 6.6;
    expect(bottom).toBeGreaterThan(48 + 500);
    expect(bottom).toBeLessThanOrEqual(48 + 788);
  });
});

describe("FR-MAP-46 fit floor", () => {
  const work = { w: 1280, h: 608 };
  /** The DM free area at 1280×720, default layout (Initiative top-right, Game log bottom-left). */
  const free = { x: 68, y: 48, w: 800, h: 356 };

  test("FR-MAP-46 fit floor 48 px at 1280×720: Goblin Ambush (DM) → 48 px cell, floor, PCs in the free area", () => {
    const box = contentBox([...VISIBLE, ...HIDDEN], GRID, MAP);
    const pcs = footprintBox(PCS, GRID);
    const cam = fitContent(box, free, MAP, work, 70, pcs);
    expect(cam.floor).toBe(true);
    expect(cam.scale * 70).toBeCloseTo(FIT_MIN_CELL_PX);
    expect(pcs && inside(cam, pcs, free)).toBe(true);
    // The content box doesn't fit at the floor (taller than the free area).
    expect(box.h * cam.scale).toBeGreaterThan(free.h);
  });

  test("FR-MAP-46 PC tokens inside the free area after the least pan", () => {
    // Monsters left, PCs at the far right: centring the box leaves the PCs outside.
    const pcs = footprintBox([tok(19, 6), tok(19, 8)], GRID);
    const box = contentBox([tok(0, 6), tok(1, 8), tok(19, 6), tok(19, 8)], GRID, MAP);
    const cam = fitContent(box, free, MAP, work, 70, pcs);
    expect(cam.floor).toBe(true);
    expect(pcs && inside(cam, pcs, free)).toBe(true);
    // Least: the PCs touch the right margin, not centred.
    const right = cam.x + ((pcs?.x ?? 0) + (pcs?.w ?? 0)) * cam.scale;
    expect(right).toBeCloseTo(free.x + free.w - FIT_MARGIN);
  });

  test("FR-MAP-46 a box that fits above the floor keeps today's scale (floor false)", () => {
    const wide = { x: 68, y: 48, w: 1372, h: 788 };
    const work1440 = { w: 1440, h: 788 };
    const box = contentBox([...VISIBLE, ...HIDDEN], GRID, MAP);
    const cam = fitContent(box, wide, MAP, work1440, 70, footprintBox(PCS, GRID));
    expect(cam.floor).toBe(false);
    expect(cam.scale).toBe(fitCamera(MAP, work1440).scale);
    expect(cam.scale * 70).toBeGreaterThan(FIT_MIN_CELL_PX);
    // BL-01: the whole map fits the work area: centred in it.
    expect(cam.x).toBeCloseTo(68 + (1372 - MAP.w * cam.scale) / 2);
  });

  test("FR-MAP-46 the floor beats the whole-map cap (one token, box fits): at 48 px, in the free area", () => {
    const one = contentBox([tok(10, 7)], GRID, MAP);
    expect(fitCamera(MAP, work).scale * 70).toBeLessThan(FIT_MIN_CELL_PX);
    const cam = fitContent(one, free, MAP, work, 70, null);
    expect(cam.floor).toBe(true);
    expect(cam.scale * 70).toBeCloseTo(FIT_MIN_CELL_PX);
    // Centred on the token the map's left edge would sit under the rail (x = -36); BL-01: the
    // map (960 px) fits the work area's width, so it is centred there.
    expect(cam.x).toBeCloseTo(68 + (1212 - 960) / 2);
    // The token stays in the free area across; vertically the map (672 px) is taller than the
    // work area, so its top row sits under the top bar (FOG §13 step 26) and the token (row 7,
    // y 384–432) in the work area, just below the 356 px free area.
    const own = footprintBox([tok(10, 7)], GRID);
    if (!own) throw new Error("no token");
    expect(cam.x + own.x * cam.scale).toBeGreaterThanOrEqual(free.x);
    expect(cam.x + (own.x + own.w) * cam.scale).toBeLessThanOrEqual(free.x + free.w);
    expect(cam.y).toBe(48);
    expect(cam.y + (own.y + own.h) * cam.scale).toBeLessThanOrEqual(48 + 608);
  });

  test("FR-MAP-46 PC box wider than the free area → centred on the PCs", () => {
    const pcs = footprintBox([tok(0, 7), tok(19, 7)], GRID);
    const box = contentBox([tok(0, 7), tok(19, 7), ...HIDDEN], GRID, MAP);
    const narrow = { x: 68, y: 48, w: 500, h: 356 };
    const cam = fitContent(box, narrow, MAP, work, 70, pcs);
    expect(cam.floor).toBe(true);
    const mid = cam.x + ((pcs?.x ?? 0) + (pcs?.w ?? 0) / 2) * cam.scale;
    expect(mid).toBeCloseTo(68 + 250);
    // Vertically the PCs fit: inside the free area.
    const top = cam.y + (pcs?.y ?? 0) * cam.scale;
    expect(top).toBeGreaterThanOrEqual(48 + FIT_MARGIN);
    expect(top + (pcs?.h ?? 0) * cam.scale).toBeLessThanOrEqual(48 + 356 - FIT_MARGIN);
  });

  test("FR-MAP-46 max zoom caps the floor", () => {
    const g = { gridCellSize: 5, gridOffsetX: 0, gridOffsetY: 0 };
    const box = contentBox([tok(0, 0), tok(199, 0)], g, MAP);
    const cam = fitContent(box, free, MAP, work, 5, null);
    expect(cam.floor).toBe(true);
    expect(cam.scale).toBe(ZOOM_MAX);
  });

  test("FR-MAP-46 player store: hidden tokens never move the camera", () => {
    // The player's fit only sees its store (no Wolf / Elite): the same as the DM's fit with
    // the hidden tokens left out, and not the DM's.
    const pcs = footprintBox(PCS, GRID);
    const player = fitContent(contentBox(VISIBLE, GRID, MAP), free, MAP, work, 70, pcs);
    const dm = fitContent(contentBox([...VISIBLE, ...HIDDEN], GRID, MAP), free, MAP, work, 70, pcs);
    const movedHidden = [tok(18, 1), tok(17, 12)];
    const dmElsewhere = fitContent(
      contentBox([...VISIBLE, ...movedHidden], GRID, MAP),
      free,
      MAP,
      work,
      70,
      pcs,
    );
    expect(player).not.toEqual(dm);
    expect(dmElsewhere).not.toEqual(dm);
    expect(fitContent(contentBox(VISIBLE, GRID, MAP), free, MAP, work, 70, pcs)).toEqual(player);
    expect(pcs && inside(player, pcs, free)).toBe(true);
  });
});

describe("FR-MAP-44 BL-01 fit fills the canvas (session-sim, DM)", () => {
  /** DM defaults (protocol §24): Game log 460 × 240 bottom-left, Initiative 400 × 500 top-right. */
  const gameLog = (vp: { w: number; h: number }) =>
    defaultRect({ anchor: "bottom-left", dx: 56 }, { w: 460, h: 240 }, vp);
  const initiative = (vp: { w: number; h: number }) =>
    defaultRect({ anchor: "top-right" }, { w: 400, h: 500 }, vp);
  /** Town: Mira (5, 5), Thorn (4, 5); both PCs. Same 1400 × 980 map, 70 px grid. */
  const TOWN = [tok(5, 5), tok(4, 5)];
  const SCENES = [
    { name: "Goblin Ambush", tokens: [...VISIBLE, ...HIDDEN], pcs: PCS },
    { name: "Town", tokens: TOWN, pcs: TOWN },
  ];
  function fit(scene: (typeof SCENES)[number], vp: { w: number; h: number }, windows: Rect[]) {
    const free = freeArea(windows, vp);
    const work = workArea(vp);
    const cam = fitContent(
      contentBox(scene.tokens, GRID, MAP),
      free,
      MAP,
      work,
      70,
      footprintBox(scene.pcs, GRID),
    );
    const map = { x: cam.x, y: cam.y, w: MAP.w * cam.scale, h: MAP.h * cam.scale };
    /** The work area right of the rail, in viewport px. */
    const view = { x: 68, y: 48, w: vp.w - 68, h: work.h };
    const under = scene.tokens.filter((t) => {
      const c = {
        x: cam.x + (t.col + 0.5) * 70 * cam.scale,
        y: cam.y + (t.row + 0.5) * 70 * cam.scale,
      };
      return windows.some((r) => c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.h);
    });
    return { cam, free, map, view, under };
  }
  const sim6 = { w: 1440, h: 900 };
  const laptop = { w: 1280, h: 720 };

  test("FR-MAP-44 BL-01 at 1440×900, with and without the Game log: the whole map on screen, centred, no token under a window", () => {
    for (const scene of SCENES) {
      for (const windows of [[], [gameLog(sim6)]]) {
        const { cam, map, view, under } = fit(scene, sim6, windows);
        const at = `${scene.name}, ${windows.length ? "Game log" : "no windows"}`;
        expect(cam.floor).toBe(false);
        // No top rows cut, nothing cropped on the right.
        expect({ at, top: map.y >= view.y, right: map.x + map.w <= view.x + view.w }).toEqual({
          at,
          top: true,
          right: true,
        });
        expect(map.x).toBeGreaterThanOrEqual(view.x);
        expect(map.y + map.h).toBeLessThanOrEqual(view.y + view.h);
        // No windows: centred (the slack is the same on both sides). With the Game log the
        // tokens above it hold the map up, so the slack sits below (< 48 px).
        if (windows.length === 0) {
          expect(map.y - view.y).toBeCloseTo(view.y + view.h - (map.y + map.h));
          expect(map.x - view.x).toBeCloseTo(view.x + view.w - (map.x + map.w));
        }
        expect(under.length).toBe(0);
      }
    }
  });

  test("FR-MAP-44 BL-01 at 1440×900 with the Game log: Goblin Ambush no longer cut at the top, Town no longer cropped on the right", () => {
    // Before BL-01 (sim-6 l01 / a01): Ambush map top at y −92 under the top bar, ~250 px empty
    // below; Town map from x 490 to 1547 in a 1440 px viewport.
    const ambush = fit(SCENES[0] as (typeof SCENES)[number], sim6, [gameLog(sim6)]);
    expect(ambush.map.y).toBeGreaterThanOrEqual(48);
    const town = fit(SCENES[1] as (typeof SCENES)[number], sim6, [gameLog(sim6)]);
    expect(town.map.x + town.map.w).toBeLessThanOrEqual(1440);
  });

  test("FR-MAP-44 BL-01 at 1280×720 (FR-MAP-46 floor, map taller than the work area): covers it, full width where the tokens allow, PCs in the free area", () => {
    for (const scene of SCENES) {
      for (const windows of [[], [gameLog(laptop)]]) {
        const { cam, map, view, free } = fit(scene, laptop, windows);
        expect(cam.floor).toBe(true);
        // Taller than the work area (672 > 608): no empty band above or below.
        expect(map.y).toBeLessThanOrEqual(view.y + 1e-6);
        expect(map.y + map.h).toBeGreaterThanOrEqual(view.y + view.h - 1e-6);
        // Narrower (960 < 1212): all of it, not cropped on the right…
        const tokens = footprintBox(scene.tokens, GRID);
        if (!tokens) throw new Error("no tokens");
        const pcs = footprintBox(scene.pcs, GRID);
        if (!pcs) throw new Error("no PCs");
        if (windows.length === 0) {
          expect(map.x).toBeGreaterThanOrEqual(view.x);
          expect(map.x + map.w).toBeLessThanOrEqual(view.x + view.w);
        } else {
          // … but the free area is right of the Game log, and the PCs keep the FR-MAP-46 margin
          // in it: Town's PCs (cols 4–5) stop at that margin (a 32 px crop on the right; was the
          // whole map 336 px right of the rail); Goblin Ambush's Thorn (col 2, row 9) sits beside
          // the log, so its cols 17–19 (no tokens) stay cut.
          expect(cam.x + pcs.x * cam.scale).toBeCloseTo(free.x + FIT_MARGIN);
          expect(map.x + map.w).toBeGreaterThan(view.x + view.w);
        }
        // Every token in the work area; the PCs in the free area.
        expect(cam.x + (tokens.x + tokens.w) * cam.scale).toBeLessThanOrEqual(view.x + view.w);
        expect(inside(cam, pcs, free)).toBe(true);
      }
    }
  });

  test("FR-MAP-44 BL-01 at 1280×720 (map taller than the work area): the top row shows under the top bar, the crop falls at the dock", () => {
    for (const scene of SCENES) {
      for (const windows of [[], [gameLog(laptop)]]) {
        const { map, view, free } = fit(scene, laptop, windows);
        expect({ scene: scene.name, top: map.y }).toEqual({ scene: scene.name, top: view.y });
        expect(map.y + map.h).toBeGreaterThan(view.y + view.h);
        expect(free.y).toBe(view.y);
      }
    }
  });

  test("FR-MAP-44 BL-01 at 1280×720 with Game log and Initiative: the PCs stay in the free area, the map pans no further", () => {
    for (const scene of SCENES) {
      const windows = [gameLog(laptop), initiative(laptop)];
      const { cam, map, view, free } = fit(scene, laptop, windows);
      const pcs = footprintBox(scene.pcs, GRID);
      expect(pcs && inside(cam, pcs, free)).toBe(true);
      expect(map.x).toBeGreaterThanOrEqual(view.x);
      expect(map.x + map.w).toBeLessThanOrEqual(view.x + view.w);
    }
  });

  /**
   * FOG §13 step 26 (V7 walkthrough, `vision-party` after step 15): Goblin Ambush with Mira (2, 7),
   * Thorn (2, 9), Wolf (14, 4), Goblin (14, 7), Goblin 2 (12, 8), Elite (15, 8), Cave Ogre
   * (Large, 9, 10), Goblin Lurker (17, 11). The content box (rows 3–12) fits the strip above the
   * Game log at 0.72, but the map's top rows don't.
   */
  const V7_AMBUSH = {
    name: "Goblin Ambush (V7)",
    tokens: [
      tok(2, 7),
      tok(2, 9),
      tok(14, 4),
      tok(14, 7),
      tok(12, 8),
      tok(15, 8),
      tok(9, 10, "large"),
      tok(17, 11),
    ],
    pcs: [tok(2, 7), tok(2, 9)],
  };

  test("FR-MAP-44 BL-01 FOG step 26 at 1440×900 with the Game log: Goblin Ambush's top row under the top bar, PCs in the free area", () => {
    const { cam, map, view, free, under } = fit(V7_AMBUSH, sim6, [gameLog(sim6)]);
    // The strip above the log sets the scale (was row 0 at y −27.4 … 22.6, under the top bar).
    expect(free).toEqual({ x: 68, y: 48, w: 1372, h: 536 });
    expect(cam.floor).toBe(false);
    expect(cam.scale).toBeCloseTo(0.72);
    expect(map.h).toBeGreaterThan(free.h);
    expect(map.y).toBe(view.y);
    // Horizontally the map fits: centred in the work area right of the rail, as before.
    expect(map.x).toBeCloseTo(view.x + (view.w - map.w) / 2);
    // PCs in the free area; every token on the canvas above the dock, none under the log.
    const pcs = footprintBox(V7_AMBUSH.pcs, GRID);
    expect(pcs && inside(cam, pcs, free)).toBe(true);
    const tokens = footprintBox(V7_AMBUSH.tokens, GRID);
    if (!tokens) throw new Error("no tokens");
    expect(cam.y + (tokens.y + tokens.h) * cam.scale).toBeLessThanOrEqual(view.y + view.h);
    expect(under.length).toBe(0);
    // Log closed: unchanged, the whole map centred (row 0 at y 72).
    const open = fit(V7_AMBUSH, sim6, []);
    expect(open.map.y).toBeCloseTo(72);
  });

  test("FR-MAP-44 BL-01 FOG step 26 at 1280×720 and Town at both sizes: the top row under the top bar, PCs in the free area", () => {
    for (const scene of [V7_AMBUSH, SCENES[1] as (typeof SCENES)[number]]) {
      for (const vp of [sim6, laptop]) {
        for (const windows of [[], [gameLog(vp)]]) {
          const { cam, map, view, free } = fit(scene, vp, windows);
          const at = `${scene.name} ${vp.w}×${vp.h}${windows.length ? " Game log" : ""}`;
          expect({ at, topRowShows: map.y >= view.y }).toEqual({ at, topRowShows: true });
          // Taller than the work area (1280×720, the floor): the top row at the top bar.
          if (vp === laptop) expect({ at, top: map.y }).toEqual({ at, top: view.y });
          const pcs = footprintBox(scene.pcs, GRID);
          expect({ at, pcs: pcs && inside(cam, pcs, free) }).toEqual({ at, pcs: true });
        }
      }
    }
  });

  /**
   * FOG §13 step 26 re-test (V7, `vision-party`, DM): the client's own fitContent inputs.
   * Goblin Ambush tokens at their fixture cells, Thorn dragged to (4, 10); the floor case also
   * has Mira dragged to (2, 3). Before: row 0 at y −27.4 (0.72, Thorn would end under the Game
   * log with the top row pinned) and at y 1.4 (the floor).
   */
  const v7Retest = (mira: ReturnType<typeof tok>) => {
    const pcs = [mira, tok(4, 10)];
    const others = [
      tok(14, 4),
      tok(14, 6),
      tok(12, 8),
      tok(15, 8),
      tok(9, 10, "large"),
      tok(17, 11),
    ];
    return { name: "Goblin Ambush (V7 re-test)", tokens: [...pcs, ...others], pcs };
  };
  /** The PCs' footprints with their labels' lower half, screen px. */
  const pcsOnScreen = (cam: Camera, pcs: Box) => {
    const label = (labelMetrics(70, cam.scale).pillH * cam.scale) / 2;
    return {
      x0: cam.x + pcs.x * cam.scale,
      y0: cam.y + pcs.y * cam.scale,
      x1: cam.x + (pcs.x + pcs.w) * cam.scale,
      y1: cam.y + (pcs.y + pcs.h) * cam.scale + label,
    };
  };

  test("FR-MAP-44 BL-01 FOG step 26 re-test at 1440×900 with the Game log: Thorn at (4, 10) → zoomed out to keep the top row and the PCs in the free area", () => {
    for (const [mira, floor] of [
      [tok(2, 7), false],
      [tok(2, 3), true],
    ] as const) {
      const scene = v7Retest(mira);
      const { cam, map, view, free } = fit(scene, sim6, [gameLog(sim6)]);
      const at = `Mira (${mira.col}, ${mira.row})`;
      expect(free).toEqual({ x: 68, y: 48, w: 1372, h: 536 });
      expect({ at, top: map.y, floor: cam.floor }).toEqual({ at, top: view.y, floor });
      expect(70 * cam.scale).toBeGreaterThanOrEqual(FIT_MIN_CELL_PX - 1e-9);
      if (!floor) expect(cam.scale).toBeLessThan(0.72);
      const pcs = footprintBox(scene.pcs, GRID);
      if (!pcs) throw new Error("no PCs");
      const p = pcsOnScreen(cam, pcs);
      expect(p.y0).toBeGreaterThanOrEqual(free.y);
      expect(p.y1).toBeLessThanOrEqual(free.y + free.h + 1e-6);
      expect(p.x0).toBeGreaterThanOrEqual(free.x);
      expect(p.x1).toBeLessThanOrEqual(free.x + free.w);
    }
    // Same layout at 1280×720: the top row at the top bar (unchanged).
    const laptopFit = fit(v7Retest(tok(2, 7)), laptop, [gameLog(laptop)]);
    expect(laptopFit.map.y).toBe(laptopFit.view.y);
  });

  test("FR-MAP-46 the PC rule wins only where the PCs can't fit the free area with the top row pinned", () => {
    // PCs at rows 1 and 12: 12 rows at the 48 px floor never fit the 536 px strip below row 0.
    const scene = {
      name: "spread PCs",
      tokens: [tok(2, 1), tok(4, 12)],
      pcs: [tok(2, 1), tok(4, 12)],
    };
    const { cam, map, view } = fit(scene, sim6, [gameLog(sim6)]);
    expect(cam.floor).toBe(true);
    expect(map.y).toBeLessThan(view.y);
  });
});

describe("FR-MAP-44/45 camera triggers", () => {
  test("FR-MAP-44 triggers: scene open fits; appearance refits only while fitted", () => {
    expect(cameraOn("moved", "open")).toEqual({ mode: "fitted", fit: true });
    expect(cameraOn("fitted", "appearance")).toEqual({ mode: "fitted", fit: true });
    expect(cameraOn("moved", "appearance")).toEqual({ mode: "moved", fit: false });
  });

  test("FR-MAP-44 triggers: pan, wheel zoom and pull mark the camera moved; no refit after", () => {
    for (const e of ["pan", "zoom", "pull"] as const) {
      const after = cameraOn("fitted", e);
      expect(after).toEqual({ mode: "moved", fit: false });
      expect(cameraOn(after.mode, "appearance").fit).toBe(false);
    }
  });

  test("FR-MAP-45 fit button refits from moved (camera only: no live input, works while not live)", () => {
    expect(cameraOn("moved", "fit")).toEqual({ mode: "fitted", fit: true });
    expect(cameraOn(cameraOn("moved", "fit").mode, "appearance").fit).toBe(true);
  });
});

/** A fake clock: `advance(ms)` runs due timers in order. */
function fakeTimers() {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set(fn, ms) {
      next += 1;
      due.set(next, { at: now + ms, fn });
      return next;
    },
    clear: (h) => void due.delete(h as number),
  };
  const advance = (to: number) => {
    for (;;) {
      const [id, t] = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (id === undefined || !t || t.at > to) break;
      due.delete(id);
      now = t.at;
      t.fn();
    }
    now = to;
  };
  return { timers, advance, now: () => now };
}

describe("FR-MAP-90 no jump at Start", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const view = { w: 1440, h: 900 };

  test("FR-MAP-90 no jump at Start: every footprint inside the area and clear → the appearance keeps the camera; one under a window or outside the area → it refits", () => {
    const cam = { x: 300, y: 100, scale: 0.5 };
    // Footprints at (335, 135) and (440, 240) on screen, 35 px each.
    const tokens = [box(70, 70, 70, 70), box(280, 280, 70, 70)];
    expect(appearanceKeeps(cam, tokens, [box(1000, 60, 400, 500)], view)).toBe(true);
    // Initiative grown over the second one; or the first under the top bar.
    expect(appearanceKeeps(cam, tokens, [box(420, 200, 400, 500)], view)).toBe(false);
    expect(appearanceKeeps({ ...cam, y: 0 }, tokens, [], view)).toBe(false);
  });

  test("FR-MAP-90 no jump at Start: no PC-clear pan → pcsPan takes the least PC footprint area under the windows, at 48 px", () => {
    const area = box(84, 64, 1000, 500);
    // Two PCs side by side (96 px at 48 px cells) and a 60-px gap between two windows.
    const tokens = [
      { ...box(0, 0, 70, 70), pc: true },
      { ...box(70, 0, 70, 70), pc: true },
    ];
    const left = box(84, 64, 400, 500);
    const right = box(544, 64, 540, 500);
    const cam = pcsPan(tokens, [left, right], area, view, { x: 0, y: 0 }, 70);
    expect(cam).not.toBeNull();
    if (!cam) return;
    expect(cam.scale * 70).toBeCloseTo(FIT_MIN_CELL_PX, 9);
    const under = (c: Camera) =>
      tokens.reduce((n, t) => {
        const sx = c.x + t.x * c.scale;
        const sy = c.y + t.y * c.scale;
        const w = t.w * c.scale;
        const h = t.h * c.scale;
        const ov = (o: Box) =>
          Math.max(0, Math.min(sx + w, o.x + o.w) - Math.max(sx, o.x)) *
          Math.max(0, Math.min(sy + h, o.y + o.h) - Math.max(sy, o.y));
        return n + ov(left) + ov(right);
      }, 0);
    // 96 px of PCs in a 60-px gap: 36 × 48 px stays under a window, no pan does better.
    expect(under(cam)).toBeCloseTo(36 * 48, 6);
    for (let x = 300; x <= 700; x += 1) {
      expect(under({ ...cam, x })).toBeGreaterThanOrEqual(36 * 48 - 1e-6);
    }
  });
});

describe("FR-MAP-91 Fit with Scenes and a toast", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const vp = { w: 1440, h: 900 };
  const tokens = [
    { ...tok(2, 7), pc: true },
    { ...tok(4, 10), pc: true },
    { ...tok(12, 2), pc: false },
    { ...tok(17, 11), pc: false },
  ];
  const footprints = tokens.map((t) => footprintBox([t], GRID) as Box);
  const roomOf = (obstacles: Box[]) => {
    const areas = freeAreas(obstacles, vp);
    return { areas, obstacles, windowsOnly: areas };
  };
  const strip = box(560, 100, 320, 57);
  const windows = [box(68, 584, 1150, 240), box(1028, 60, 404, 512)];

  test("FR-MAP-91 Fit with Scenes and a toast: keeping a shown toast clear costs ≤ 25 % of the cell → the toast stays clear; more → the strip-only fit (fit-past-toasts)", () => {
    const stripOnly = roomOf([...windows, strip]);
    const plain = fitPastToasts(tokens, GRID, MAP, vp, stripOnly, stripOnly);
    expect(plain.pastToasts).toBe(false);
    expect(plain).toMatchObject(fitScene(tokens, GRID, MAP, vp, stripOnly));
    // A card at the home band: cheap to keep clear.
    const card = box(560, 100, 320, 86);
    const kept = fitPastToasts(tokens, GRID, MAP, vp, roomOf([...windows, strip, card]), stripOnly);
    expect(kept.pastToasts).toBe(false);
    expect(kept.scale).toBeGreaterThanOrEqual(FIT_PAST_TOASTS_SHARE * plain.scale - 1e-9);
    expect(allClear(kept, footprints, [card], visibleArea(vp))).toBe(true);
    // A tall stack down the middle (cards + roll popups): too costly, the strip-only fit wins.
    const stack = box(560, 100, 460, 470);
    const tall = roomOf([...windows, strip, stack]);
    expect(fitScene(tokens, GRID, MAP, vp, tall).scale).toBeLessThan(
      FIT_PAST_TOASTS_SHARE * plain.scale,
    );
    const past = fitPastToasts(tokens, GRID, MAP, vp, tall, stripOnly);
    expect(past.pastToasts).toBe(true);
    expect(past.scale).toBeCloseTo(plain.scale, 9);
  });
});

describe("FR-MAP-92 resize refit", () => {
  test("FR-MAP-92 resize refit: the refit waits for the windows' render fit to the new viewport (a frame, re-armed by each change), then reads the inputs once; moved → none", () => {
    const clock = fakeTimers();
    let queue: (() => void)[] = [];
    const frames = {
      request: (fn: () => void) => queue.push(fn),
      cancel: (h: unknown) => {
        queue[(h as number) - 1] = () => {};
      },
    };
    const tick = () => {
      const run = queue;
      queue = [];
      for (const fn of run) fn();
    };
    let mode: CameraMode = "fitted";
    // What the refit reads: the window rects as rendered (stale until the render fit applies).
    let rects = "1280×720";
    const seen: string[] = [];
    const settle = createAppearanceRefit(() => {
      if (mode === "fitted") seen.push(rects);
    }, frames);
    const r = createResizeRefit(
      () => {
        if (cameraOn(mode, "resize").fit) settle.appearance();
      },
      () => false,
      clock.timers,
    );
    r.resize();
    clock.advance(RESIZE_REFIT_MS);
    expect(seen).toEqual([]);
    // The render fit to 1440×900 and the grown heights reach the canvas before the frame.
    rects = "1440×900";
    settle.applied();
    tick();
    expect(seen).toEqual(["1440×900"]);
    // A moved camera: no refit.
    mode = cameraOn(mode, "pan").mode;
    r.resize();
    clock.advance(2 * RESIZE_REFIT_MS);
    tick();
    expect(seen).toEqual(["1440×900"]);
  });
});

describe("FR-MAP-47 resize refit", () => {
  /** A canvas stand-in: camera mode, a drag flag and the times it refitted. */
  function rig(mode: CameraMode = "fitted") {
    const clock = fakeTimers();
    const state = { mode, dragging: false, fits: [] as number[] };
    const r = createResizeRefit(
      () => {
        const next = cameraOn(state.mode, "resize");
        state.mode = next.mode;
        if (next.fit) state.fits.push(clock.now());
      },
      () => state.dragging,
      clock.timers,
    );
    return { clock, state, r };
  }

  test("FR-MAP-47 refit on resize only while fitted: events at 0 / 100 / 250 ms → one refit at 450 ms", () => {
    const { clock, state, r } = rig();
    r.resize();
    clock.advance(100);
    r.resize();
    clock.advance(250);
    r.resize();
    clock.advance(449);
    expect(state.fits).toEqual([]);
    clock.advance(2000);
    expect(state.fits).toEqual([250 + RESIZE_REFIT_MS]);
    expect(state.mode).toBe("fitted");
  });

  test("FR-MAP-47 refit on resize only while fitted: moved → no refit", () => {
    const { clock, state, r } = rig("moved");
    r.resize();
    clock.advance(1000);
    expect(state.fits).toEqual([]);
    expect(state.mode).toBe("moved");
    // A pan between the last resize event and the refit wins too.
    const b = rig();
    b.r.resize();
    b.clock.advance(100);
    b.state.mode = cameraOn(b.state.mode, "pan").mode;
    b.clock.advance(1000);
    expect(b.state.fits).toEqual([]);
  });

  test("FR-MAP-47 resize during a token drag refits after the drop", () => {
    const { clock, state, r } = rig();
    state.dragging = true;
    r.resize();
    clock.advance(1000);
    expect(state.fits).toEqual([]);
    state.dragging = false;
    clock.advance(1500);
    r.drop();
    expect(state.fits).toEqual([1500]);
    // Once only; a drop with nothing pending does nothing.
    r.drop();
    expect(state.fits).toEqual([1500]);
  });

  test("FR-MAP-47 window move → no refit (only viewport resize events refit)", () => {
    // Window moves, opens and closes reach the canvas as a new free area, never as `resize()`;
    // a drop with no resize pending does nothing either.
    const { clock, state, r } = rig();
    r.drop();
    clock.advance(1000);
    expect(state.fits).toEqual([]);
  });

  test("FR-MAP-47 dispose cancels a pending refit", () => {
    const { clock, state, r } = rig();
    r.resize();
    r.dispose();
    clock.advance(1000);
    expect(state.fits).toEqual([]);
  });
});

describe("FR-MAP-58 best free rectangle", () => {
  /** Player defaults (protocol §24) at 1280×800: Game log bottom-left, sheet top-right. */
  const vp = { w: 1280, h: 800 };
  const work = workArea(vp);
  const log = { x: 68, y: 444, w: 340, h: 280 };
  const sheet = { x: 948, y: 60, w: 320, h: 440 };
  /** Player Initiative where the default layout puts it (top-left, above the log). */
  const initiative = { x: 68, y: 60, w: 280, h: 372 };
  /** The sim-7 #3 player view of Goblin Ambush (session-sim): Mira, Goblin, Goblin 2, Thorn. */
  const ambush = VISIBLE;
  /** M9 (`map-tools`, after M4–M7): what Mira's player sees west of the fog line. */
  const crowd = [tok(6, 7), tok(3, 10), tok(4, 9), tok(5, 9), tok(4, 10, "large")];
  const pick = (
    tokens: ReturnType<typeof tok>[],
    pcTokens: typeof tokens,
    rects: Rect[],
    at: { w: number; h: number } = vp,
  ) => {
    const work = workArea(at);
    const box = contentBox(tokens, GRID, MAP);
    const area = freeArea(rects, at);
    const pcs = footprintBox(pcTokens, GRID);
    const footprints = tokens.flatMap((t) => footprintBox([t], GRID) ?? []);
    const rect = bestFreeRect(box, freeAreas(rects, at), area, MAP, work, {
      cell: 70,
      pcs,
      tokens: footprints,
    });
    const underAt = (cam: Camera) =>
      tokens.filter((t) => {
        const n = t.size === "large" ? 2 : 1;
        const c = {
          x: cam.x + (t.col + n / 2) * 70 * cam.scale,
          y: cam.y + (t.row + n / 2) * 70 * cam.scale,
        };
        return rects.some((r) => c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.h);
      });
    const cam = fitContent(box, rect, MAP, work, 70, pcs);
    const old = fitContent(box, area, MAP, work, 70, pcs);
    /** FR-MAP-58 before the fit priority: scale, then area, higher, left. */
    const byScale = bestFreeRect(box, freeAreas(rects, at), area, MAP, work);
    return { area, rect, cam, under: underAt(cam), old, byScale };
  };

  test("FR-MAP-58 best rectangle: the player at 1280×800 with sheet + Game log (sim-7 #3): the strip above the log fits at the larger scale but cuts the top rows, so the strip beside it wins (V7 fit priority)", () => {
    const { area, rect, cam, under, old, byScale } = pick(ambush, PCS, [log, sheet]);
    // By scale alone the strip above the log wins (the whole-map cap, below the floor here)…
    expect(byScale).toEqual({ x: 68, y: 48, w: 880, h: 396 });
    const above = fitContent(
      contentBox(ambush, GRID, MAP),
      byScale,
      MAP,
      work,
      70,
      footprintBox(PCS, GRID),
    );
    expect(above.y).toBeLessThan(48);
    // … but at the same 48 px cell the 540-px strip right of the log keeps the top row, the PCs
    // in it and no token centre under a window.
    expect(rect).toEqual(area);
    expect(rect).toEqual({ x: 408, y: 48, w: 540, h: 688 });
    expect(cam).toEqual(old);
    expect(70 * cam.scale).toBeCloseTo(FIT_MIN_CELL_PX);
    expect(cam.y).toBeGreaterThanOrEqual(48);
    expect(under).toEqual([]);
  });

  test("FR-MAP-58 best rectangle: M9 (sheet + Initiative + Game log) → a candidate rectangle with no token centre under a window", () => {
    const rects = [log, sheet, initiative];
    const { rect, under } = pick(crowd, [tok(6, 7), tok(3, 10)], rects);
    expect(freeAreas(rects, vp)).toContainEqual(rect);
    expect(under).toEqual([]);
  });

  test("FR-MAP-58 best rectangle: the DM at 1280×720 with Game log + Initiative keeps the top row and the ogres clear of the log (V7 fit priority before scale)", () => {
    // M5 walkthrough, `map-tools` Goblin Ambush (DM: hidden Wolf and Elite too); PCs Mira, Thorn.
    const laptop = { w: 1280, h: 720 };
    const pcs = [tok(2, 7), tok(2, 9)];
    const ambush = [
      ...pcs,
      tok(12, 6),
      tok(14, 4),
      tok(15, 8),
      tok(9, 10, "large"),
      tok(12, 8),
      tok(17, 11),
      tok(4, 9),
      tok(5, 9),
      tok(4, 10, "large"),
    ];
    const rects = [
      defaultRect({ anchor: "bottom-left", dx: 56 }, { w: 460, h: 240 }, laptop),
      defaultRect({ anchor: "top-right" }, { w: 400, h: 500 }, laptop),
    ];
    const { rect, cam, under, byScale } = pick(ambush, pcs, rects, laptop);
    // Before: the wide strip above the log won the tie at the floor on area, so the map's top
    // edge sat at y −92 and the Cave Ogre and Crypt Ogre under the Game log.
    expect(byScale).toEqual({ x: 68, y: 48, w: 800, h: 356 });
    // Now: the narrower strip between the log and Initiative, same 48 px cell.
    expect(rect).toEqual({ x: 528, y: 48, w: 340, h: 608 });
    expect(70 * cam.scale).toBeCloseTo(FIT_MIN_CELL_PX);
    expect(cam.y).toBeGreaterThanOrEqual(48);
    const p = footprintBox(pcs, GRID);
    if (!p) throw new Error("no PCs");
    expect(cam.x + p.x * cam.scale).toBeGreaterThanOrEqual(rect.x);
    expect(cam.x + (p.x + p.w) * cam.scale).toBeLessThanOrEqual(rect.x + rect.w);
    // Last in the priority: the four tokens east of col 11 sit under Initiative; the ogres
    // (Cave (9, 10), Crypt (4, 10)) stay clear of the Game log.
    expect(under).toEqual([tok(12, 6), tok(14, 4), tok(15, 8), tok(12, 8)]);
  });

  test("FR-MAP-58 best rectangle: ties on scale → the larger area, then the higher, then the more left one; none → the free area", () => {
    const box = contentBox([tok(10, 7)], GRID, MAP);
    const small = { x: 68, y: 48, w: 600, h: 500 };
    const big = { x: 700, y: 48, w: 700, h: 600 };
    // One token: the whole-map cap sets the scale in both → the larger one.
    expect(bestFreeRect(box, [small, big], small, MAP, work)).toEqual(big);
    const low = { x: 68, y: 300, w: 600, h: 500 };
    const right = { x: 700, y: 48, w: 600, h: 500 };
    expect(bestFreeRect(box, [low, right, small], small, MAP, work)).toEqual(small);
    expect(bestFreeRect(box, [right, low], right, MAP, work)).toEqual(right);
    // No candidates, or FR-SHELL-34's small-area fallback (not a candidate): the free area.
    expect(bestFreeRect(box, [], small, MAP, work)).toEqual(small);
    const rail = { x: 68, y: 48, w: 1212, h: 688 };
    expect(bestFreeRect(box, [small], rail, MAP, work)).toEqual(rail);
  });

  test("FR-MAP-58 then FR-MAP-46 inside the picked rectangle: at the floor the PCs stay in it", () => {
    // PCs far apart: no candidate fits above the floor; the PC rule applies in the pick.
    const spread = [tok(2, 2), tok(17, 2), tok(9, 11)];
    const box = contentBox(spread, GRID, MAP);
    const rect = bestFreeRect(
      box,
      freeAreas([log, sheet], vp),
      freeArea([log, sheet], vp),
      MAP,
      work,
    );
    const pcs = footprintBox([tok(2, 2)], GRID);
    const cam = fitContent(box, rect, MAP, work, 70, pcs);
    expect(cam.floor).toBe(true);
    if (!pcs) throw new Error("no PCs");
    expect(inside(cam, pcs, rect)).toBe(true);
  });
});

describe("FR-MAP-59 every token visible (fitVisible)", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

  test("FR-MAP-59 every token visible: step 1 already clear → step 1 unchanged (no needless shrink)", () => {
    const from = { x: 100, y: 80, scale: 1 };
    const tokens = [box(0, 0, 70, 70), box(140, 70, 70, 70)];
    const area = box(84, 64, 1000, 600);
    const obstacles = [box(600, 64, 300, 300)];
    expect(fitVisible(tokens, obstacles, area, from, 70)).toEqual({ ...from, visible: "all" });
  });

  test("FR-MAP-59 every token visible: a pocket bounded by edges of two different forbidden rectangles is found (review #16)", () => {
    // One 50-px token at scale 1; two windows in an L. Step 1's pan (10, 10) is under both.
    // Forbidden pans: (−50, 100) × (−50, 50) and (−50, 50) × (−50, 100); the nearest allowed
    // pan is the L's inner corner: x from the second rectangle, y from the first.
    const tokens = [box(0, 0, 50, 50)];
    const obstacles = [box(0, 0, 100, 50), box(0, 0, 50, 100)];
    const area = box(0, 0, 250, 250);
    const from = { x: 10, y: 10, scale: 1 };
    expect(fitVisible(tokens, obstacles, area, from, 50)).toEqual({
      x: 50,
      y: 50,
      scale: 1,
      visible: "all",
    });
  });

  /**
   * A feasibility gap: tokens in cols 0 and 4 of a 100-px grid, a full-height window 144 px wide
   * at x 200, the area 394 px wide. The window fits between the tokens (3 cells ≥ 144 px) from
   * 48 to 50 px; right of both tokens only up to 40 px (5 cells ≤ 200 px). So: allowed at 40,
   * not at 44, allowed at 48 (and 49, 50), not at 51.
   */
  const gap = {
    tokens: [box(0, 0, 100, 100), box(400, 0, 100, 100)],
    obstacles: [box(200, 0, 144, 1000)],
    area: box(0, 0, 394, 1000),
  };

  test("FR-MAP-59 every token visible: feasibility gap (allowed at 40, not at 44, allowed at 48): from 60 px → 48 is the first 4-px step allowed, refined to 50 (51 not allowed)", () => {
    const { tokens, obstacles, area } = gap;
    // 60, 56, 52 → none; 48 → allowed; refine 51 (no), 50 (yes): the largest allowed wins.
    expect(fitVisible(tokens, obstacles, area, { x: 0, y: 0, scale: 0.6 }, 100)).toEqual({
      x: 144,
      y: 0,
      scale: 0.5,
      visible: "all",
    });
  });

  test("FR-MAP-59 every token visible: feasibility gap from 44 px → 40 (44 not allowed; the method never steps back up to 48)", () => {
    const { tokens, obstacles, area } = gap;
    expect(fitVisible(tokens, obstacles, area, { x: 0, y: 0, scale: 0.44 }, 100)).toEqual({
      x: 0,
      y: 0,
      scale: 0.4,
      visible: "all",
    });
  });

  test("FR-MAP-59 every token visible: the map's top row stays at or below the top bar (FR-MAP-44): a clear step 1 above it searches; the nearest pan above it is out of range", () => {
    // Step 1 (y 4) clears the window but cuts the map's top row: the search keeps y ≥ 48.
    const tokens = [box(0, 140, 70, 70)];
    const area = box(0, 0, 1000, 600);
    const obstacles = [box(0, 300, 1000, 300)];
    const from = { x: 100, y: 4, scale: 1 };
    expect(fitVisible(tokens, obstacles, area, from, 70)).toEqual({ ...from, visible: "all" });
    const r = fitVisible(tokens, obstacles, area, from, 70, 48);
    expect(r).toEqual({ x: 100, y: 48, scale: 1, visible: "all" });
    // A token pushed up against the bound: nothing allowed at any scale → pcs.
    const low = [box(0, 0, 70, 70), box(0, 840, 70, 70)];
    const stuck = fitVisible(low, [box(0, 200, 1000, 400)], area, from, 70, 48);
    expect(stuck).toEqual({ ...from, visible: "pcs" });
  });

  test("FR-MAP-59 every token visible: a token boxed in by windows at every scale → pcs = step 1's result", () => {
    const tokens = [box(0, 0, 70, 70), box(700, 0, 70, 70)];
    const area = box(84, 64, 1000, 600);
    // A window across the middle of the area: the two tokens (10 cells apart) never both clear it.
    const obstacles = [box(300, 64, 600, 600)];
    const from = { x: 100, y: 100, scale: 48 / 70 };
    expect(fitVisible(tokens, obstacles, area, from, 70)).toEqual({ ...from, visible: "pcs" });
  });

  test("FR-MAP-59 every token visible: more than 30 tokens or 6 obstacles reaching the pan range → pcs without search", () => {
    const area = box(0, 0, 1000, 600);
    const from = { x: 0, y: 0, scale: 1 };
    // Token 0 under a small window at step 1; a short pan clears it.
    const tokens = (n: number) =>
      Array.from({ length: n }, (_, i) => box((i % 10) * 20, Math.floor(i / 10) * 20, 10, 10));
    const blocker = box(5, 0, 10, 10);
    const windows = (n: number) =>
      Array.from({ length: n }, (_, i) => box(500, 300 + i * 10, 5, 5));
    expect(fitVisible(tokens(30), [blocker], area, from, 30).visible).toBe("all");
    expect(fitVisible(tokens(31), [blocker], area, from, 30)).toEqual({ ...from, visible: "pcs" });
    expect(fitVisible(tokens(1), [blocker, ...windows(5)], area, from, 30).visible).toBe("all");
    const seven = [blocker, ...windows(6)];
    expect(fitVisible(tokens(1), seven, area, from, 30)).toEqual({ ...from, visible: "pcs" });
    // Windows outside the area don't count toward the bound.
    const outside = Array.from({ length: 6 }, (_, i) => box(2000 + i * 10, 0, 5, 5));
    expect(fitVisible(tokens(1), [blocker, ...outside], area, from, 30).visible).toBe("all");
    // FR-MAP-90: nor do windows in the area that no token can reach at that scale (the map's top
    // edge stays at or below `minY` = 0, so nothing is drawn above y 0).
    const tall = box(0, -60, 1000, 660);
    const high = Array.from({ length: 6 }, (_, i) => box(100 + i * 100, -40, 5, 5));
    expect(fitVisible(tokens(1), [blocker, ...high], tall, from, 30, 0).visible).toBe("all");
  });

  test("FR-MAP-59 every token visible: determinism (same input → same camera; window order doesn't matter)", () => {
    const tokens = [box(0, 0, 70, 70), box(350, 140, 70, 70), box(700, 420, 140, 140)];
    const area = box(84, 64, 1196, 592);
    const obstacles = [box(68, 484, 690, 160), box(868, 60, 400, 500), box(462, 100, 356, 238)];
    const from = { x: 200, y: 70, scale: 48 / 70 };
    const a = fitVisible(tokens, obstacles, area, from, 70);
    expect(fitVisible(tokens, obstacles, area, from, 70)).toEqual(a);
    expect(fitVisible(tokens, [...obstacles].reverse(), area, from, 70)).toEqual(a);
    expect(a.visible).toBe("all");
    expect(allClear(a, tokens, obstacles, area)).toBe(true);
    const cell = a.scale * 70;
    expect(Math.abs(cell - Math.round(cell))).toBeLessThan(1e-9);
  });

  test("FR-MAP-59 every token visible: fitScene with nothing in the way = today's fit (fitContent)", () => {
    const vp = { w: 1440, h: 900 };
    const tokens = [
      { ...tok(2, 7), pc: true },
      { ...tok(12, 6), pc: false },
    ];
    const areas = freeAreas([], vp);
    const room = { areas, obstacles: [], windowsOnly: areas };
    const fit = fitScene(tokens, GRID, MAP, vp, room);
    const pcs = footprintBox([tok(2, 7)], GRID);
    const rect = areas[0] as Rect;
    const today = fitContent(contentBox(tokens, GRID, MAP), rect, MAP, workArea(vp), 70, pcs);
    expect({ x: fit.x, y: fit.y, scale: fit.scale, floor: fit.floor }).toEqual(today);
    expect(fit.visible).toBe("all");
  });
});

describe("FR-MAP-81 pcs keeps the top row (pcsPan)", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const at = (col: number, row: number, pc = false) => ({ ...box(col * 70, row * 70, 70, 70), pc });
  const view = { w: 1280, h: 720 };
  const area = box(84, 64, 1000, 500);
  /** Screen rect of a footprint (map px) at `cam`. */
  const screen = (cam: Camera, b: Box) => ({
    x: cam.x + b.x * cam.scale,
    y: cam.y + b.y * cam.scale,
    w: b.w * cam.scale,
    h: b.h * cam.scale,
  });
  const cutByTop = (cam: Camera, b: Box) => {
    const s = screen(cam, b);
    return s.y < area.y - 1e-6 && s.y + s.h > 0 && s.x + s.w > 0 && s.x < view.w;
  };

  test("FR-MAP-81 pcs keeps the top row: a cut-free pan exists → no footprint above the area's top, the PC inside; the scale is 48 px", () => {
    // A token on row 0, the PC on row 4: from (y 20) cuts the token; y 64 draws it whole.
    const tokens = [at(0, 0), at(0, 4, true)];
    const from = { x: 84, y: 20 };
    const cam = pcsPan(tokens, [], area, view, from, 70);
    expect(cam).not.toBeNull();
    if (!cam) return;
    expect(cam.scale * 70).toBeCloseTo(FIT_MIN_CELL_PX, 9);
    expect(tokens.some((t) => cutByTop(cam, t))).toBe(false);
    expect(allClear(cam, tokens, [], area)).toBe(true);
    expect({ x: cam.x, y: cam.y }).toEqual({ x: 84, y: 64 });
  });

  test("FR-MAP-81 pcs keeps the top row: only a top-cutting pan keeps the PC clear → that pan (rule (1) yields)", () => {
    // The PC on row 10 (screen y = cam.y + 480); a full-width window down to y 480 leaves the PC
    // clear only for cam.y ≥ 0, and inside the area only for cam.y ≤ 36: the row-0 token is cut.
    const tokens = [at(0, 0), at(0, 10, true)];
    const wall = box(84, 64, 1000, 416);
    const from = { x: 84, y: -100 };
    const cam = pcsPan(tokens, [wall], area, view, from, 70);
    expect(cam).not.toBeNull();
    if (!cam) return;
    // FR-MAP-93: both cut the top row, so the PC keeps its 4-px margin below the window.
    expect(cam.y).toBeCloseTo(4, 2);
    expect(cutByTop(cam, tokens[0] as Box)).toBe(true);
    expect(allClear(cam, [tokens[1] as Box], [wall], area)).toBe(true);
    // FR-MAP-90: no pan keeps the PC clear (the wall leaves 30 px below it) → the least PC area
    // under it: the PC's bottom on the area's bottom (screen y 516–564, 18 px under the wall).
    const low = box(84, 64, 1000, 470);
    const least = pcsPan(tokens, [low], area, view, from, 70);
    expect(least && { y: least.y, cell: Math.round(least.scale * 70) }).toEqual({
      y: 36,
      cell: 48,
    });
    expect(pcsPan([at(0, 0)], [], area, view, from, 70)).toBeNull(); // no PC
  });

  test("FR-MAP-81 pcs keeps the top row: bounded inputs — 40 tokens → only the PCs + the 30 nearest enter the sweep", () => {
    // PCs at (2, 0), (3, 0); 30 tokens fill cols 2–9 × rows 0–3; 8 far ones on cols 20–27 row 0.
    // At `from` all 32 near ones show and no far one; a pan 56 px left would show 2 far ones.
    const pcs = [at(2, 0, true), at(3, 0, true)];
    const near = [];
    for (let row = 0; row < 4; row++)
      for (let col = 2; col < 10; col++) if (row > 0 || col > 3) near.push(at(col, row));
    expect(near.length).toBe(PCS_PAN_MAX_TOKENS);
    const far = Array.from({ length: 8 }, (_, i) => at(20 + i, 0));
    const from = { x: 84, y: 64 };
    const cam = pcsPan([...far, ...near, ...pcs], [], area, view, from, 70);
    expect(cam && { x: cam.x, y: cam.y }).toEqual(from);
    // The far ones would move the pan if they counted: 56 px left (the nearest pan showing 2).
    const unbounded = pcsPan([...pcs, ...far], [], area, view, from, 70);
    expect(unbounded?.x).toBe(28);
  });

  test("FR-MAP-90 no jump at Start: pcsPan past 6 obstacles takes the 6 nearest the PCs' box (was null: FR-MAP-46's centring)", () => {
    const tokens = [at(0, 0), at(0, 4, true)];
    const from = { x: 84, y: 20 };
    // The PC at (84, 212)–(132, 260) on screen; small obstacles further and further right.
    const small = (n: number) =>
      Array.from({ length: n }, (_, i) => box(140 + i * 20, 230, 10, 10));
    const six = pcsPan(tokens, small(6), area, view, from, 70);
    expect(six).not.toBeNull();
    const seven = pcsPan(tokens, small(7), area, view, from, 70);
    expect(seven).not.toBeNull();
    // The farthest one is left out: the same pan as with the 6 nearest, in any order.
    expect(seven).toEqual(six);
    expect(pcsPan(tokens, [...small(7)].reverse(), area, view, from, 70)).toEqual(six);
    // Obstacles outside the area don't count.
    const outside = Array.from({ length: 7 }, (_, i) => box(2000 + i * 20, 0, 10, 10));
    expect(pcsPan(tokens, outside, area, view, from, 70)).not.toBeNull();
  });

  test("FR-MAP-81 pcs keeps the top row: determinism (same input → same camera; obstacle and token order don't matter)", () => {
    const tokens = [at(0, 0), at(4, 1), at(2, 5, true), at(6, 6, true), at(9, 2), at(12, 8)];
    const obstacles = [box(68, 484, 690, 160), box(868, 60, 400, 500), box(480, 100, 320, 57)];
    const a = pcsPan(tokens, obstacles, area, view, { x: 100, y: 30 }, 70);
    expect(a).not.toBeNull();
    expect(pcsPan(tokens, obstacles, area, view, { x: 100, y: 30 }, 70)).toEqual(a);
    expect(
      pcsPan([...tokens].reverse(), [...obstacles].reverse(), area, view, { x: 100, y: 30 }, 70),
    ).toEqual(a);
  });

  test("FR-MAP-81 pcs keeps the top row: fitScene ends pcs (31 tokens, past FR-MAP-59's bound) → the pcsPan camera at 48 px (data-fit-floor), the PC clear, the top row whole below the top bar", () => {
    const vp = { w: 1280, h: 720 };
    // The PC in the middle; rows 0 and 13 (cols 0–9) and col 19 (rows 1–10): 14 rows at 48 px
    // don't fit 720 px, so step 1 (at the floor) leaves tokens off-screen.
    const tokens = [
      { ...tok(10, 7), pc: true },
      ...Array.from({ length: 10 }, (_, c) => ({ ...tok(c, 0), pc: false })),
      ...Array.from({ length: 10 }, (_, c) => ({ ...tok(c, 13), pc: false })),
      ...Array.from({ length: 10 }, (_, r) => ({ ...tok(19, r + 1), pc: false })),
    ];
    const areas = freeAreas([], vp);
    const room = { areas, obstacles: [], windowsOnly: areas };
    const fit = fitScene(tokens, GRID, MAP, vp, room);
    expect(fit.visible).toBe("pcs");
    expect(fit.scale * 70).toBeCloseTo(FIT_MIN_CELL_PX, 9);
    expect(fit.floor).toBe(true);
    const pc = footprintBox([tok(10, 7)], GRID) as Box;
    expect(allClear(fit, [pc], [], visibleArea(vp))).toBe(true);
    const top = footprintBox([tok(0, 0)], GRID) as Box;
    expect(screen(fit, top).y).toBeGreaterThanOrEqual(TOP_BAR_H + FIT_MARGIN - 1e-6);
  });
});

describe("FR-MAP-82 reveal refit", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  /** Player at 1280×800: the sheet (948, 60, 320 × 418) and the toast corner as obstacles. */
  const area = box(84, 64, 1180, 656);
  const sheet = box(948, 60, 320, 418);
  const obstacles = [sheet];
  const cam = { x: 84, y: 64, scale: 1 };
  const drawn = (id: string, x: number, y: number) => ({ id, box: box(x, y, 70, 70) });
  const before = [drawn("mira", 0, 0), drawn("thorn", 140, 0)];
  const seen = new Set(before.map((t) => t.id));

  /** A player canvas stand-in: the camera mode, the fits it ran (clock ms), the reveal timing. */
  function rig(mode: CameraMode = "fitted") {
    const clock = fakeTimers();
    const state = { mode, fits: [] as number[] };
    const r = createRevealRefit(() => {
      const next = cameraOn(state.mode, "reveal");
      state.mode = next.mode;
      if (next.fit) state.fits.push(clock.now());
    }, clock.timers);
    /** A frame drew `next`: the trigger, then the timing (as MapCanvas does). */
    const frame = (next: readonly { id: string; box: Box }[], prev = seen) => {
      if (revealRefit(prev, next, cam, obstacles, area, state.mode)) r.reveal();
    };
    /** A pan or zoom gesture starts: moved now, the pending refit cancelled. */
    const gesture = (e: "pan" | "zoom") => {
      r.gesture();
      state.mode = cameraOn(state.mode, e).mode;
    };
    return { clock, state, r, frame, gesture };
  }

  test("FR-MAP-82 reveal refit: a new token under the sheet while fitted → one refit, the camera stays fitted; a new token on screen and clear → none", () => {
    // Goblin at map x 900 → screen 984: under the sheet.
    expect(
      revealRefit(seen, [...before, drawn("goblin", 900, 100)], cam, obstacles, area, "fitted"),
    ).toBe(true);
    // Off-screen (right of the area) counts too.
    expect(
      revealRefit(seen, [...before, drawn("ogre", 1400, 500)], cam, obstacles, area, "fitted"),
    ).toBe(true);
    // On screen, clear of every obstacle.
    expect(
      revealRefit(seen, [...before, drawn("wolf", 300, 300)], cam, obstacles, area, "fitted"),
    ).toBe(false);
    const { clock, state, frame } = rig();
    frame([...before, drawn("goblin", 900, 100)]);
    expect(state.fits).toEqual([]);
    clock.advance(REVEAL_REFIT_MS);
    expect(state.fits).toEqual([REVEAL_REFIT_MS]);
    expect(state.mode).toBe("fitted");
    clock.advance(5000);
    expect(state.fits.length).toBe(1);
  });

  test("FR-MAP-82 reveal refit: moved → none; a token leaving sight, moving or already drawn → none", () => {
    expect(
      revealRefit(seen, [...before, drawn("goblin", 900, 100)], cam, obstacles, area, "moved"),
    ).toBe(false);
    // Thorn leaves sight.
    expect(revealRefit(seen, [drawn("mira", 0, 0)], cam, obstacles, area, "fitted")).toBe(false);
    // Thorn moves under the sheet: already drawn.
    expect(
      revealRefit(
        seen,
        [drawn("mira", 0, 0), drawn("thorn", 900, 0)],
        cam,
        obstacles,
        area,
        "fitted",
      ),
    ).toBe(false);
  });

  test("FR-MAP-82 reveal refit: a sight change that redraws the tokens already drawn (Blinded, party vision on / off, a new vision polygon) → none, whatever the camera", () => {
    const { clock, state, frame } = rig();
    // The same ids, every frame: only the fog / vision changed.
    for (let i = 0; i < 5; i++) frame(before);
    // Even with one of them now under the sheet (e.g. the sheet grew): already drawn.
    frame([drawn("mira", 0, 0), drawn("thorn", 900, 100)]);
    clock.advance(10_000);
    expect(state.fits).toEqual([]);
  });

  test("FR-MAP-82 reveal refit: two reveals 300 ms apart → one refit (the last frame's content)", () => {
    const { clock, state, frame } = rig();
    frame([...before, drawn("goblin", 900, 100)]);
    clock.advance(300);
    const later = new Set([...seen, "goblin"]);
    frame([...before, drawn("goblin", 900, 100), drawn("goblin-2", 950, 200)], later);
    clock.advance(5000);
    expect(state.fits).toEqual([REVEAL_REFIT_MS]);
  });

  test("FR-MAP-82 reveal refit: a reconnect snapshot that brings tokens into sight → one refit; a plain reconnect (the same tokens) → none", () => {
    const { clock, state, frame } = rig();
    frame(before);
    clock.advance(5000);
    expect(state.fits).toEqual([]);
    // The snapshot after a reconnect holds 3 tokens never drawn: one reveal.
    frame([...before, drawn("a", 900, 100), drawn("b", 950, 200), drawn("c", 1000, 300)]);
    clock.advance(10_000);
    expect(state.fits).toEqual([5000 + REVEAL_REFIT_MS]);
  });

  test("FR-MAP-82 reveal refit: a token drag in progress → deferred to the drop; a token pointer-down while one is pending → cancelled, re-armed at pointer-up, the camera stays fitted", () => {
    // A reveal mid-drag waits for the drop.
    const a = rig();
    a.r.press();
    a.frame([...before, drawn("goblin", 900, 100)]);
    a.clock.advance(5000);
    expect(a.state.fits).toEqual([]);
    a.r.release();
    a.clock.advance(5000 + REVEAL_REFIT_MS);
    expect(a.state.fits).toEqual([5000 + REVEAL_REFIT_MS]);
    // A press while a refit is pending cancels it; the release re-arms it.
    const b = rig();
    b.frame([...before, drawn("goblin", 900, 100)]);
    b.clock.advance(500);
    b.r.press();
    expect(b.r.pending).toBe(true);
    b.clock.advance(2000);
    expect(b.state.fits).toEqual([]);
    b.r.release();
    b.clock.advance(2000 + REVEAL_REFIT_MS);
    expect(b.state.fits).toEqual([2000 + REVEAL_REFIT_MS]);
    expect(b.state.mode).toBe("fitted");
    // A release with nothing deferred arms nothing.
    b.r.press();
    b.r.release();
    expect(b.r.pending).toBe(false);
  });

  test("FR-MAP-82 reveal refit: a pan pointer-down or a wheel inside the 1-s window → the pending refit cancelled and moved from the gesture's start; a reveal mid-pan → none", () => {
    for (const e of ["pan", "zoom"] as const) {
      const { clock, state, r, frame, gesture } = rig();
      frame([...before, drawn("goblin", 900, 100)]);
      clock.advance(400);
      expect(r.pending).toBe(true);
      gesture(e);
      expect(state.mode).toBe("moved");
      expect(r.pending).toBe(false);
      // A reveal arriving mid-pan (the camera already moved) → nothing armed.
      frame(
        [...before, drawn("goblin", 900, 100), drawn("wolf", 1000, 300)],
        new Set([...seen, "goblin"]),
      );
      expect(r.pending).toBe(false);
      clock.advance(5000);
      expect({ e, fits: state.fits }).toEqual({ e, fits: [] });
    }
  });

  test("FR-MAP-82 reveal refit: players only (the DM client never refits on reveals); cameraOn('reveal') refits only while fitted", () => {
    expect(refitsOnReveal("player")).toBe(true);
    expect(refitsOnReveal("dm")).toBe(false);
    expect(cameraOn("fitted", "reveal")).toEqual({ mode: "fitted", fit: true });
    expect(cameraOn("moved", "reveal")).toEqual({ mode: "moved", fit: false });
  });

  test("FR-MAP-82 reveal refit: dispose cancels a pending refit", () => {
    const { clock, state, r, frame } = rig();
    frame([...before, drawn("goblin", 900, 100)]);
    r.dispose();
    clock.advance(5000);
    expect(state.fits).toEqual([]);
  });
});

describe("FR-MAP-61 appearance refit", () => {
  /** Fake animation frames: `tick()` runs the callbacks queued so far. */
  function fakeFrames() {
    let queue = new Map<number, () => void>();
    let next = 1;
    return {
      request: (fn: () => void) => {
        queue.set(next, fn);
        return next++;
      },
      cancel: (h: unknown) => {
        queue.delete(h as number);
      },
      tick() {
        const run = [...queue.values()];
        queue = new Map();
        for (const fn of run) fn();
      },
      pending: () => queue.size,
    };
  }

  test("FR-MAP-61 appearance refit: a frame that starts an encounter and creates a visible token while fitted → the refit's content includes it", () => {
    const frames = fakeFrames();
    // The canvas's inputs as the refit reads them; Start's token reaches the canvas after the
    // availability tick that counted the appearance.
    let tokens = [tok(2, 7), tok(12, 6)];
    const ogre = tok(18, 6, "large");
    const boxes: Box[] = [];
    const refit = createAppearanceRefit(() => boxes.push(contentBox(tokens, GRID, MAP)), frames);
    refit.appearance();
    tokens = [...tokens, ogre];
    refit.applied();
    frames.tick();
    expect(boxes).toEqual([contentBox([tok(2, 7), tok(12, 6), ogre], GRID, MAP)]);
    // The ogre's cols 18–19 (+ the 1-cell pad, cut at the map) are in the content box.
    expect((boxes[0]?.x ?? 0) + (boxes[0]?.w ?? 0)).toBe(MAP.w);
    expect(frames.pending()).toBe(0);
  });

  test("FR-MAP-61 appearance refit: one refit per appearance; changes with nothing pending don't refit; waits are capped", () => {
    const frames = fakeFrames();
    let runs = 0;
    const refit = createAppearanceRefit(() => {
      runs += 1;
    }, frames);
    refit.applied();
    frames.tick();
    expect(runs).toBe(0);
    refit.appearance();
    refit.applied();
    refit.applied();
    frames.tick();
    expect(runs).toBe(1);
    // A canvas that never settles: the refit still runs after the capped waits.
    refit.appearance();
    for (let i = 0; i < APPEARANCE_REFIT_MAX_WAITS; i++) {
      refit.applied();
      expect(runs).toBe(1);
    }
    refit.applied(); // over the cap: no more waiting
    frames.tick();
    expect(runs).toBe(2);
    refit.appearance();
    refit.dispose();
    frames.tick();
    expect(runs).toBe(2);
  });

  test("FR-MAP-61 appearance refit: a moved camera never refits", () => {
    expect(cameraOn("moved", "appearance")).toEqual({ mode: "moved", fit: false });
    expect(cameraOn("fitted", "appearance")).toEqual({ mode: "fitted", fit: true });
  });
});
