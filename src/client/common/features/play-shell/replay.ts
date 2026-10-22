// Session-replay layout harness (FR-SHELL-114–116, play-shell §13 sprint 8). Drives the shell
// controller (the app's own placement path, in memory) and the real pure camera through the
// `session-sim-11` states of `replay-cells.generated.ts`, for one window set, camera mode,
// viewport and path, and checks the invariants I1–I8 after every step. Test-only: nothing here
// runs in the app.
import { MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import { footprint } from "@shared/scenes-map/geometry";
import {
  allClear,
  appearanceKeeps,
  type Camera,
  type FitToken,
  fitScene,
  footprintBox,
  revealRefit,
  visibleArea,
} from "../scenes-map/camera";
import { fitObstacles, freeAreas, renderedWindowRects } from "./free-area";
import type { Rect, Viewport } from "./geometry";
import { hardRects, type KeepOut, keepOuts } from "./keep-outs";
import { bruteBest, overlaps, REFERENCE_VIEWPORTS } from "./layout-checks";
import { defaultLayout, useful, type WindowAction, type Windows } from "./manager";
import { type PlacementToken, pcBoxes } from "./placement";
import type { ShellClient, WindowRegistry } from "./registry";
import {
  type CellToken,
  REPLAY_CELLS,
  type ReplayState,
  type ReplayViewer,
} from "./replay-cells.generated";
import { createShellController, type ShellController } from "./shell-store";
import { TEST_KINDS } from "./size-table";
import { createLayoutStorage } from "./storage";

export type ReplayCamera = "fitted" | "moved";
export type ReplayPath =
  | "open"
  | "reopen"
  | "push"
  | "resize"
  | "reveal"
  | "load"
  | "Start"
  | "reset";

/**
 * A window set (FR-SHELL-115): the kinds open in it, protected ones included, in open order;
 * `pending` = kinds another track registers later (skipped until they are registered).
 */
export interface ReplaySet {
  name: string;
  viewer: ReplayViewer;
  kinds: readonly string[];
  pending?: readonly string[];
}

const D1 = ["dice.log", "cbt.initiative", "cmp.compendium", "party.board", "cbt.encounters"];
const P1 = ["char.sheet", "cbt.initiative", "dice.log", "charx.companion", "stats.board"];

/**
 * FR-SHELL-115's sets. Append-only (FR-SHELL-112 (1), review-b #14): a kind registered later
 * adds itself to its sets' `pending` list here, in its owner's branch.
 */
export const REPLAY_SETS: Record<ShellClient, readonly ReplaySet[]> = {
  dm: [
    { name: "D1", viewer: "dm", kinds: [...D1, "stats.board"] },
    { name: "D2", viewer: "dm", kinds: [...D1, "stats.board", "map.scenes"] },
    {
      name: "D3",
      viewer: "dm",
      kinds: [
        ...D1,
        "stats.board",
        "camp.players",
        "ent.creatures",
        "note.history",
        "dicex.tray",
        "party.summary", // CB3 (S12)
      ],
      // TT's `dicex.requests` (S3): pending until registered.
      pending: ["dicex.requests"],
    },
  ],
  player: [
    { name: "P1", viewer: "player-1", kinds: [...P1, "party.summary"] }, // CB3 (S12)
    {
      name: "P2",
      viewer: "player-1",
      kinds: [...P1, "cmp.compendium", "note.history", "party.board"],
    },
    {
      name: "P3",
      viewer: "player-2",
      kinds: ["char.sheet", "cbt.initiative", "dice.log", "stats.board", "party.summary"], // CB3
    },
  ],
};

export const REPLAY_CAMERAS: readonly ReplayCamera[] = ["fitted", "moved"];

/** The paths each client runs (FR-SHELL-115): reveal is the players' (FR-MAP-82). */
export function replayPaths(client: ShellClient): ReplayPath[] {
  const all: ReplayPath[] = ["open", "reopen", "push", "resize", "load", "Start", "reset"];
  return client === "player" ? [...all.slice(0, 4), "reveal", ...all.slice(4)] : all;
}

/** `FR-SHELL-115 replay <set> <camera> @<size> <path>`. */
export const replayName = (set: string, camera: ReplayCamera, vp: Viewport, path: ReplayPath) =>
  `FR-SHELL-115 replay ${set} ${camera} @${vp.w}×${vp.h} ${path}`;

/** The state a path starts from: the DM in the Escort fight (sim-11 g), players in the Ambush. */
function startState(client: ShellClient, path: ReplayPath): ReplayState {
  if (path === "Start") return "ambush";
  if (client === "dm") return "escort";
  return path === "load" ? "ambush-revealed" : "ambush";
}

/** One step's outcome: stored windows, rendered rects by kind, camera cell (px), problems. */
export interface ReplayStep {
  step: string;
  vp: Viewport;
  windows: string;
  cell: number;
  /** The last settle's `data-settle-log` (FR-SHELL-110). */
  log: string;
  problems: string[];
}

export interface ReplayRun {
  steps: ReplayStep[];
  problems: string[];
}

const rectKey = (r: Rect) => `${r.x},${r.y},${r.w}×${r.h}`;

/** The tool bar a push path shows (FR-SHELL-55 / -104): the DM's wrapped fog bar, a player's AoE. */
function toolBar(client: ShellClient, vp: Viewport): Rect {
  // FR-MAP-60's home spot right of the rail; max width stops 8 px before the DM's top-centre box.
  const w = client === "dm" ? Math.min(392 + (vp.w - 1280) / 2, 552) : 360;
  return { x: 64, y: 56, w: Math.round(w), h: client === "dm" ? 128 : 48 };
}

/** The fit's grid (map px). */
function gridOf(state: ReplayState, viewer: ReplayViewer) {
  const s = REPLAY_CELLS[state][viewer].scene;
  return { gridCellSize: s.gridCellSize, gridOffsetX: s.gridOffsetX, gridOffsetY: s.gridOffsetY };
}

/** On-screen footprints at `cam` (FR-SHELL-57): `pc` = a player character (#318). */
export function cellFootprints(
  tokens: readonly CellToken[],
  grid: ReturnType<typeof gridOf>,
  cam: Camera,
) {
  const c = grid.gridCellSize * cam.scale;
  return tokens.map((t): PlacementToken & { id: string } => ({
    id: t.id,
    x: cam.x + grid.gridOffsetX * cam.scale + t.col * c,
    y: cam.y + grid.gridOffsetY * cam.scale + t.row * c,
    w: footprint(t.size) * c,
    h: footprint(t.size) * c,
    pc: t.pc,
  }));
}

interface Sim {
  client: ShellClient;
  registry: WindowRegistry;
  set: ReplaySet;
  vp: Viewport;
  state: ReplayState;
  /** The player's Initiative is available (a fight is started). */
  combat: boolean;
  reports: Map<string, Rect>;
  backend: Map<string, string>;
  ctl: ShellController;
  /** Null before the first draw (no tokens drawn yet). */
  cam: Camera | null;
  mode: ReplayCamera;
  /** The last full fit's cell, screen px (FR-MAP-94). */
  lastFull: number;
  key: string;
}

const KEY = "pp.layout.v1.replay.viewer";

/** Product kinds this client renders now (test-mode kinds off; the player's Initiative in a fight). */
function availableOf(sim: Sim): Set<string> {
  const out = new Set<string>();
  for (const d of sim.registry.defs) {
    if (TEST_KINDS.has(d.kind)) continue;
    if (sim.client === "player" && d.kind === "cbt.initiative" && !sim.combat) continue;
    out.add(d.kind);
  }
  return out;
}

const regionsOf = (sim: Sim, vp: Viewport = sim.vp): KeepOut[] =>
  keepOuts(sim.client, vp, sim.reports);

function cellsNow(sim: Sim) {
  return REPLAY_CELLS[sim.state][sim.set.viewer];
}

function tokensNow(sim: Sim): (PlacementToken & { id: string })[] {
  if (!sim.cam) return [];
  return cellFootprints(cellsNow(sim).tokens, gridOf(sim.state, sim.set.viewer), sim.cam);
}

function newController(sim: Omit<Sim, "ctl">): ShellController {
  const storage = createLayoutStorage(() => ({
    getItem: (k) => sim.backend.get(k) ?? null,
    setItem: (k, v) => void sim.backend.set(k, v),
  }));
  return createShellController({
    registry: sim.registry,
    storage,
    viewport: () => sim.vp,
    avoid: () => tokensNow(sim as Sim),
    keepOuts: (vp) => regionsOf(sim as Sim, vp),
    available: () => availableOf(sim as Sim),
    camera: () => sim.mode,
    dryFit: (obstacles) => dryFit(sim as Sim, obstacles),
    lastFullCell: () => sim.lastFull || null,
    // FR-MAP-97: an accepted yield refits once, still `fitted`.
    onYield: () => {
      (sim as Sim).cam = fitNow(sim as Sim).cam;
    },
    warn: () => {},
  });
}

/**
 * The base port's dry fit (FR-SHELL-108, FR-MAP-97): the fit with `obstacles` as the windows,
 * not applied; `clear` = every PC, and every token clear now, stays clear (FR-MAP-59's test).
 */
function dryFit(sim: Sim, obstacles: readonly Rect[]) {
  if (!sim.cam) return null;
  const grid = gridOf(sim.state, sim.set.viewer);
  const tokens = cellsNow(sim).tokens;
  const now = fitNow(sim).obstacles;
  const area = visibleArea(sim.vp);
  const boxOf = (t: CellToken) => footprintBox([t], grid);
  const keep = tokens.filter((t) => {
    const b = boxOf(t);
    return t.pc || (b !== null && allClear(sim.cam as Camera, [b], now, area));
  });
  const { cam, obstacles: next } = fitNow(sim, obstacles);
  const boxes = keep.flatMap((t) => boxOf(t) ?? []);
  return { cellPx: cam.scale * grid.gridCellSize, clear: allClear(cam, boxes, next, area) };
}

const windowsOf = (sim: Sim): Windows => sim.ctl.store.getState().windows;

/** Rendered rects of the open, available windows, by kind (no measured heights). */
function shownOf(sim: Sim): Map<string, { w: WindowState; r: Rect }> {
  const available = availableOf(sim);
  const open = windowsOf(sim).filter((w) => w.state === "open" && available.has(w.kind));
  const rects = renderedWindowRects(
    open,
    sim.registry,
    available,
    sim.vp,
    new Map(),
    hardRects(regionsOf(sim)),
  );
  return new Map(open.map((w, i) => [w.kind, { w, r: rects[i] as Rect }]));
}

/** The fit (FR-MAP-44 → -59) with the rendered windows and toast box as obstacles. */
function fitNow(sim: Sim, with_?: readonly Rect[]): { cam: Camera; obstacles: Rect[] } {
  const windows = with_ ? [...with_] : [...shownOf(sim).values()].map((s) => s.r);
  const obstacles = fitObstacles(sim.client, windows, regionsOf(sim), sim.vp, null);
  const room = {
    areas: freeAreas(obstacles, sim.vp),
    obstacles,
    windowsOnly: freeAreas(windows, sim.vp),
  };
  const cells = cellsNow(sim);
  const fitTokens: FitToken[] = cells.tokens.map((t) => ({
    col: t.col,
    row: t.row,
    size: t.size,
    pc: t.pc,
  }));
  const map = { w: cells.scene.mapWidth, h: cells.scene.mapHeight };
  const f = fitScene(fitTokens, gridOf(sim.state, sim.set.viewer), map, sim.vp, room);
  return { cam: { x: f.x, y: f.y, scale: f.scale }, obstacles };
}

const cellPx = (sim: Sim) => (sim.cam ? sim.cam.scale * cellsNow(sim).scene.gridCellSize : 0);

/** A full fit (Fit, open, load, reset, resize): the camera `fitted`, its cell the new baseline. */
function fullFit(sim: Sim) {
  sim.cam = fitNow(sim).cam;
  sim.mode = "fitted";
  sim.lastFull = cellPx(sim);
}

/**
 * The `moved` camera (FR-SHELL-115): the fitted camera panned so the PCs sit under the first
 * protected right-column window's zone (DM Initiative, the player's sheet): the zones' worst case.
 */
function moveCamera(sim: Sim) {
  if (!sim.cam) return;
  const zoneKind = sim.client === "dm" ? "cbt.initiative" : "char.sheet";
  const zone = defaultLayout(sim.registry, sim.vp, [], regionsOf(sim)).find(
    (w) => w.kind === zoneKind,
  );
  const grid = gridOf(sim.state, sim.set.viewer);
  const box = footprintBox(
    cellsNow(sim).tokens.filter((t) => t.pc),
    grid,
  );
  if (!zone || !box) return;
  const s = sim.cam.scale;
  sim.cam = {
    scale: s,
    x: Math.round(zone.x + zone.w / 2 - (box.x + box.w / 2) * s),
    y: Math.round(zone.y + Math.min(zone.h, 300) / 2 - (box.y + box.h / 2) * s),
  };
  sim.mode = "moved";
}

/** The appearance refit (FR-MAP-61, -90): `fitted` only; kept while every token is clear. */
function appearanceRefit(sim: Sim): boolean {
  if (sim.mode !== "fitted" || !sim.cam) return false;
  const grid = gridOf(sim.state, sim.set.viewer);
  const boxes = cellsNow(sim).tokens.flatMap((t) => footprintBox([t], grid) ?? []);
  const { obstacles, cam } = fitNow(sim);
  if (appearanceKeeps(sim.cam, boxes, obstacles, sim.vp)) return false;
  sim.cam = cam;
  return true;
}

function dispatch(sim: Sim, action: WindowAction) {
  sim.ctl.dispatch(action, availableOf(sim));
}

/** The launcher-style user open (FR-SHELL-09): `toggle` of a window not open. */
function userOpen(sim: Sim, kind: string) {
  const w = windowsOf(sim).find((x) => x.kind === kind && x.instance === MAIN_INSTANCE);
  if (w?.state === "open") return;
  dispatch(sim, { type: "toggle", kind });
}

/** Kinds of the set registered on this client (pending kinds skipped until registered). */
export function setKinds(registry: WindowRegistry, set: ReplaySet): string[] {
  return [...set.kinds, ...(set.pending ?? [])].filter((k) => registry.get(k) !== undefined);
}

const isProtected = (registry: WindowRegistry, kind: string) =>
  registry.get(kind)?.defaultOpen === true;

/** A protected window's rect squeezed to its useful size in its corner (FR-SHELL-101). */
function squeezed(sim: Sim, kind: string, r: Rect): Rect {
  const def = sim.registry.get(kind);
  if (!def) return r;
  const u = useful(def, sim.vp, sim.registry);
  const w = Math.min(r.w, u.w);
  const h = Math.min(r.h, u.h);
  const a = def.defaultPosition.anchor;
  return {
    x: a.endsWith("right") ? r.x + r.w - w : r.x,
    y: a.startsWith("bottom") ? r.y + r.h - h : r.y,
    w,
    h,
  };
}

/** The I1 exemptions (FR-SHELL-116): protected-window L5 cells, by cell name, with a reason. */
export const I1_EXEMPT: ReadonlyMap<string, string> = new Map();

/**
 * The invariants after one step (FR-SHELL-116 I1–I3, I5, I6); `before` = stored windows before
 * the step; `opened` = the launcher kind a user open placed; `refit` = the step refitted the map
 * for a reveal / appearance (I6); `push` = a tool-bar push (FR-SHELL-104: it puts no other window
 * away, OQ-SHELL-61 A, so I3's oracle keeps the launcher windows).
 */
function check(
  sim: Sim,
  before: Windows,
  opts: { opened?: string; refit?: boolean; exemptI1?: boolean; push?: boolean } = {},
): string[] {
  const out: string[] = [];
  const shown = shownOf(sim);
  const tokens = tokensNow(sim);
  const pcs = pcBoxes(tokens);
  const hard = regionsOf(sim).filter((k) => k.kind === "hard");
  const list = [...shown.entries()];
  for (const [kind, { w, r }] of list) {
    // I1: no PC footprint + 4 px under a window; user spots are exempt (OQ-SHELL-62 A).
    if (!w.userSpot && !opts.exemptI1 && pcs.some((p) => overlaps(r, p))) {
      // Within the 4-px margin only: a fit that keeps footprints flush (the camera's, FR-MAP-93).
      const bare = tokens.some((t) => t.pc && overlaps(r, t));
      out.push(`I1 ${kind} over a PC${bare ? "" : " (4-px margin)"}`);
    }
    // I2: no overlap, nothing on a hard keep-out or the rail.
    for (const [other, o] of list) {
      if (other > kind && overlaps(r, o.r)) out.push(`I2 ${kind} over ${other}`);
    }
    for (const k of hard) if (overlaps(r, k.rect)) out.push(`I2 ${kind} on keep-out ${k.id}`);
    if (r.x < 56) out.push(`I2 ${kind} on the rail (x ${r.x})`);
    // I3: at least the useful size, unless no PC-clear spot at it exists (the brute oracle with
    // every launcher window put away and the protected ones squeezed to theirs, FR-SHELL-101).
    const def = sim.registry.get(kind);
    if (!def) continue;
    const u = useful(def, sim.vp, sim.registry);
    if (r.w < u.w || r.h < u.h) {
      const kept = list
        .filter(([k]) => k !== kind && (opts.push || isProtected(sim.registry, k)))
        .map(([k, s]) => (isProtected(sim.registry, k) ? squeezed(sim, k, s.r) : s.r));
      const best = bruteBest(
        def,
        sim.vp,
        { windows: kept, hard: hard.map((k) => k.rect), tokens },
        u,
      );
      if (best[0] === 0 && best[1] === 0) out.push(`I3 ${kind} ${r.w}×${r.h} below useful`);
    }
  }
  // I5: a user open moves no other window (it may put the least recently used one away, and
  // squeeze a protected one inside its rect, FR-SHELL-101).
  if (opts.opened) {
    const within = (a: Rect, b: Rect) =>
      a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    for (const w of windowsOf(sim)) {
      if (w.kind === opts.opened) continue;
      const b = before.find((x) => x.kind === w.kind && x.instance === w.instance);
      if (b?.state !== "open" || w.state !== "open" || rectKey(b) === rectKey(w)) continue;
      if (isProtected(sim.registry, w.kind) && within(w, b)) continue;
      out.push(`I5 ${w.kind} moved by opening ${opts.opened}`);
    }
  }
  // I6: a reveal / appearance refit never zooms in past the last full fit.
  if (opts.refit && cellPx(sim) > sim.lastFull + 0.01) {
    out.push(`I6 cell ${cellPx(sim).toFixed(1)} > last full fit ${sim.lastFull.toFixed(1)}`);
  }
  return out;
}

/**
 * I4: windows the step put away (minimised, not named by the action) were the least recently
 * used launcher windows (FR-SHELL-78: ascending z, then entry order) and the look-ahead needed
 * them: before the step no PC-clear spot at the opened kind's useful size existed.
 */
function checkPutAway(sim: Sim, before: Windows, opened: string, beforeTokens: PlacementToken[]) {
  const out: string[] = [];
  const parked = windowsOf(sim)
    .filter((w) => w.state === "minimised" && w.kind !== opened)
    .filter((w) => before.find((b) => b.kind === w.kind)?.state === "open")
    .map((w) => w.kind);
  if (parked.length === 0) return out;
  const available = availableOf(sim);
  const parkable = before
    .filter((w) => w.state === "open" && available.has(w.kind) && w.kind !== opened)
    .filter((w) => !isProtected(sim.registry, w.kind) && !sim.registry.get(w.kind)?.fixedDefault)
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.z - b.w.z || a.i - b.i)
    .map((e) => e.w.kind);
  if (parked.join() !== parkable.slice(0, parked.length).join()) {
    out.push(`I4 put away ${parked.join()}, LRU order ${parkable.join()}`);
  }
  const def = sim.registry.get(opened);
  if (def) {
    const open = before.filter(
      (w) => w.state === "open" && available.has(w.kind) && w.kind !== opened,
    );
    const rects = renderedWindowRects(
      open,
      sim.registry,
      available,
      sim.vp,
      new Map(),
      hardRects(regionsOf(sim)),
    );
    const hard = hardRects(regionsOf(sim));
    const best = bruteBest(
      def,
      sim.vp,
      { windows: rects, hard, tokens: beforeTokens },
      useful(def, sim.vp, sim.registry),
    );
    if (best[0] === 0 && best[1] === 0) out.push(`I4 put away ${parked.join()} though a spot fit`);
  }
  return out;
}

