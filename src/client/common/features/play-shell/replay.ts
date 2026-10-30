// Session-replay layout harness (FR-SHELL-114–116, play-shell §13 sprint 8). Drives the shell
// controller (the app's own placement path, in memory) and the real pure camera through the
// `session-sim-11` states of `replay-cells.generated.ts`, for one window set, camera mode,
// viewport and path, and checks the invariants I1–I8 after every step. Test-only: nothing here
// runs in the app.
import { MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import { footprint } from "@shared/scenes-map/geometry";
import {
  appearanceKeeps,
  type Camera,
  createSizeCameras,
  dryFitScene,
  type FitInputs,
  type FitReason,
  type FitToken,
  type FitVisible,
  fitFor,
  footprintBox,
  layoutKey,
  revealRefit,
  visibleArea,
} from "../scenes-map/camera";
import { fitRooms, renderedWindowRects, storedLayout } from "./free-area";
import { isRemembered, placedRect, type Rect, type Viewport, workArea } from "./geometry";
import { hardRects, type KeepOut, keepOuts } from "./keep-outs";
import { bruteBest, overlaps, REFERENCE_VIEWPORTS } from "./layout-checks";
import { defaultLayout, pushBars, useful, type WindowAction, type Windows } from "./manager";
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
  | "reset"
  | "memory";

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
        "dicex.requests", // TT2 (S3)
        "hold.stronghold", // RS2 (S4, FR-SHELL-171)
        "cmp.rules", // SP2 (S4): untouched
        "recap.session", // SP3 (S4, FR-RECAP-10)
        "dice.details", // FR-DICE-106
      ],
    },
  ],
  player: [
    // PM2 (FR-SHELL-160); RS2 (S4, FR-SHELL-171); SP2 (S4): cmp.rules untouched; SP3 (S4, FR-RECAP-10)
    {
      name: "P1",
      viewer: "player-1",
      kinds: [...P1, "party.board", "hold.stronghold", "cmp.rules", "recap.session"],
    },
    {
      name: "P2",
      viewer: "player-1",
      kinds: [...P1, "cmp.compendium", "note.history", "party.board"],
    },
    {
      name: "P3",
      viewer: "player-2",
      kinds: [
        "char.sheet",
        "cbt.initiative",
        "dice.log",
        "stats.board",
        "party.board",
        "dice.details",
      ], // PM2; FR-DICE-106
    },
  ],
};

export const REPLAY_CAMERAS: readonly ReplayCamera[] = ["fitted", "moved"];

/** The paths each client runs (FR-SHELL-115): reveal is the players' (FR-MAP-82). */
export function replayPaths(client: ShellClient): ReplayPath[] {
  const all: ReplayPath[] = ["open", "reopen", "push", "resize", "load", "Start", "reset"];
  const paths: ReplayPath[] =
    client === "player" ? [...all.slice(0, 4), "reveal", ...all.slice(4)] : all;
  // FR-SHELL-162: window memory (sprint 9).
  return [...paths, "memory"];
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
  /** Memory path (FR-SHELL-163): each open window's rendered rect, `kind@x,y,w×h`. */
  drawn?: string;
  /** Scripts: the last fit's `data-fit-visible`. */
  fit?: FitVisible;
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
  /** The last fit's `data-fit-visible` (FR-MAP-46, -59). */
  visible?: FitVisible;
  /** The canvas's camera per viewport size (H2 FAIL 5), dropped at a page load. */
  sizeCams: ReturnType<typeof createSizeCameras<SizeCam>>;
  key: string;
}

interface SizeCam {
  cam: Camera;
  visible: FitVisible | undefined;
  lastFull: number;
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
    dryFit: (obstacles, reason) => dryFit(sim as Sim, obstacles, reason),
    lastFullCell: () => sim.lastFull || null,
    // FR-MAP-97: an accepted yield refits once, still `fitted`.
    onYield: () => {
      (sim as Sim).cam = fitNow(sim as Sim, undefined, "window").cam;
    },
    // FR-MAP-114: the same `window` refit, `fitted` only.
    onRefit: () => {
      if ((sim as Sim).mode === "fitted")
        (sim as Sim).cam = fitNow(sim as Sim, undefined, "window").cam;
    },
    warn: () => {},
  });
}

