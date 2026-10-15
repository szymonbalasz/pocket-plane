import { describe, expect, test } from "bun:test";
import type { TokenSize } from "@shared/scenes-map/schemas";
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
    // One token: that zoom, centred in the free area.
    expect(cam.scale).toBe(cap);
    expect(cam.x + (one.x + one.w / 2) * cam.scale).toBeCloseTo(68 + 1372 / 2);
    expect(cam.y + (one.y + one.h / 2) * cam.scale).toBeCloseTo(48 + 788 / 2);
    // Pre-R1 the scene opened at the viewport fit: never zoom in beyond that either.
    expect(cam.scale).toBeLessThanOrEqual(fitCamera(MAP, { w: 1440, h: 900 }).scale);
  });

  test("FR-MAP-44 fit: the box fills the free area minus 16 px, centred", () => {
    const free = { x: 68, y: 48, w: 840, h: 500 };
    const box = contentBox([...VISIBLE, ...HIDDEN], GRID, MAP);
    const cam = fitContent(box, free, MAP, work, 70, null);
    expect(cam.scale).toBeCloseTo((840 - 2 * FIT_MARGIN) / box.w);
    const left = cam.x + box.x * cam.scale;
    const right = cam.x + (box.x + box.w) * cam.scale;
    expect(left).toBeCloseTo(68 + FIT_MARGIN);
    expect(right).toBeCloseTo(68 + 840 - FIT_MARGIN);
    const top = cam.y + box.y * cam.scale;
    const bottom = cam.y + (box.y + box.h) * cam.scale;
    expect(top - 48).toBeCloseTo(48 + 500 - bottom);
  });
});

describe("FR-MAP-46 fit floor", () => {
  const work = { w: 1280, h: 608 };
  /** The DM free area at 1280×720, default layout (Initiative top-right, Game log bottom-left). */
  const free = { x: 68, y: 48, w: 800, h: 356 };
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
    expect(cam.x + (box.x + box.w / 2) * cam.scale).toBeCloseTo(68 + 1372 / 2);
  });

  test("FR-MAP-46 the floor beats the whole-map cap (one token, box fits): centred at 48 px", () => {
    const one = contentBox([tok(10, 7)], GRID, MAP);
    expect(fitCamera(MAP, work).scale * 70).toBeLessThan(FIT_MIN_CELL_PX);
    const cam = fitContent(one, free, MAP, work, 70, null);
    expect(cam.floor).toBe(true);
    expect(cam.scale * 70).toBeCloseTo(FIT_MIN_CELL_PX);
    expect(cam.x + (one.x + one.w / 2) * cam.scale).toBeCloseTo(68 + 800 / 2);
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