const snapshotOf = (sim: Sim) =>
  windowsOf(sim)
    .map((w) => `${w.kind}:${w.state}:${rectKey(w)}${w.userSpot ? ":user" : ""}`)
    .sort()
    .join(" ");

/** Stored rects of the open windows, for the round trips (I7). */
const openRects = (sim: Sim) =>
  windowsOf(sim)
    .filter((w) => w.state === "open")
    .map((w) => `${w.kind}@${rectKey(w)}`)
    .sort()
    .join(" ");

/** Viewports below `vp` in the reference chain, largest first. */
function chainBelow(vp: Viewport): Viewport[] {
  const i = REFERENCE_VIEWPORTS.findIndex((v) => v.w === vp.w && v.h === vp.h);
  return REFERENCE_VIEWPORTS.slice(0, Math.max(0, i)).reverse();
}

/**
 * Runs one cell: load at `vp` in the path's start state (token-free first layout, then the
 * load fit draws the tokens), `moved` cameras panned, the set opened, then the path. Returns
 * every step with its problems (empty = the cell passes).
 */
export function runReplay(
  registry: WindowRegistry,
  set: ReplaySet,
  camera: ReplayCamera,
  vp0: Viewport,
  path: ReplayPath,
): ReplayRun {
  const client = registry.client;
  const base: Omit<Sim, "ctl"> = {
    client,
    registry,
    set,
    vp: vp0,
    state: startState(client, path),
    combat: true,
    reports: new Map(),
    backend: new Map(),
    cam: null,
    mode: "fitted",
    lastFull: 0,
    key: KEY,
  };
  const sim = base as Sim;
  sim.ctl = newController(sim);
  const steps: ReplayStep[] = [];
  const record = (step: string, problems: string[]) =>
    steps.push({
      step,
      vp: sim.vp,
      windows: snapshotOf(sim),
      cell: cellPx(sim),
      log: sim.ctl.store.getState().settleLog,
      problems,
    });

  /** A page load: the stored layout applied with no token drawn, then the load fit draws them. */
  /** `moved`: the camera is panned after the load fit (a reload always fits: `fitted`). */
  const load = (label: string, moved = camera === "moved") => {
    sim.cam = null;
    sim.ctl = newController(sim);
    sim.ctl.restore(sim.key);
    fullFit(sim);
    if (moved) moveCamera(sim);
    // FR-SHELL-95: `load` settles once more after the first token draw, at that camera.
    dispatch(sim, { type: "load", drawn: true });
    record(label, check(sim, windowsOf(sim)));
  };
  const kinds = setKinds(registry, set);
  const openAll = (label: string) => {
    for (const kind of kinds) {
      const before = windowsOf(sim);
      const beforeTokens = tokensNow(sim);
      userOpen(sim, kind);
      const problems = check(sim, before, { opened: kind });
      problems.push(...checkPutAway(sim, before, kind, beforeTokens));
      record(`${label} ${kind}`, problems);
    }
  };
  const launcherKinds = kinds.filter((k) => !isProtected(registry, k));

  load("load");
  if (path !== "load") openAll("open");
  switch (path) {
    case "open":
      break;
    case "reopen": {
      for (const kind of launcherKinds) dispatch(sim, { type: "close", kind });
      openAll("reopen");
      break;
    }
    case "push": {
      const pre = openRects(sim);
      const bar = toolBar(client, sim.vp);
      let before = windowsOf(sim);
      sim.reports.set("map.toolbar", bar);
      dispatch(sim, { type: "push", rect: bar });
      record("push show", check(sim, before, { push: true }));
      before = windowsOf(sim);
      dispatch(sim, { type: "push", rect: bar });
      record("push re-select", check(sim, before, { push: true }));
      // A user drags a pushed launcher window back under the bar, onto its spot before the push
      // (FR-SHELL-105, walkthrough F7).
      const preOf = (k: string) => pre.split(" ").find((e) => e.startsWith(`${k}@`));
      const drag = launcherKinds.find((k) => {
        const now = windowsOf(sim).find((w) => w.kind === k);
        return (
          now?.state === "open" && preOf(k) !== undefined && preOf(k) !== `${k}@${rectKey(now)}`
        );
      });
      let dropped: string | null = null;
      if (drag) {
        const [x, y, wh] = (preOf(drag) as string).slice(drag.length + 1).split(",");
        const [w, h] = (wh as string).split("×");
        const rect = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
        dispatch(sim, { type: "setRect", kind: drag, rect });
        dropped = `${drag}@${rectKey(rect)}`;
        before = windowsOf(sim);
        record("push drag-end", check(sim, before, { push: true }));
      }
      before = windowsOf(sim);
      sim.reports.delete("map.toolbar");
      dispatch(sim, { type: "return" });
      const problems = check(sim, before);
      // I7: push + return restores (the dragged window returns to its drop spot).
      const want = pre
        .split(" ")
        .map((e) => (drag && e.startsWith(`${drag}@`) ? (dropped as string) : e))
        .sort()
        .join(" ");
      if (openRects(sim) !== want) problems.push(`I7 return: ${openRects(sim)} ≠ ${want}`);
      record("return", problems);
      break;
    }
    case "resize": {
      const start = snapshotOf(sim);
      const down = chainBelow(vp0);
      const chain = down.length > 0 ? [...down, ...down.slice(0, -1).reverse(), vp0] : [];
      const route = down.length > 0 ? chain : [REFERENCE_VIEWPORTS[2] as Viewport, vp0];
      for (const next of route) {
        const before = windowsOf(sim);
        sim.vp = next;
        dispatch(sim, { type: "viewport" });
        if (sim.mode === "fitted") fullFit(sim);
        record(`viewport ${next.w}×${next.h}`, check(sim, before));
      }
      // I7: down and back up restores the start (1280×720 has nothing below: up and back, no I7).
      const end = snapshotOf(sim);
      if (end !== start && down.length > 0)
        steps.push({
          ...(steps.at(-1) as ReplayStep),
          step: "I7",
          problems: [`I7 resize: ${end} ≠ ${start}`],
        });
      break;
    }
    case "reveal": {
      const before = windowsOf(sim);
      const prev = new Set(tokensNow(sim).map((t) => t.id));
      sim.state = "ambush-revealed";
      const grid = gridOf(sim.state, set.viewer);
      const drawn = cellsNow(sim).tokens.flatMap((t) => {
        const box = footprintBox([t], grid);
        return box ? [{ id: t.id, box }] : [];
      });
      let refit = false;
      if (sim.cam) {
        const { obstacles, cam } = fitNow(sim);
        if (revealRefit(prev, drawn, sim.cam, obstacles, visibleArea(sim.vp), sim.mode)) {
          sim.cam = cam;
          refit = true;
        }
      }
      record("reveal", check(sim, before, { refit }));
      break;
    }
    case "load": {
      // r03: a reload (the load fit, `fitted`), then the settle after the first draw again: a
      // settled layout stays (FR-SHELL-95 `load`, F5).
      openAll("open");
      load("reload", false);
      const settled = snapshotOf(sim);
      dispatch(sim, { type: "load", drawn: true });
      const problems = check(sim, windowsOf(sim));
      if (snapshotOf(sim) !== settled) problems.push(`load twice: ${snapshotOf(sim)} ≠ ${settled}`);
      record("load again", problems);
      break;
    }
    case "Start": {
      // End: the fight goes (the player's Initiative with it), then Start "Escort to the Ford".
      let before = windowsOf(sim);
      sim.combat = false;
      // The page dispatches `return` when a kind goes (FR-SHELL-102).
      dispatch(sim, { type: "return" });
      record("End", check(sim, before));
      before = windowsOf(sim);
      sim.state = "escort";
      sim.combat = true;
      if (client === "dm") dispatch(sim, { type: "open", kind: "cbt.initiative", by: "feature" });
      else dispatch(sim, { type: "appear", kind: "cbt.initiative" });
      const refit = appearanceRefit(sim);
      record("Start", check(sim, before, { refit }));
      break;
    }
    case "reset": {
      const before = windowsOf(sim);
      dispatch(sim, { type: "reset" });
      fullFit(sim);
      record("reset", check(sim, before));
      break;
    }
  }
  return { steps, problems: steps.flatMap((s) => s.problems.map((p) => `${s.step}: ${p}`)) };
}