/**
 * The base port's dry fit (FR-SHELL-108, FR-MAP-97): the `window` fit with `obstacles` as the
 * windows, not applied (the canvas's own `dryFitScene`).
 */
function dryFit(sim: Sim, obstacles: readonly Rect[], reason?: "window" | "resize") {
  if (!sim.cam) return null;
  return dryFitScene(fitInputs(sim, obstacles), sim.lastFull || null, reason);
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
    pushBars(regionsOf(sim)),
  );
  return new Map(open.map((w, i) => [w.kind, { w, r: rects[i] as Rect }]));
}

/**
 * The fit's inputs (FR-MAP-93): the rendered windows (or `with_`) and toast box as obstacles; the
 * same without the remembered windows while one is shown (BL-100).
 */
function fitInputs(sim: Sim, with_?: readonly Rect[]): FitInputs {
  const shown = [...shownOf(sim).values()];
  const windows = with_ ? [...with_] : shown.map((s) => s.r);
  const rooms = fitRooms(sim.client, windows, regionsOf(sim), sim.vp, null);
  const kept = shown.filter((s) => !isRemembered(s.w)).map((s) => s.r);
  const untouched =
    !with_ && kept.length < shown.length
      ? fitRooms(sim.client, kept, regionsOf(sim), sim.vp, null)
      : undefined;
  const cells = cellsNow(sim);
  const tokens: FitToken[] = cells.tokens.map((t) => ({
    col: t.col,
    row: t.row,
    size: t.size,
    pc: t.pc,
  }));
  const map = { w: cells.scene.mapWidth, h: cells.scene.mapHeight };
  const grid = gridOf(sim.state, sim.set.viewer);
  return {
    client: sim.client,
    tokens,
    grid,
    map,
    view: sim.vp,
    ...rooms,
    ...(untouched && { untouched }),
  };
}

/** The fit (FR-MAP-95: the canvas's one fit path) for `reason`, bounded by the last full fit. */
function fitNow(
  sim: Sim,
  with_?: readonly Rect[],
  reason: FitReason = "fit",
): { cam: Camera; obstacles: readonly Rect[]; visible: FitVisible } {
  const inputs = fitInputs(sim, with_);
  const f = fitFor(reason, inputs, sim.lastFull || null);
  const cam = { x: f.x, y: f.y, scale: f.scale };
  return { cam, obstacles: inputs.room.obstacles, visible: f.visible };
}

const cellPx = (sim: Sim) => (sim.cam ? sim.cam.scale * cellsNow(sim).scene.gridCellSize : 0);

/** A full fit (Fit, open, load, reset, resize): the camera `fitted`, its cell the new baseline. */
function fullFit(sim: Sim, reason: FitReason = "fit") {
  const f = fitNow(sim, undefined, reason);
  sim.cam = f.cam;
  sim.visible = f.visible;
  sim.mode = "fitted";
  sim.lastFull = cellPx(sim);
}

/** The layout a recorded camera framed (`layoutKey`, as the canvas keys it). */
const layoutOf = (sim: Sim) =>
  layoutKey(
    sim.state,
    cellsNow(sim).tokens,
    storedLayout(windowsOf(sim).filter((w) => w.state === "open" && availableOf(sim).has(w.kind))),
  );

/**
 * A browser resize to `next` (FR-MAP-47, -113): the camera kept for the size it leaves, the
 * `viewport` settle, then while `fitted` the resize refit, or the camera recorded at `next` when
 * the layout there is the same (H2 FAIL 5, the canvas's `createSizeCameras`).
 */
