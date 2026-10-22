// Sprint 8 WF3 (scenes-map FR-MAP-93, -95, -96, -98): the refits after the placer. One obstacle
// source and one PC test, one fit path, and the load / Start / resize refits waiting for the
// placer's settle. Pure: the fit on `session-sim-11`'s cells, the settled-refit timing on fake frames.
import { describe, expect, test } from "bun:test";
import { fitObstacles, fitRooms, grownAll } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import { keepOuts, TOASTS_KEEP_OUT } from "@ui/features/play-shell/keep-outs";
import { PC_MARGIN, pcBoxes } from "@ui/features/play-shell/placement";
import { createWindowRegistry, defineWindow } from "@ui/features/play-shell/registry";
import { REPLAY_CELLS, type ReplayState } from "@ui/features/play-shell/replay-cells.generated";
import { summaryStrip } from "@ui/features/play-shell/toast-region";
import { isPlacementPc } from "@ui/features/play-shell/token-boxes";
import {
  allClear,
  createResizeRefit,
  createSettledRefit,
  type FitInputs,
  type Frames,
  fitFor,
  fitPastToasts,
  fitTokensOf,
  footprintBox,
  placerSettled,
  RESIZE_REFIT_MS,
  SETTLED_FIT_MAX_WAITS,
  type Timers,
  visibleArea,
} from "./camera";

const VP = { w: 1280, h: 800 };
const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const MAP = { w: 1400, h: 980 };
/** Player 1 @1280×800 (the replay harness's P1 open): Initiative, sheet, Game log, card, Stats. */
const SHEET: Rect = { x: 948, y: 60, w: 320, h: 418 };
const WINDOWS: readonly Rect[] = [
  { x: 68, y: 60, w: 280, h: 400 },
  SHEET,
  { x: 68, y: 564, w: 510, h: 160 },
  { x: 600, y: 484, w: 296, h: 240 },
  { x: 612, y: 60, w: 320, h: 280 },
];

function inputsOf(state: ReplayState, windows: readonly Rect[]): FitInputs {
  const rooms = fitRooms("player", windows, keepOuts("player", VP, new Map()), VP, null);
  const tokens = REPLAY_CELLS[state]["player-1"].tokens.map((t) => ({
    col: t.col,
    row: t.row,
    size: t.size,
    pc: t.pc,
  }));
  return { client: "player", tokens, grid: GRID, map: MAP, view: VP, ...rooms };
}

const cellOf = (cam: { scale: number }) => Math.round(cam.scale * GRID.gridCellSize * 100) / 100;

describe("FR-MAP-93 one obstacle source", () => {
  test("FR-MAP-93 one obstacle source: obstacles = the plan's window rects + this client's toast obstacles; stripRoom = room for players", () => {
    const regions = keepOuts("player", VP, new Map());
    const rooms = fitRooms("player", WINDOWS, regions, VP, null);
    const toastBox = regions.find((k) => k.id === TOASTS_KEEP_OUT)?.rect;
    expect(rooms.room.obstacles).toEqual([...WINDOWS, toastBox as Rect]);
    expect(rooms.room.obstacles).toEqual(fitObstacles("player", WINDOWS, regions, VP, null));
    expect(rooms.stripRoom).toBe(rooms.room);
    // The DM: the summary strip always, the shown stack in `room` only (FR-MAP-91's strip room).
    const dmVp = { w: 1440, h: 900 };
    const card = { x: 560, y: 165, w: 320, h: 175 };
    const dm = fitRooms("dm", WINDOWS, keepOuts("dm", dmVp), dmVp, card);
    expect(dm.room.obstacles).toEqual([...WINDOWS, summaryStrip(dmVp), card]);
    expect(dm.stripRoom.obstacles).toEqual([...WINDOWS, summaryStrip(dmVp)]);
  });

  test("FR-MAP-93 one obstacle source: a pet is not a PC in fitTokens or the placer (isPlacementPc, #318)", () => {
    const pc = { col: 1, row: 1, size: "medium" as const, ownerPlayerId: "p1", characterId: "c1" };
    const pet = { ...pc, col: 3, characterId: null };
    const monster = { ...pc, col: 5, ownerPlayerId: null, characterId: null };
    expect(fitTokensOf([pc, pet, monster]).map((t) => t.pc)).toEqual([true, false, false]);
    expect([pc, pet, monster].map((t) => isPlacementPc(t))).toEqual([true, false, false]);
  });

  test("FR-MAP-93 one obstacle source: after every fit and refit each PC footprint + 4 px is clear of every window", () => {
    const load = fitFor("load", inputsOf("ambush", WINDOWS), null);
    const reveal = fitFor("reveal", inputsOf("ambush-revealed", WINDOWS), cellOf(load));
    for (const [state, cam] of [
      ["ambush", load],
      ["ambush-revealed", reveal],
    ] as const) {
      const pcs = REPLAY_CELLS[state]["player-1"].tokens.filter((t) => t.pc);
      const c = GRID.gridCellSize * cam.scale;
      const boxes = pcBoxes(
        pcs.map((t) => {
          const b = footprintBox([t], GRID) as Rect;
          return {
            x: cam.x + b.x * cam.scale,
            y: cam.y + b.y * cam.scale,
            w: (b.w / 70) * c,
            h: (b.h / 70) * c,
            pc: true,
          };
        }),
      );
      for (const b of boxes) {
        for (const w of WINDOWS) {
          const hit = b.x < w.x + w.w && w.x < b.x + b.w && b.y < w.y + w.h && w.y < b.y + b.h;
          expect(hit ? `${state}: a PC + ${PC_MARGIN} px under ${JSON.stringify(w)}` : "ok").toBe(
            "ok",
          );
        }
      }
    }
  });
});

