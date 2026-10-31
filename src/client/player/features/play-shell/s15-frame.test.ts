// Sprint 15 frame (session-sim-17 glitch 4, BL-176; `.verify/sim17/` v10, l03): a player at
// 1280×720. The Dice tray makes the map yield (L2b), pushing it down-right to keep the PCs clear;
// closing the tray left it low until Fit. In the harness's world: the shell controller, the real
// pure camera, `session-sim-11` states.
import { expect, test } from "bun:test";
import { DICEX_TRAY_KIND } from "@ui/features/dice-extras/window-kind";
import { runScript } from "@ui/features/play-shell/replay";
import { endsYieldMemory, rememberYield, yieldBack } from "@ui/features/scenes-map/camera";

const { playerWindows } = await import("../../windows");

const VP = { w: 1280, h: 720 };

const camAt = (run: ReturnType<typeof runScript>, step: string) =>
  run.steps.find((s) => s.step === step)?.camera;

test("FR-MAP-125 sim-17 v10: the map the Dice tray pushed comes back when the tray closes", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    { open: DICEX_TRAY_KIND },
    { close: DICEX_TRAY_KIND },
  ]);
  const before = camAt(run, "load");
  const pushed = camAt(run, `open ${DICEX_TRAY_KIND}`);
  // The repro's premise: the tray did make the map yield.
  expect(run.steps.find((s) => s.step === `open ${DICEX_TRAY_KIND}`)?.log).toContain(">L2b");
  expect(pushed).not.toEqual(before);
  expect(camAt(run, `close ${DICEX_TRAY_KIND}`)).toEqual(before);
  expect(run.problems).toEqual([]);
});

test("FR-MAP-126 a player who moved the camera in between keeps it when the tray closes", () => {
  const pan = { x: 700, y: 400 };
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    { open: DICEX_TRAY_KIND },
    { pan },
    { close: DICEX_TRAY_KIND },
  ]);
  expect(camAt(run, `close ${DICEX_TRAY_KIND}`)).toEqual(camAt(run, `pan ${pan.x},${pan.y}`));
});

test("FR-MAP-126 a Fit in between is the player's too: the tray's closing leaves it", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    { open: DICEX_TRAY_KIND },
    "fit",
    { close: DICEX_TRAY_KIND },
  ]);
  expect(camAt(run, `close ${DICEX_TRAY_KIND}`)).toEqual(camAt(run, "fit"));
});

test("FR-MAP-125 only the tray's refit is undone: another window's yield stays when that window closes", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    { open: "stats.board" },
    { close: "stats.board" },
  ]);
  const opened = run.steps.find((s) => s.step === "open stats.board");
  expect(opened?.log).toContain(">L2b");
  expect(opened?.camera).not.toEqual(camAt(run, "load"));
  expect(camAt(run, "close stats.board")).toEqual(opened?.camera);
});

test("FR-MAP-125 minimising the tray ends it too; reopened, the map yields again and comes back again", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    { open: DICEX_TRAY_KIND },
    { minimise: DICEX_TRAY_KIND },
    { open: DICEX_TRAY_KIND },
    { close: DICEX_TRAY_KIND },
  ]);
  const before = camAt(run, "load");
  expect(camAt(run, `minimise ${DICEX_TRAY_KIND}`)).toEqual(before);
  expect(camAt(run, `close ${DICEX_TRAY_KIND}`)).toEqual(before);
  expect(run.problems).toEqual([]);
});

const CAM = { x: 415, y: 48, scale: 0.5 };
const PUSHED = { x: 578, y: 230, scale: 0.5 };
const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
/** Mira at cell (4, 4): 140 × 35 px at `CAM`'s scale: screen 555,188 35 × 35. */
const inputs = (obstacles: { x: number; y: number; w: number; h: number }[]) => ({
  tokens: [{ col: 4, row: 4, size: "medium" as const, pc: true }],
  grid: GRID,
  view: VP,
  room: { areas: [], windowsOnly: [], obstacles },
});

test("FR-MAP-125 yieldBack: the refit undone; another refit since (a reveal) or a PC under a window opened since → one window refit instead", () => {
  const mem = rememberYield(null, CAM, null, PUSHED);
  expect(mem.from).toEqual(CAM);
  expect(yieldBack(mem, PUSHED, "fitted", inputs([]))).toBe("restore");
  expect(yieldBack(mem, { ...PUSHED, y: 200 }, "fitted", inputs([]))).toBe("refit");
  const over = { x: 540, y: 170, w: 80, h: 80 };
  expect(yieldBack(mem, PUSHED, "fitted", inputs([over]))).toBe("refit");
});

test("FR-MAP-125 rememberYield: a second yield straight after keeps the first camera; after another refit it starts over", () => {
  const mem = rememberYield(null, CAM, null, PUSHED);
  const next = { ...PUSHED, y: 300 };
  expect(rememberYield(mem, PUSHED, null, next)).toEqual({ before: null, from: CAM, after: next });
  const other = { ...PUSHED, y: 260 };
  expect(rememberYield(mem, other, null, next).from).toEqual(other);
});

test("FR-MAP-126 yieldBack: no memory or a moved camera leaves it; pan, zoom, pull, Fit, open and resize end the memory, refits don't", () => {
  const mem = rememberYield(null, CAM, null, PUSHED);
  expect(yieldBack(null, PUSHED, "fitted", inputs([]))).toBe("leave");
  expect(yieldBack(mem, PUSHED, "moved", inputs([]))).toBe("leave");
  for (const e of ["pan", "zoom", "pull", "fit", "open", "resize"] as const) {
    expect(endsYieldMemory(e)).toBe(true);
  }
  for (const e of ["window", "appearance", "reveal"] as const) {
    expect(endsYieldMemory(e)).toBe(false);
  }
});

test("FR-MAP-94 undoing a yield never zooms in past the last full fit: the restored cell is the cell it had", () => {
  const run = runScript(playerWindows, "player-1", VP, "ambush", [
    { open: DICEX_TRAY_KIND },
    { close: DICEX_TRAY_KIND },
  ]);
  const load = run.steps.find((s) => s.step === "load");
  const closed = run.steps.find((s) => s.step === `close ${DICEX_TRAY_KIND}`);
  expect(closed?.cell).toBe(load?.cell as number);
});