function resizeTo(sim: Sim, next: Viewport) {
  if (sim.mode === "fitted" && sim.cam) {
    sim.sizeCams.record(sim.vp, layoutOf(sim), {
      cam: sim.cam,
      visible: sim.visible,
      lastFull: sim.lastFull,
    });
  }
  sim.vp = next;
  dispatch(sim, { type: "viewport" });
  if (sim.mode !== "fitted") return;
  const kept = sim.sizeCams.take(sim.vp, layoutOf(sim));
  if (!kept) return fullFit(sim, "resize");
  sim.cam = kept.cam;
  sim.visible = kept.visible;
  sim.lastFull = kept.lastFull;
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

/** A pan (the camera `moved`): the PCs' footprint box centred on screen point `at`. */
function panTo(sim: Sim, at: { x: number; y: number }) {
  if (!sim.cam) return;
  const box = footprintBox(
    cellsNow(sim).tokens.filter((t) => t.pc),
    gridOf(sim.state, sim.set.viewer),
  );
  if (!box) return;
  const s = sim.cam.scale;
  sim.cam = {
    scale: s,
    x: Math.round(at.x - (box.x + box.w / 2) * s),
    y: Math.round(at.y - (box.y + box.h / 2) * s),
  };
  sim.mode = "moved";
}

/** The appearance refit (FR-MAP-61, -90): `fitted` only; kept while every token is clear. */
function appearanceRefit(sim: Sim): boolean {
  if (sim.mode !== "fitted" || !sim.cam) return false;
  const grid = gridOf(sim.state, sim.set.viewer);
  const boxes = cellsNow(sim).tokens.flatMap((t) => {
    const b = footprintBox([t], grid);
    return b ? [{ ...b, pc: t.pc }] : [];
  });
  const { obstacles, cam } = fitNow(sim, undefined, "appearance");
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
    // I1–I3 exempt remembered windows (FR-SHELL-162; I9–I13 cover them).
    if (isRemembered(w)) continue;
    // I1: no PC footprint + 4 px under a window.
    if (!opts.exemptI1 && pcs.some((p) => overlaps(r, p))) {
      // Within the 4-px margin only: a fit that keeps footprints flush (the camera's, FR-MAP-93).
      const bare = tokens.some((t) => t.pc && overlaps(r, t));
      out.push(`I1 ${kind} over a PC${bare ? "" : " (4-px margin)"}`);
    }
    // I2: no overlap, nothing on a hard keep-out or the rail.
    // Between untouched windows (an untouched one on a remembered one only at FR-SHELL-45's last
    // resort, I2's memory clause in `checkMemory`).
    for (const [other, o] of list) {
      if (other > kind && !isRemembered(o.w) && overlaps(r, o.r)) {
        out.push(`I2 ${kind} over ${other}`);
      }
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
  // I5: a user open moves no other window (it may put the least recently used one away, squeeze
  // a protected one inside its rect, FR-SHELL-101, and shrink an untouched launcher window inside
  // its rect down to no less than its useful size, L3s, BL-99; sprint 11 F1, BL-109: after one
  // put-away, move an untouched launcher window at its size rather than put away a second, L3r).
  if (opts.opened) {
    const moved = new Set(
      [...sim.ctl.store.getState().settleLog.matchAll(/:([^:;>]+)>L3r/g)].map((m) => m[1]),
    );
    const within = (a: Rect, b: Rect) =>
      a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    const atLeastUseful = (w: WindowState) => {
      const def = sim.registry.get(w.kind);
      const u = def && useful(def, sim.vp, sim.registry);
      return u !== undefined && w.w >= u.w && w.h >= u.h;
    };
    for (const w of windowsOf(sim)) {
      if (w.kind === opts.opened) continue;
      const b = before.find((x) => x.kind === w.kind && x.instance === w.instance);
      if (b?.state !== "open" || w.state !== "open" || rectKey(b) === rectKey(w)) continue;
      if (isProtected(sim.registry, w.kind) && within(w, b)) continue;
      if (!isRemembered(b) && within(w, b) && atLeastUseful(w)) continue;
      const sameSize = w.w === b.w && w.h === b.h;
      if (!isRemembered(b) && moved.has(w.kind) && sameSize && atLeastUseful(w)) continue;
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
 * FR-SHELL-162's memory invariants after a step (protocol §18): `kept` = each remembered kind →
 * its stored rect; `touched` = the kind the step opened, focused or dragged.
 *   I9  a remembered window's stored rect never changes except by Reset;
 *   I10 it renders at the reopen algorithm's steps 3–4 (fit + clamp, then pushed off a shown bar),
 *       which is the stored rect at the size it was set with no bar shown;
 *   I11 the touched window has the highest z;
 *   I12 no remembered window is put away, squeezed or displaced (its flags and state kept).
 */
function checkMemory(sim: Sim, kept: ReadonlyMap<string, Rect>, touched?: string): string[] {
  const out: string[] = [];
  const ws = windowsOf(sim);
  const regions = regionsOf(sim);
  const bars = pushBars(regions);
  const shown = shownOf(sim);
  for (const [kind, rect] of kept) {
    const w = ws.find((x) => x.kind === kind && x.instance === MAIN_INSTANCE);
    if (!w) {
      out.push(`I9 ${kind} gone`);
      continue;
    }
    if (rectKey(w) !== rectKey(rect))
      out.push(`I9 ${kind} stored ${rectKey(w)} ≠ ${rectKey(rect)}`);
    if (!isRemembered(w)) out.push(`I12 ${kind} forgotten`);
    if (sim.ctl.store.getState().autoMinimised.has(`${kind}:${MAIN_INSTANCE}`)) {
      out.push(`I12 ${kind} put away`);
    }
    const def = sim.registry.get(kind);
    const s = shown.get(kind);
    if (!def || !s) continue;
    const want = placedRect(w, def.minSize, sim.vp, bars);
    if (rectKey(s.r) !== rectKey(want))
      out.push(`I10 ${kind} drawn ${rectKey(s.r)} ≠ ${rectKey(want)}`);
    const atSet = w.area?.w === workArea(sim.vp).w && w.area?.h === workArea(sim.vp).h;
    const onScreen = rect.x >= 0 && rect.x + rect.w <= sim.vp.w;
    if (bars.length === 0 && atSet && onScreen && rectKey(s.r) !== rectKey(rect)) {
      out.push(`I10 ${kind} drawn ${rectKey(s.r)} ≠ stored ${rectKey(rect)}`);
    }
  }
  if (touched) {
    const top = [...ws].sort((a, b) => b.z - a.z)[0];
    if (top?.kind !== touched) out.push(`I11 ${touched} not on top (${top?.kind})`);
  }
  return out;
}

/** I13: after Reset no entry has `userSpot` / `userSize` / `fixedH`; the layout = the named default. */
function checkReset(sim: Sim): string[] {
  const ws = windowsOf(sim);
  const out = ws
    .filter((w) => w.userSpot || w.userSize || w.fixedH)
    .map((w) => `I13 ${w.kind} still remembered`);
  const named = defaultLayout(sim.registry, sim.vp, [], regionsOf(sim));
  if (snapshot(ws) !== snapshot(named)) out.push(`I13 not the named default layout`);
  return out;
}

const snapshot = (ws: Windows) =>
  ws
    .map((w) => `${w.kind}:${w.state}:${rectKey(w)}`)
    .sort()
    .join(" ");

/**
 * FR-SHELL-162 (1)'s scripted spots for the open launcher kinds, in order: over a PC, over another
 * window, at the right edge, partly off-screen; the first one is also resized.
 */
export function memorySpots(
  kinds: readonly string[],
  vp: Viewport,
  pc: Rect | undefined,
  other: Rect | undefined,
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const w = 360;
  const h = 360;
  const spots: Rect[] = [
    {
      x: Math.round((pc?.x ?? 400) - 40),
      y: Math.max(60, Math.round((pc?.y ?? 200) - 40)),
      w: 400,
      h: 380,
    },
    // Over another window, kept above the launcher strip.
    {
      x: (other?.x ?? 500) + 30,
      y: Math.max(60, Math.min((other?.y ?? 100) + 30, vp.h - 64 - h)),
      w,
      h,
    },
    { x: vp.w - w - 12, y: 140, w, h },
    { x: vp.w - 140, y: 220, w, h },
  ];
  kinds.forEach((k, i) => {
    const s = spots[i % spots.length] as Rect;
    out.set(k, { ...s, y: s.y + Math.floor(i / spots.length) * 24 });
  });
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
    // FR-SHELL-151: only untouched launcher windows are put away.
    .filter((w) => !isRemembered(w))
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
      pushBars(regionsOf(sim)),
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
    sizeCams: createSizeCameras<SizeCam>(),
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
    sim.sizeCams = createSizeCameras<SizeCam>();
    sim.ctl = newController(sim);
    sim.ctl.restore(sim.key);
    fullFit(sim, "load");
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
      /** Protected windows the drop sent back to their zone (FR-SHELL-149, -159), as dropped. */
      const zoned = new Map<string, string>();
      if (drag) {
        const [x, y, wh] = (preOf(drag) as string).slice(drag.length + 1).split(",");
        const [w, h] = (wh as string).split("×");
        const rect = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
        dispatch(sim, { type: "setRect", kind: drag, rect });
        dropped = `${drag}@${rectKey(rect)}`;
        before = windowsOf(sim);
        record("push drag-end", check(sim, before, { push: true }));
        // BL-134: the drop ends a squeeze the dragged window caused (walkthrough M9): that zone
        // is the layout the return restores.
        for (const step of sim.ctl.store.getState().settleLog.split(";")) {
          const m = /^drag-end:(.+)>zone$/.exec(step);
          const w = m && windowsOf(sim).find((x) => x.kind === m[1] && x.state === "open");
          if (w) zoned.set(w.kind, `${w.kind}@${rectKey(w)}`);
        }
      }
      before = windowsOf(sim);
      sim.reports.delete("map.toolbar");
      dispatch(sim, { type: "return" });
      const problems = check(sim, before);
      // I7: push + return restores (the dragged window returns to its drop spot, a zone the drop
      // gave back stays).
      const kindOf = (e: string) => e.slice(0, e.indexOf("@"));
      const want = pre
        .split(" ")
        .map((e) =>
          drag && kindOf(e) === drag ? (dropped as string) : (zoned.get(kindOf(e)) ?? e),
        )
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
        resizeTo(sim, next);
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
        const { obstacles, cam } = fitNow(sim, undefined, "reveal");
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
    case "memory": {
      const drawnNow = () =>
        [...shownOf(sim).entries()]
          .map(([k, s]) => `${k}@${rectKey(s.r)}`)
          .sort()
          .join(" ");
      // FR-SHELL-162: (1) drag each open launcher window to a scripted spot, resize the first.
      const open = launcherKinds.filter(
        (k) => windowsOf(sim).find((w) => w.kind === k)?.state === "open",
      );
      const shown = shownOf(sim);
      const pc = tokensNow(sim).find((t) => t.pc);
      const other = [...shown.entries()].find(([k]) => isProtected(registry, k))?.[1].r;
      const spots = memorySpots(open, sim.vp, pc, other);
      const kept = new Map<string, Rect>();
      for (const [i, kind] of open.entries()) {
        const before = windowsOf(sim);
        dispatch(sim, { type: "focus", kind }); // the pointer-down that starts the drag
        dispatch(sim, { type: "setRect", kind, rect: spots.get(kind) as Rect, resized: i === 0 });
        const w = windowsOf(sim).find((x) => x.kind === kind) as WindowState;
        kept.set(kind, { x: w.x, y: w.y, w: w.w, h: w.h });
        const problems = check(sim, before);
        problems.push(...checkMemory(sim, kept, kind));
        // A drag moves nothing else (but a protected window the dragged one had squeezed goes
        // back to its zone: nothing makes room for a remembered window, FR-SHELL-159).
        const placedNow = sim.ctl.store.getState().placed;
        for (const b of before) {
          const a = windowsOf(sim).find((x) => x.kind === b.kind);
          if (placedNow.get(`${b.kind}:${MAIN_INSTANCE}`) === "returned") continue;
          if (b.kind !== kind && a && (rectKey(a) !== rectKey(b) || a.state !== b.state)) {
            problems.push(`I12 ${b.kind} moved by dragging ${kind}`);
          }
        }
        record(`memory drag ${kind}`, problems);
        (steps.at(-1) as ReplayStep).drawn = drawnNow();
      }
      // (2) close + reopen each: exact, on top.
      for (const kind of open) {
        const before = windowsOf(sim);
        dispatch(sim, { type: "close", kind });
        userOpen(sim, kind);
        record(`memory reopen ${kind}`, [...check(sim, before), ...checkMemory(sim, kept, kind)]);
      }
      // (3) reload.
      load("memory reload");
      (steps.at(-1) as ReplayStep).problems.push(...checkMemory(sim, kept));
      // (4) resize down and back.
      const down = chainBelow(vp0);
      const route =
        down.length > 0
          ? [...down, ...down.slice(0, -1).reverse(), vp0]
          : [REFERENCE_VIEWPORTS[2] as Viewport, vp0];
      for (const next of route) {
        const before = windowsOf(sim);
        resizeTo(sim, next);
        record(`memory viewport ${next.w}×${next.h}`, [
          ...check(sim, before),
          ...checkMemory(sim, kept),
        ]);
        (steps.at(-1) as ReplayStep).drawn = drawnNow();
      }
      // (5) the tool bar shown, a reload while shown, the bar gone.
      const bar = toolBar(client, sim.vp);
      sim.reports.set("map.toolbar", bar);
      dispatch(sim, { type: "push", rect: bar });
      record("memory bar shown", [
        ...check(sim, windowsOf(sim), { push: true }),
        ...checkMemory(sim, kept),
      ]);
      load("memory reload with the bar");
      (steps.at(-1) as ReplayStep).problems.push(...checkMemory(sim, kept));
      sim.reports.delete("map.toolbar");
      dispatch(sim, { type: "return" });
      record("memory bar gone", [...check(sim, windowsOf(sim)), ...checkMemory(sim, kept)]);
      // (6) End, then Start: remembered windows stay where they are.
      sim.combat = false;
      dispatch(sim, { type: "return" });
      record("memory End", checkMemory(sim, kept));
      const before = windowsOf(sim);
      sim.state = "escort";
      sim.combat = true;
      if (client === "dm") dispatch(sim, { type: "open", kind: "cbt.initiative", by: "feature" });
      else dispatch(sim, { type: "appear", kind: "cbt.initiative" });
      const refit = appearanceRefit(sim);
      record("memory Start", [
        ...check(sim, before, { refit }),
        ...checkMemory(sim, kept, "cbt.initiative"),
      ]);
      // (7) Reset: every window untouched, the named default.
      dispatch(sim, { type: "reset" });
      fullFit(sim);
      record("memory reset", checkReset(sim));
      // (8) one untouched window opened: placed by the ladder.
      const first = launcherKinds[0];
      if (first) {
        const b = windowsOf(sim);
        const beforeTokens = tokensNow(sim);
        userOpen(sim, first);
        const problems = check(sim, b, { opened: first });
        problems.push(...checkPutAway(sim, b, first, beforeTokens));
        record(`memory open ${first}`, problems);
      }
      break;
    }
  }
  return { steps, problems: steps.flatMap((s) => s.problems.map((p) => `${s.step}: ${p}`)) };
}

/**
 * One step of a scripted run (walkthrough repros): a user open, a fight's End / Start, a reload,
 * Fit, a pan putting the PCs' centre at a screen point (the camera `moved`), a user's drag (and
 * resize) of a window to `rect` (remembered, FR-SHELL-144), or a browser resize (the `viewport`
 * settle, then the resize refit while `fitted`).
 */
export type ScriptStep =
  | { open: string }
  | { close: string }
  | { drag: string; rect: Rect; resized?: boolean }
  | { viewport: Viewport }
  | { pan: { x: number; y: number } }
  /** A map tool bar shown at `rect` (a `push`), or `null`: the bar goes (a `return`). */
  | { toolbar: Rect | null }
  | "end"
  | "start"
  | "reload"
  | "fit";

/**
 * A walkthrough repro in the harness's world (`fitted` camera): load in `state` at `vp` with
 * nothing open but the protected windows, then `script`, with I1–I6 after every step. Same
 * controller, camera and base port as `runReplay`.
 */
export function runScript(
  registry: WindowRegistry,
  viewer: ReplayViewer,
  vp: Viewport,
  state: ReplayState,
  script: readonly ScriptStep[],
): ReplayRun {
  const client = registry.client;
  const sim = {
    client,
    registry,
    set: { name: "script", viewer, kinds: [] },
    vp,
    state,
    combat: true,
    reports: new Map(),
    backend: new Map(),
    cam: null,
    mode: "fitted",
    lastFull: 0,
    key: KEY,
    sizeCams: createSizeCameras<SizeCam>(),
  } as unknown as Sim;
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
      ...(sim.visible && { fit: sim.visible }),
    });
  const load = (label: string) => {
    sim.cam = null;
    sim.sizeCams = createSizeCameras<SizeCam>();
    sim.ctl = newController(sim);
    sim.ctl.restore(sim.key);
    fullFit(sim, "load");
    dispatch(sim, { type: "load", drawn: true });
    record(label, check(sim, windowsOf(sim)));
  };
  load("load");
  for (const step of script) {
    const before = windowsOf(sim);
    if (step === "reload") {
      load("reload");
    } else if (step === "fit") {
      fullFit(sim);
      record("fit", check(sim, before));
    } else if (step === "end") {
      sim.combat = false;
      dispatch(sim, { type: "return" });
      record("End", check(sim, before));
    } else if (step === "start") {
      sim.state = "escort";
      sim.combat = true;
      if (client === "dm") dispatch(sim, { type: "open", kind: "cbt.initiative", by: "feature" });
      else dispatch(sim, { type: "appear", kind: "cbt.initiative" });
      const refit = appearanceRefit(sim);
      record("Start", check(sim, before, { refit }));
    } else if ("viewport" in step) {
      resizeTo(sim, step.viewport);
      record(`viewport ${sim.vp.w}×${sim.vp.h}`, check(sim, before));
    } else if ("drag" in step) {
      dispatch(sim, { type: "focus", kind: step.drag });
      const resized = step.resized === true;
      dispatch(sim, { type: "setRect", kind: step.drag, rect: step.rect, resized });
      record(`drag ${step.drag}`, check(sim, before));
    } else if ("pan" in step) {
      panTo(sim, step.pan);
      record(`pan ${step.pan.x},${step.pan.y}`, []);
    } else if ("toolbar" in step) {
      if (step.toolbar) {
        sim.reports.set("map.toolbar", step.toolbar);
        dispatch(sim, { type: "push", rect: step.toolbar });
        record("toolbar show", check(sim, before, { push: true }));
      } else {
        sim.reports.delete("map.toolbar");
        dispatch(sim, { type: "return" });
        record("toolbar hide", check(sim, before));
      }
    } else if ("open" in step) {
      const beforeTokens = tokensNow(sim);
      userOpen(sim, step.open);
      const problems = check(sim, before, { opened: step.open });
      problems.push(...checkPutAway(sim, before, step.open, beforeTokens));
      record(`open ${step.open}`, problems);
    } else {
      dispatch(sim, { type: "close", kind: step.close });
      record(`close ${step.close}`, check(sim, before));
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

/**
 * FR-SHELL-163's `memory` golden table: FR-SHELL-162 (1)'s scripted spots in the client's first
 * set (`fitted`), set at 1600×900 → each dragged window's stored rect and its rendered rect at
 * the four sizes (FR-SHELL-147's render-only nudge on the way down).
 */
export function memoryGolden(registry: WindowRegistry) {
  const set = REPLAY_SETS[registry.client][0] as ReplaySet;
  const big = REFERENCE_VIEWPORTS.at(-1) as Viewport;
  const run = runReplay(registry, set, "fitted", big, "memory");
  const drags = run.steps.filter((s) => s.step.startsWith("memory drag"));
  const last = drags.at(-1);
  if (!last) return [];
  const parse = (list: string | undefined) =>
    new Map(
      (list ?? "")
        .split(" ")
        .map((e) => [e.slice(0, e.indexOf("@")), e.slice(e.indexOf("@") + 1)] as const),
    );
  const stored = new Map(
    last.windows.split(" ").map((e) => {
      const [kind, , rect] = e.split(":");
      return [kind, rect] as const;
    }),
  );
  const at = new Map<string, Map<string, string>>([[`${big.w}×${big.h}`, parse(last.drawn)]]);
  for (const s of run.steps) {
    const m = /^memory viewport (\d+×\d+)$/.exec(s.step);
    if (m?.[1] && !at.has(m[1])) at.set(m[1], parse(s.drawn));
  }
  return drags.map((d) => {
    const kind = d.step.slice("memory drag ".length);
    return {
      kind,
      stored: stored.get(kind),
      drawn: Object.fromEntries([...at].map(([vp, m]) => [vp, m.get(kind) ?? null])),
    };
  });
}
