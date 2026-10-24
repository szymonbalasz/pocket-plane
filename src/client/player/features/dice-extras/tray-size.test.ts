// T1 / T5 (sprint 10, DM #343, #347; FR-DICEX-96): a player's Dice tray 25 % bigger (T1's 40 % cut). The size row on
// the real registry and placement at 1280×720 and 1440×900 in the harness world (`runScript`:
// the shell controller, the real pure camera, `session-sim-11` states, I1–I6 after every step).
import { expect, test } from "bun:test";
import type { Rect } from "@ui/features/play-shell/geometry";
import { runScript } from "@ui/features/play-shell/replay";
import { SIZE_TABLE } from "@ui/features/play-shell/size-table";

const { playerWindows } = await import("../../windows");

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

test("FR-DICEX-96 tray size row (player): default 450 × 375, useful 360 × 300, min 300 × 240", () => {
  const def = playerWindows.get(KIND);
  expect(def?.defaultSize).toEqual({ w: 450, h: 375 });
  expect(def?.usefulSize).toEqual({ w: 360, h: 300 });
  expect(def?.minSize).toEqual({ w: 300, h: 240 });
  const row = SIZE_TABLE.player[KIND];
  for (const s of row?.default ?? []) expect(s).toEqual({ w: 450, h: 375 });
  for (const s of row?.useful ?? []) expect(s).toEqual({ w: 360, h: 300 });
});

test("FR-DICEX-96 tray layout (player-1) at 1280×720 and 1440×900: opens beside the Game log, Initiative and the sheet, no PC covered, at least the useful size", () => {
  for (const vp of [
    { w: 1280, h: 720 },
    { w: 1440, h: 900 },
  ]) {
    for (const state of ["ambush", "escort"] as const) {
      const run = runScript(playerWindows, "player-1", vp, state, [{ open: KIND }]);
      const at = `${vp.w}×${vp.h} ${state}`;
      // I1 (no PC under a window), I2 (no overlap), I3 (≥ useful where a PC-clear spot exists).
      expect(run.problems, at).toEqual([]);
      const ws = run.steps.at(-1)?.windows;
      const tray = rectIn(ws, KIND);
      expect(tray, at).not.toBeNull();
      if (!tray) continue;
      for (const kind of ["dice.log", "cbt.initiative", "char.sheet"]) {
        const other = rectIn(ws, kind);
        expect(other && overlaps(tray, other), `${at} ${kind}`).toBe(false);
      }
      expect(tray.w, at).toBeGreaterThanOrEqual(360);
      expect(tray.h, at).toBeGreaterThanOrEqual(300);
      expect(tray.w, at).toBeLessThanOrEqual(450);
    }
  }
  // Where the party leaves room the tray opens wider than before (sim-14: 360 × 300).
  const run = runScript(playerWindows, "player-1", { w: 1280, h: 720 }, "ambush", [{ open: KIND }]);
  expect(rectIn(run.steps.at(-1)?.windows, KIND)?.w).toBe(450);
});
