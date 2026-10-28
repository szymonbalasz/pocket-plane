// T1 / T5 (sprint 10, DM #343, #347; FR-DICEX-96): the DM's Dice tray 25 % bigger (T1's 40 % cut). The size row on the
// real registry, placement at 1280×720 and 1440×900 in the harness world (`runScript`: the shell
// controller, the real pure camera, `session-sim-11` states, I1–I6 after every step) and window
// memory (FR-SHELL-53: an unremembered tray at an old default moves to the new one, a remembered
// one keeps its size).
import { expect, mock, test } from "bun:test";
import type { Rect } from "@ui/features/play-shell/geometry";
import { runScript } from "@ui/features/play-shell/replay";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { SIZE_TABLE } from "@ui/features/play-shell/size-table";
import { createLayoutStorage } from "@ui/features/play-shell/storage";

// The players panel pulls in the DM session (localStorage, window.location at import).
mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const KIND = "dicex.tray";
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `kind:state:x,y,w×h` of a step's windows → that kind's rect. */
function rectIn(windows: string | undefined, kind: string): Rect | null {
  const e = (windows ?? "").split(" ").find((x) => x.startsWith(`${kind}:`)) ?? "";
  const m = /:(-?\d+),(-?\d+),(\d+)×(\d+)$/.exec(e);
  const [x, y, w, h] = (m?.slice(1) ?? []).map(Number);
  return m && x !== undefined && y !== undefined && w !== undefined && h !== undefined
    ? { x, y, w, h }
    : null;
}

test("FR-DICEX-96 tray size row (DM): default 450 × 375 (360 × 300 × 1.25), useful 360 × 300, min 300 × 240, 360 × 300 and T1's 504 × 420 previous defaults", () => {
  const def = dmWindows.get(KIND);
  expect(def?.defaultSize).toEqual({ w: 450, h: 375 });
  expect(def?.usefulSize).toEqual({ w: 360, h: 300 });
  expect(def?.minSize).toEqual({ w: 300, h: 240 });
  expect(def?.previousDefaults).toEqual([
    { w: 360, h: 300 },
    { w: 504, h: 420 },
  ]);
  const row = SIZE_TABLE.dm[KIND];
  for (const s of row?.default ?? []) expect(s).toEqual({ w: 450, h: 375 });
  for (const s of row?.useful ?? []) expect(s).toEqual({ w: 360, h: 300 });
  expect(row?.min).toEqual({ w: 300, h: 240 });
});

test("FR-DICEX-96 tray layout (DM) at 1280×720 and 1440×900: opens beside the Game log and Initiative, no PC covered, at least the useful size; the useful size with Fit `all` at 1440×900 escort", () => {
  for (const vp of [
    { w: 1280, h: 720 },
    { w: 1440, h: 900 },
  ]) {
    for (const state of ["escort", "ambush"] as const) {
      const run = runScript(dmWindows, "dm", vp, state, [{ open: KIND }]);
      const at = `${vp.w}×${vp.h} ${state}`;
      // I1 (no PC under a window), I2 (no overlap), I3 (≥ useful where a PC-clear spot exists).
      expect(run.problems, at).toEqual([]);
      const ws = run.steps.at(-1)?.windows;
      const tray = rectIn(ws, KIND);
      expect(tray, at).not.toBeNull();
      if (!tray) continue;
      for (const kind of ["dice.log", "cbt.initiative"]) {
        const other = rectIn(ws, kind);
        expect(other && overlaps(tray, other), `${at} ${kind}`).toBe(false);
      }
      expect(tray.w, at).toBeGreaterThanOrEqual(360);
      expect(tray.h, at).toBeGreaterThanOrEqual(300);
      expect(tray.w, at).toBeLessThanOrEqual(450);
    }
  }
  // 1440×900 escort: the useful 360 × 300 where Fit keeps `all` (BL-134's fit-keeping rule applies to the tray).
  const wide = runScript(dmWindows, "dm", { w: 1440, h: 900 }, "escort", [{ open: KIND }]);
  expect(rectIn(wide.steps.at(-1)?.windows, KIND)).toMatchObject({ w: 360, h: 300 });
  expect(wide.steps.at(-1)?.fit).toBe("all");
});

function shellWith(entry: Record<string, unknown>) {
  const vp = { w: 1440, h: 900 };
  const backend = new Map([
    [
      "k",
      JSON.stringify({
        windows: [{ kind: KIND, instance: "main", state: "open", z: 1, ...entry }],
      }),
    ],
  ]);
  const c = createShellController({
    registry: dmWindows,
    storage: createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    })),
    viewport: () => vp,
  });
  c.restore("k");
  const w = c.store.getState().windows.find((x) => x.kind === KIND);
  return { w };
}

test("FR-DICEX-96 tray window memory: a stored tray still at an old default (360 × 300, T1's 504 × 420) takes 450 × 375 where it is; a remembered one (moved or resized) keeps its stored size", () => {
  const spot = { x: 600, y: 200, w: 360, h: 300 };
  // FR-SHELL-53: an auto-placed tray at a previous default takes the new one in place.
  expect(shellWith(spot).w).toMatchObject({ x: 600, y: 200, w: 450, h: 375 });
  const t1 = { x: 600, y: 200, w: 504, h: 420 };
  expect(shellWith(t1).w).toMatchObject({ x: 600, y: 200, w: 450, h: 375 });
  // A remembered T1-size tray keeps 504 × 420.
  expect(shellWith({ ...t1, userSpot: true, userSize: true }).w).toMatchObject(t1);
  // Remembered (FR-SHELL-144): a user spot, or a user size, keeps 360 × 300.
  expect(shellWith({ ...spot, userSpot: true }).w).toMatchObject(spot);
  expect(shellWith({ ...spot, userSpot: true, userSize: true }).w).toMatchObject(spot);
  // A hand-resized tray at another size keeps it too.
  const own = { x: 600, y: 200, w: 420, h: 340, userSpot: true, userSize: true };
  expect(shellWith(own).w).toMatchObject({ x: 600, y: 200, w: 420, h: 340 });
});
