// FR-MAP-113 (BL-86, sim-12 glitch 4): a resize round trip ends where Fit would. The DM on
// `session-sim-11`'s ambush, `fitted`, Game log + Initiative, 1280×720 → 1440×900 → 1280×720 →
// 1440×900, through the app's own pieces: the shell controller (the `viewport` settle), the
// canvas's settled-refit timing on fake frames, and the real fit.
import { expect, mock, test } from "bun:test";
import { fitRooms, renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Viewport } from "@ui/features/play-shell/geometry";
import { hardRects, keepOuts } from "@ui/features/play-shell/keep-outs";
import { pushBars } from "@ui/features/play-shell/manager";
import { REPLAY_CELLS } from "@ui/features/play-shell/replay-cells.generated";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { TEST_KINDS } from "@ui/features/play-shell/size-table";
import { createLayoutStorage } from "@ui/features/play-shell/storage";
import {
  createSettledRefit,
  type FitReason,
  type Frames,
  fitFor,
  placerSettled,
  SETTLED_FIT_MAX_WAITS,
} from "@ui/features/scenes-map/camera";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const cells = REPLAY_CELLS.ambush.dm;
const grid = {
  gridCellSize: cells.scene.gridCellSize,
  gridOffsetX: cells.scene.gridOffsetX,
  gridOffsetY: cells.scene.gridOffsetY,
};
const available = new Set(dmWindows.defs.map((d) => d.kind).filter((k) => !TEST_KINDS.has(k)));

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
  return { frames, tick };
}

/** The DM page: shell controller + the canvas's resize refit, on fake frames. */
function page() {
  const vp = { current: { w: 1280, h: 720 } as Viewport };
  const c = createShellController({
    registry: dmWindows,
    storage: createLayoutStorage(() => ({ getItem: () => null, setItem() {} })),
    viewport: () => vp.current,
    keepOuts: (v) => keepOuts("dm", v, new Map()),
    available: () => available,
  });
  c.restore("k");
  /** The fit with the windows rendered now (FR-MAP-93: the plan's rects). */
  const fitNow = (reason: FitReason) => {
    const v = vp.current;
    const regions = keepOuts("dm", v, new Map());
    const open = c.store.getState().windows.filter((w) => w.state === "open");
    const rects = renderedWindowRects(
      open,
      dmWindows,
      available,
      v,
      new Map(),
      hardRects(regions),
      pushBars(regions),
    );
    const f = fitFor(
      reason,
      {
        client: "dm",
        tokens: cells.tokens.map((t) => ({ col: t.col, row: t.row, size: t.size, pc: t.pc })),
        grid,
        map: { w: cells.scene.mapWidth, h: cells.scene.mapHeight },
        view: v,
        ...fitRooms("dm", rects, regions, v, null),
      },
      null,
    );
    return `${(f.scale * grid.gridCellSize).toFixed(1)} ${f.visible}`;
  };
  let camera = fitNow("load");
  const f = fakeFrames();
  const refit = createSettledRefit(
    () => {
      camera = fitNow("resize");
    },
    () => {
      const s = c.store.getState();
      return placerSettled(
        { ready: true, grown: true, settling: false, settledAt: s.settledAt },
        "resize",
        vp.current,
      );
    },
    f.frames,
  );
  return { c, vp, f, refit, fitNow, camera: () => camera };
}

// Root cause first (BL-86): the failing repro, before the fix. The resize refit fits anyway after
// SETTLED_FIT_MAX_WAITS frames; a viewport settle that lands later (a busy or throttled page)
// leaves the camera framed on the previous size's windows, render-fit: at 1280×720 the 1150-wide
// Game log leaves a strip, the 48-px floor, `pcs` (sim-12's numbers).
test.failing("FR-MAP-113 resize round trip (BL-86): 1280×720 → 1440×900 → 1280×720 → 1440×900, `fitted`: each step's cell px and fit-visible = Fit's at that size (34 px `all` at 1280×720), even when the viewport settle lands late", () => {
  const p = page();
  expect(p.camera()).toBe("34.0 all");
  for (const next of [
    { w: 1440, h: 900 },
    { w: 1280, h: 720 },
    { w: 1440, h: 900 },
  ]) {
    p.vp.current = next;
    p.refit.request(); // RESIZE_REFIT_MS after the last resize event
    for (let i = 0; i <= SETTLED_FIT_MAX_WAITS; i++) p.f.tick();
    p.c.dispatch({ type: "viewport" }, available); // the settle, late
    p.refit.applied();
    p.f.tick();
    const at = `${next.w}×${next.h}`;
    expect({ at, camera: p.camera() }).toEqual({ at, camera: p.fitNow("fit") });
  }
  expect(p.camera()).toBe("42.0 all");
});