describe("FR-MAP-95 one fit path", () => {
  test("FR-MAP-95 one fit path: reveal, load, open, Fit → the same camera for the same inputs (Fit's function)", () => {
    for (const windows of [WINDOWS, WINDOWS.slice(0, 3)]) {
      const inputs = inputsOf("ambush-revealed", windows);
      const fit = fitFor("fit", inputs, null);
      const direct = fitPastToasts(inputs.tokens, GRID, MAP, VP, inputs.room, inputs.stripRoom, {
        leastHidden: true,
      });
      expect({ x: fit.x, y: fit.y, scale: fit.scale }).toEqual({
        x: direct.x,
        y: direct.y,
        scale: direct.scale,
      });
      // Every reason, the same function: a reveal before any full fit is unbounded (FR-MAP-94).
      for (const reason of ["open", "load", "reveal"] as const) {
        const other = fitFor(reason, inputs, null);
        expect({ reason, x: other.x, y: other.y, scale: other.scale }).toEqual({
          reason,
          x: fit.x,
          y: fit.y,
          scale: fit.scale,
        });
        expect(other.reason).toBe(reason);
      }
    }
  });
});

/** Frames run by hand. */
function fakeFrames() {
  let next = 0;
  const due = new Map<number, () => void>();
  const frames: Frames = {
    request(fn) {
      next += 1;
      due.set(next, fn);
      return next;
    },
    cancel: (h) => void due.delete(h as number),
  };
  const tick = () => {
    const run = [...due.values()];
    due.clear();
    for (const fn of run) fn();
  };
  return {
    frames,
    tick,
    get pending() {
      return due.size;
    },
  };
}

const SETTLED = { ready: true, grown: true, settling: false, settledAt: VP };