/** Every cell of a client: [name, set, camera, viewport, path]. */
export function replayCells(registry: WindowRegistry) {
  const out: {
    name: string;
    set: ReplaySet;
    camera: ReplayCamera;
    vp: Viewport;
    path: ReplayPath;
  }[] = [];
  for (const set of REPLAY_SETS[registry.client]) {
    for (const camera of REPLAY_CAMERAS) {
      for (const vp of REFERENCE_VIEWPORTS) {
        for (const path of replayPaths(registry.client)) {
          out.push({ name: replayName(set.name, camera, vp, path), set, camera, vp, path });
        }
      }
    }
  }
  return out;
}

/**
 * FR-SHELL-116's repro cases: the cells that replay them (sim-11 g is BL-64; the push repro is
 * WF2's, the reveal and load ones WF3's camera).
 */
export const REPROS: Record<ShellClient, readonly { name: string; cell: string }[]> = {
  dm: [
    {
      name: "sim-11 g, BL-64 (D1 escort @1280×720)",
      cell: replayName("D1", "fitted", { w: 1280, h: 720 }, "open"),
    },
    {
      name: "sim-10 b00 (D2 @1440×900 Start)",
      cell: replayName("D2", "fitted", { w: 1440, h: 900 }, "Start"),
    },
    {
      name: "BL-60 (D1 1440×900 → 1280×720 → 1440×900)",
      cell: replayName("D1", "fitted", { w: 1440, h: 900 }, "resize"),
    },
    { name: "BL-61 (D2 push)", cell: replayName("D2", "fitted", { w: 1440, h: 900 }, "push") },
  ],
  player: [
    {
      name: "sim-11 h (P1 reveal @1280×800)",
      cell: replayName("P1", "fitted", { w: 1280, h: 800 }, "reveal"),
    },
    { name: "sim-11 r03 (P1 load)", cell: replayName("P1", "fitted", { w: 1280, h: 800 }, "load") },
    {
      name: "BL-66 (P1 open @1280×800)",
      cell: replayName("P1", "fitted", { w: 1280, h: 800 }, "open"),
    },
    {
      name: "BL-70 (P1 Start @1280×800)",
      cell: replayName("P1", "fitted", { w: 1280, h: 800 }, "Start"),
    },
  ],
};
