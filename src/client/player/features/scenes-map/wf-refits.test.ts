// Sprint 8 WF3 (scenes-map FR-MAP-94, -97): Player 1's refits after the placer, on the
// `session-sim-11` cells (play-shell §13): a reveal never zooms in past the last full fit (BL-65,
// sim-11 h, r03), and the map yields to a window once (BL-66, FR-SHELL-108).
import { expect, test } from "bun:test";
import { fitRooms } from "@ui/features/play-shell/free-area";
import type { Rect } from "@ui/features/play-shell/geometry";
import { keepOuts } from "@ui/features/play-shell/keep-outs";
import { REPROS, replayCells, runReplay } from "@ui/features/play-shell/replay";
import { REPLAY_CELLS, type ReplayState } from "@ui/features/play-shell/replay-cells.generated";
import {
  allClear,
  cameraOn,
  dryFitScene,
  type FitInputs,
  fitFor,
  fitScene,
  footprintBox,
  REFIT_MIN_SHARE,
  visibleArea,
} from "@ui/features/scenes-map/camera";

const { playerWindows } = await import("../../windows");

const VP = { w: 1280, h: 800 };
const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
/** P1 @1280×800 with the Owlbear card and Stats open (the harness's P1 open, sim-11 h). */
const SHEET: Rect = { x: 948, y: 60, w: 320, h: 418 };
const CARD: Rect = { x: 600, y: 484, w: 296, h: 240 };
const WINDOWS: readonly Rect[] = [
  { x: 68, y: 60, w: 280, h: 400 },
  SHEET,
  { x: 68, y: 564, w: 510, h: 160 },
  CARD,
  { x: 612, y: 60, w: 320, h: 280 },
];
const NO_CARD = WINDOWS.filter((w) => w !== CARD);
/** The card and Stats closed: Initiative, sheet, Game log. */
const THREE = WINDOWS.slice(0, 3);

function inputsOf(state: ReplayState, windows: readonly Rect[]): FitInputs {
  const rooms = fitRooms("player", windows, keepOuts("player", VP, new Map()), VP, null);
  const tokens = REPLAY_CELLS[state]["player-1"].tokens.map((t) => ({
    col: t.col,
    row: t.row,
    size: t.size,
    pc: t.pc,
  }));
  return { client: "player", tokens, grid: GRID, map: { w: 1400, h: 980 }, view: VP, ...rooms };
}

const cellOf = (cam: { scale: number }) => cam.scale * GRID.gridCellSize;

/** Names of the tokens of `state` not inside the area or under one of `windows` at `cam`. */
function hidden(
  state: ReplayState,
  cam: { x: number; y: number; scale: number },
  windows: readonly Rect[],
) {
  return REPLAY_CELLS[state]["player-1"].tokens
    .filter((t) => !allClear(cam, [footprintBox([t], GRID) as Rect], windows, visibleArea(VP)))
    .map((t) => t.name);
}