describe("FR-MAP-96 load and Start after the placer", () => {
  test("FR-MAP-96 load and Start after the placer: the load fit waits for the load settle and the grown heights; the Start refit for the appear settle", () => {
    // Not ready: the layout not applied, a growing window not measured, a placed window settling.
    expect(placerSettled({ ...SETTLED, ready: false }, "load", VP)).toBe(false);
    expect(placerSettled({ ...SETTLED, grown: false }, "load", VP)).toBe(false);
    expect(placerSettled({ ...SETTLED, settling: true }, "appearance", VP)).toBe(false);
    expect(placerSettled(SETTLED, "load", VP)).toBe(true);
    expect(placerSettled(SETTLED, "appearance", VP)).toBe(true);
    // The fit runs on the first frame the placer has settled, once.
    const f = fakeFrames();
    let state = { ...SETTLED, grown: false };
    let fits = 0;
    const settled = createSettledRefit(
      () => (fits += 1),
      () => placerSettled(state, "load", VP),
      f.frames,
    );
    settled.request();
    f.tick();
    f.tick();
    expect(fits).toBe(0);
    expect(settled.pending).toBe(true);
    state = SETTLED; // the card reported its grown height
    settled.applied(); // its rect reached the canvas: the frame after
    f.tick();
    expect(fits).toBe(1);
    expect(settled.pending).toBe(false);
    // A placer that never settles: the fit runs anyway, after the bound.
    state = { ...SETTLED, settling: true };
    settled.request();
    for (let i = 0; i <= SETTLED_FIT_MAX_WAITS; i++) f.tick();
    expect(fits).toBe(2);
  });

  test("FR-MAP-96 load and Start after the placer: grown means every open growing window measured", () => {
    const registry = createWindowRegistry("player", [
      defineWindow({
        kind: "t.grow",
        title: "Grow",
        clients: ["player"],
        launcher: { icon: () => null, label: "Grow", order: 1 },
        defaultOpen: true,
        defaultPosition: { anchor: "top-left", dx: 0, dy: 0 },
        defaultSize: { w: 300, h: 200 },
        minSize: { w: 200, h: 120 },
        growToContent: true,
        component: () => null,
      }),
    ]);
    const win = {
      kind: "t.grow",
      instance: "main",
      state: "open" as const,
      x: 68,
      y: 60,
      w: 300,
      h: 200,
      z: 1,
    };
    const all = new Set(["t.grow"]);
    expect(grownAll([win], registry, all, new Map())).toBe(false);
    expect(grownAll([win], registry, all, new Map([["t.grow:main", 420]]))).toBe(true);
    expect(grownAll([{ ...win, fixedH: true }], registry, all, new Map())).toBe(true);
    expect(grownAll([{ ...win, state: "minimised" }], registry, all, new Map())).toBe(true);
  });
});

/** Fake timers for the resize debounce. */
function fakeTimers() {
  let next = 0;
  const due = new Map<number, () => void>();
  const timers: Timers = {
    set(fn) {
      next += 1;
      due.set(next, fn);
      return next;
    },
    clear: (h) => void due.delete(h as number),
  };
  const fire = () => {
    const run = [...due.values()];
    due.clear();
    for (const fn of run) fn();
  };
  return { timers, fire };
}

describe("FR-MAP-98 resize refit after settle", () => {
  test("FR-MAP-98 resize refit after settle: the refit waits for the last viewport settle at the new size", () => {
    const big = { w: 1440, h: 900 };
    // The viewport settle hasn't run at 1440×900 yet (still 1280×720): not settled.
    const before = { ...SETTLED, settledAt: { w: 1280, h: 720 } };
    expect(placerSettled(before, "resize", big)).toBe(false);
    expect(placerSettled(before, "load", big)).toBe(true);
    const f = fakeFrames();
    const t = fakeTimers();
    let state = before;
    let fits = 0;
    const settled = createSettledRefit(
      () => (fits += 1),
      () => placerSettled(state, "resize", big),
      f.frames,
    );
    const resize = createResizeRefit(
      () => settled.request(),
      () => false,
      t.timers,
    );
    resize.resize();
    t.fire(); // RESIZE_REFIT_MS after the last resize event
    expect(RESIZE_REFIT_MS).toBe(200);
    f.tick();
    f.tick();
    expect(fits).toBe(0);
    state = { ...SETTLED, settledAt: big }; // the viewport settle: the Game log back, zones placed
    f.tick();
    expect(fits).toBe(1);
  });
});

test("FR-MAP-93 one obstacle source: the fit's area check is the visible area (FR-MAP-59)", () => {
  const load = fitFor("load", inputsOf("ambush", WINDOWS), null);
  const boxes = REPLAY_CELLS.ambush["player-1"].tokens.map((t) => footprintBox([t], GRID) as Rect);
  expect(allClear(load, boxes, inputsOf("ambush", WINDOWS).room.obstacles, visibleArea(VP))).toBe(
    load.visible === "all",
  );
});
