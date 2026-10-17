import { describe, expect, test } from "bun:test";
import type { TokenSize } from "@shared/scenes-map/schemas";
import { freeArea } from "../play-shell/free-area";
import { defaultRect, type Rect, workArea } from "../play-shell/geometry";
import {
  type Box,
  type Camera,
  type CameraMode,
  cameraOn,
  contentBox,
  createResizeRefit,
  FIT_MARGIN,
  FIT_MIN_CELL_PX,
  fitCamera,
  fitContent,
  footprintBox,
  RESIZE_REFIT_MS,
  type Timers,
  ZOOM_MAX,
} from "./camera";

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