test("FR-MAP-94 reveal never zooms in (BL-65): P1 @1280×800 with the card + Stats, ambush → ambush-revealed: cell after ≤ before; r03's load fit ≤ fitVisible's cell with nothing under the sheet; repeated reveals return up to, never above, the last full fit", () => {
  const load = fitFor("load", inputsOf("ambush", WINDOWS), null);
  const last = cellOf(load);
  expect(load.visible).toBe("all");
  // BL-65 as built: the unbounded fit's `pcs` pan re-scaled up to 48 px (sim-11 h: 0.657 → 0.686).
  const revealed = inputsOf("ambush-revealed", WINDOWS);
  const before = fitScene(revealed.tokens, GRID, revealed.map, VP, revealed.room);
  expect(cellOf(before)).toBeGreaterThan(last);
  // Now: ≤ the last full fit's cell; zooming out to clear tokens is allowed (the load's camera).
  const reveal = fitFor("reveal", revealed, last);
  expect(cellOf(reveal)).toBeLessThanOrEqual(last + 1e-9);
  const load2 = fitFor("load", revealed, null);
  expect({ x: reveal.x, y: reveal.y, scale: reveal.scale }).toEqual({
    x: load2.x,
    y: load2.y,
    scale: load2.scale,
  });
  // Every PC stays clear.
  const pcs = REPLAY_CELLS["ambush-revealed"]["player-1"].tokens.filter((t) => t.pc);
  expect(
    hidden("ambush-revealed", reveal, WINDOWS).filter((n) => pcs.some((p) => p.name === n)),
  ).toEqual([]);
  // Where a pan allows it (the card and Stats closed), no new token stays under a window.
  const open = fitFor("reveal", inputsOf("ambush-revealed", THREE), last);
  expect(open.visible).toBe("all");
  expect(hidden("ambush-revealed", open, THREE)).toEqual([]);
  expect(cellOf(open)).toBeLessThanOrEqual(last + 1e-9);
  // r03: the reload's load fit with the card open: never the 48-px re-scale, nothing under the sheet.
  const r03 = fitFor("load", revealed, null);
  expect(cellOf(r03)).toBeLessThan(48);
  expect(cellOf(r03)).toBeLessThanOrEqual(cellOf(before));
  expect(hidden("ambush-revealed", r03, [SHEET])).toEqual([]);
  // Repeated reveals: the same inputs → the same camera (no ratchet); with room again, back up to
  // the last full fit at most.
  expect(fitFor("reveal", revealed, last)).toEqual(reveal);
  const again = fitFor("reveal", inputsOf("ambush-revealed", THREE), last);
  expect(cellOf(again)).toBeGreaterThanOrEqual(cellOf(reveal));
  expect(cellOf(again)).toBeLessThanOrEqual(last + 1e-9);
  // The harness's sim-11 h cell: its reveal step never raises the cell (I6).
  const h = REPROS.player.find((r) => r.name.startsWith("sim-11 h"));
  const cell = replayCells(playerWindows).find((c) => c.name === h?.cell);
  if (!cell) throw new Error("no sim-11 h cell");
  const run = runReplay(playerWindows, cell.set, cell.camera, cell.vp, cell.path);
  const i = run.steps.findIndex((s) => s.step === "reveal");
  expect(i).toBeGreaterThan(0);
  expect(run.steps[i]?.cell).toBeLessThanOrEqual((run.steps[i - 1]?.cell ?? 0) + 1e-9);
  expect(run.steps[i]?.problems.filter((p) => p.startsWith("I6"))).toEqual([]);
}, 15_000);

/** Walkthrough F10 (test-wf3): B 1280×800, Escort, the card open, Stats put away; Initiative, card, sheet, Game log. */
const F10_WINDOWS: readonly Rect[] = [
  { x: 68, y: 60, w: 280, h: 400 },
  { x: 360, y: 60, w: 320, h: 360 },
  SHEET,
  { x: 68, y: 564, w: 510, h: 160 },
];
/** What B sees after Reveal all (13 tokens: no Fire Elementals in Escort, the charmed Goblin 2 gone). */
const F10_TOKENS = REPLAY_CELLS["ambush-revealed"]["player-1"].tokens.filter(
  (t) => !["Fire Elemental", "Fire Elemental 2", "Fire Elemental 3", "Goblin 2"].includes(t.name),
);

test("FR-MAP-94 FR-MAP-95 reveal = load (walkthrough F10): last full fit 48 px, the card open, Reveal all → the load's camera (24 px, nothing under a window), not 48 px with Goblin, Elite 2, Wolf 2 and Plain Brute under the sheet", () => {
  const rooms = fitRooms("player", F10_WINDOWS, keepOuts("player", VP, new Map()), VP, null);
  const tokens = F10_TOKENS.map((t) => ({ col: t.col, row: t.row, size: t.size, pc: t.pc }));
  const inputs: FitInputs = {
    client: "player",
    tokens,
    grid: GRID,
    map: { w: 1400, h: 980 },
    view: VP,
    ...rooms,
  };
  const under = (cam: { x: number; y: number; scale: number }) =>
    F10_TOKENS.filter(
      (t) => !allClear(cam, [footprintBox([t], GRID) as Rect], F10_WINDOWS, visibleArea(VP)),
    ).map((t) => t.name);
  // The walkthrough's refit: bounded to [36, 48] px, it stayed at 48 (camera 450, 132).
  const was = fitScene(tokens, GRID, inputs.map, VP, rooms.room, {
    maxCell: 48,
    minCell: 36,
    leastHidden: true,
  });
  expect({ cell: cellOf(was), x: was.x, y: was.y }).toEqual({ cell: 48, x: 450, y: 132 });
  expect(under(was)).toEqual(
    expect.arrayContaining(["Goblin", "Elite Goblin Warrior 2", "Wolf 2", "Plain Brute"]),
  );
  // Now the reveal reaches the load's answer: zoomed out, nothing under a window.
  const reveal = fitFor("reveal", inputs, 48);
  const load = fitFor("load", inputs, null);
  expect({ x: reveal.x, y: reveal.y, scale: reveal.scale }).toEqual({
    x: load.x,
    y: load.y,
    scale: load.scale,
  });
  expect(reveal.reason).toBe("reveal");
  expect(cellOf(reveal)).toBeLessThanOrEqual(48);
  expect(under(reveal)).toEqual([]);
});

test("FR-MAP-97 yield refit: dryFit returns {camera, cellPx, verdict} unapplied; a yield the placer accepts (≥ 75 % of the last full fit) refits once with `window`, still fitted; `moved` never", () => {
  // The dry fit: the candidate window as one more obstacle, the camera not applied.
  const load = fitFor("load", inputsOf("ambush", NO_CARD), null);
  const last = cellOf(load);
  const inputs = inputsOf("ambush", WINDOWS);
  const dry = dryFitScene(inputs, last);
  expect(Object.keys(dry).sort()).toEqual(["camera", "cellPx", "clear", "verdict"]);
  expect(dry.cellPx).toBeLessThanOrEqual(last + 1e-9);
  expect(dry.cellPx).toBeGreaterThanOrEqual(REFIT_MIN_SHARE * last - 1e-9);
  expect(dry.camera).toEqual({
    x: fitFor("window", inputs, last).x,
    y: fitFor("window", inputs, last).y,
    scale: fitFor("window", inputs, last).scale,
  });
  // `window` refits only while fitted, and keeps the camera fitted.
  expect(cameraOn("fitted", "window")).toEqual({ mode: "fitted", fit: true });
  expect(cameraOn("moved", "window")).toEqual({ mode: "moved", fit: false });
  // The harness (the placer's L2b with this dry fit): P2 @1280×720 reload, a window opened over
  // the PCs → the map yields, to ≥ 75 % of the last full fit, every PC + 4 px clear after it.
  const cell = replayCells(playerWindows).find(
    (c) => c.name === "FR-SHELL-115 replay P2 fitted @1280×720 load",
  );
  if (!cell) throw new Error("no P2 load cell");
  const run = runReplay(playerWindows, cell.set, cell.camera, cell.vp, cell.path);
  const yields = run.steps.filter((s) => s.log.split(";").some((l) => l.endsWith(">L2b")));
  expect(yields.length).toBeGreaterThan(0);
  for (const y of yields) {
    const i = run.steps.indexOf(y);
    const prev = run.steps[i - 1]?.cell ?? 0;
    expect(y.cell).toBeLessThanOrEqual(prev + 1e-9);
    expect(y.cell).toBeGreaterThanOrEqual(REFIT_MIN_SHARE * prev - 1e-9);
    expect(y.problems).toEqual([]);
  }
}, 15_000);
