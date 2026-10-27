// The one placer (FR-SHELL-95–113, ADR-0060) on a DM-shaped registry: Initiative (top-right) and
// the Game log (bottom-left) protected, launcher windows like Compendium; pure, through the
// manager and the shell controller (play-shell §13 sprint 8, `placer.test.ts`).
import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { emptyStore } from "@shared/protocol/store";
import { type ChromeKeepOut, chromeFits, chromeKeepOuts } from "./chrome-keep-outs";
import {
  clampRect,
  moveRect,
  placedRect,
  type Rect,
  renderedRect,
  type Viewport,
  workArea,
} from "./geometry";
import { blockInput, cancelGestures, onGestureCancel } from "./input-block";
import { keepOuts } from "./keep-outs";
import * as managerModule from "./manager";
import {
  type Displacement,
  defaultLayout,
  type ManagerContext,
  plan,
  pushBars,
  reduce,
  renderedPlaced,
  restoreLayout,
  serialise,
  type WindowAction,
  type Windows,
} from "./manager";
import { blockingOverlay, type OverlayEntry, overlaysFor } from "./overlays";
import { type PlacementToken, pcClear, placeWindow, RAIL_CLEAR } from "./placement";
import { settle } from "./placer";
import { createWindowRegistry, type WindowDef } from "./registry";
import { createShellController } from "./shell-store";
import { createLayoutStorage } from "./storage";
import { isPlacementPc } from "./token-boxes";
import { topBarItemsFor } from "./top-bar-items";

const Body = () => null;
const def = (kind: string, over: Partial<WindowDef> = {}): WindowDef => ({
  kind,
  title: kind,
  clients: ["dm"],
  defaultSize: { w: 440, h: 560 },
  minSize: { w: 320, h: 360 },
  minOpenH: 400,
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: Body, label: kind, order: 1 },
  component: Body,
  ...over,
});
const LAPTOP = { w: 1280, h: 720 };
const WIDE = { w: 1440, h: 900 };
const dm = createWindowRegistry("dm", [
  def("t.log", {
    defaultOpen: true,
    defaultSize: (vp) => (vp.w >= 1440 ? { w: 1150, h: 280 } : { w: 690, h: 200 }),
    minSize: { w: 300, h: 160 },
    minOpenH: undefined,
    usefulSize: { w: 460, h: 200 },
    defaultPosition: { anchor: "bottom-left", dx: 56 },
  }),
  def("t.init", {
    defaultOpen: true,
    defaultSize: { w: 400, h: 500 },
    minSize: { w: 320, h: 240 },
    minOpenH: undefined,
    usefulSize: { w: 400, h: 380 },
    defaultPosition: { anchor: "top-right" },
  }),
  def("t.a"),
  def("t.b"),
  def("t.c"),
  def("t.small", { defaultSize: { w: 320, h: 300 }, minSize: { w: 280, h: 240 } }),
]);
const all = new Set(dm.defs.map((d) => d.kind));
const ctxAt = (viewport: Viewport, over: Partial<ManagerContext> = {}): ManagerContext => ({
  registry: dm,
  viewport,
  available: all,
  keepOuts: () => keepOuts("dm", viewport, new Map()),
  ...over,
});
const get = (ws: Windows, kind: string) => ws.find((w) => w.kind === kind) as WindowState;
const rectOf = (w: Rect): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });
const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const pc = (x: number, y: number): PlacementToken => ({ x, y, w: 40, h: 40, pc: true });
const zone = (vp: Viewport, kind: string) => rectOf(get(defaultLayout(dm, vp), kind));
/** A spot the shell chose for `kind` (untouched: no `userSpot` / `userSize`), with its area. */
const shellSpot = (ws: Windows, kind: string, r: Rect, vp: Viewport): Windows =>
  ws.map((w) =>
    w.kind === kind ? { ...w, x: r.x, y: r.y, w: r.w, h: r.h, area: workArea(vp) } : w,
  );

/** A small in-memory shell (the page's controller). */
function shell(
  vp: { current: Viewport },
  over: Partial<Parameters<typeof createShellController>[0]> = {},
) {
  const backend = new Map<string, string>();
  const storage = createLayoutStorage(() => ({
    getItem: (k) => backend.get(k) ?? null,
    setItem: (k, v) => void backend.set(k, v),
  }));
  const c = createShellController({
    registry: dm,
    storage,
    viewport: () => vp.current,
    keepOuts: (v) => keepOuts("dm", v, new Map()),
    ...over,
  });
  c.restore("k");
  const win = (kind: string) => get(c.store.getState().windows, kind);
  return { c, backend, storage, win };
}

describe("one placer (FR-SHELL-95–113)", () => {
  test("FR-SHELL-95 one writer: open / reopen / appear / settle / viewport / load / push / return / reset go through settle; close, minimise and focus move nothing; the old entry points are gone", () => {
    for (const gone of ["followViewport", "autoPlace", "pushWindows", "belowBar", "clearAround"]) {
      expect(Object.keys(managerModule)).not.toContain(gone);
    }
    const ctx = ctxAt(LAPTOP);
    let ws: Windows = defaultLayout(dm, LAPTOP);
    const p = plan(ws, { type: "open", kind: "t.a" }, ctx);
    expect(p.log.length).toBeGreaterThan(0);
    expect(p.log[0]).toStartWith("open:t.a>");
    ws = p.windows;
    for (const a of [
      { type: "focus", kind: "t.init" },
      { type: "minimise", kind: "t.a" },
      { type: "close", kind: "t.a" },
    ] as const) {
      const next = reduce(ws, a, ctx);
      for (const w of next) expect(rectOf(w)).toEqual(rectOf(get(ws, w.kind)));
    }
    // A settle is pure: the input windows are never changed, the same inputs give the same plan.
    const frozen = JSON.stringify(ws);
    settle(ws, { type: "viewport" }, { ...ctx, settledViewport: WIDE });
    expect(JSON.stringify(ws)).toBe(frozen);
  });

  test("FR-SHELL-96 PC is a player character: an owned pet or summon is not one (#318), for the placer and the map alike", () => {
    expect(isPlacementPc({ ownerPlayerId: "p1", characterId: "c1" })).toBe(true);
    expect(isPlacementPc({ ownerPlayerId: "p1", characterId: null })).toBe(false);
    expect(isPlacementPc({ ownerPlayerId: null, characterId: "c1" })).toBe(false);
    // Tokens everywhere: pets don't stop the target size (L1); player characters do (L5).
    const grid = (pcFlag: boolean) => {
      const out: PlacementToken[] = [];
      for (let x = 60; x < 1280; x += 70)
        for (let y = 60; y < 650; y += 70) {
          out.push({ x, y, w: 40, h: 40, pc: pcFlag });
        }
      return out;
    };
    const open = (tokens: PlacementToken[]) =>
      plan(
        defaultLayout(dm, LAPTOP),
        { type: "open", kind: "t.small" },
        ctxAt(LAPTOP, { avoid: () => tokens }),
      );
    expect(open(grid(false)).log).toEqual(["open:t.small>L1"]);
    expect(open(grid(true)).log).toEqual(["open:t.small>L5"]);
  });

  test("FR-SHELL-97 ladder order: L1 the target size; L2 down to useful; L3 the least recently used launcher window put away; L4 below useful; L5 least PC area, flagged", () => {
    const base = (vp: Viewport) => defaultLayout(dm, vp);
    // L1: the target size fits.
    expect(plan(base(WIDE), { type: "open", kind: "t.small" }, ctxAt(WIDE)).log).toEqual([
      "open:t.small>L1",
    ]);
    // L1 band-capped (BL-104): 440 × 560 doesn't fit above the Game log; its full width at the
    // band's height (536) does.
    const l1 = plan(base(WIDE), { type: "open", kind: "t.a" }, ctxAt(WIDE));
    expect(l1.log).toEqual(["open:t.a>L1"]);
    expect(get(l1.windows, "t.a")).toMatchObject({ w: 440, h: 536 });
    // L2: 1000 wide doesn't fit left of Initiative (948 px); down to useful (440 × 400) does.
    const wide = createWindowRegistry("dm", [
      ...dm.defs.filter((d) => d.defaultOpen),
      def("t.wide", { defaultSize: { w: 1000, h: 412 }, usefulSize: { w: 440, h: 400 } }),
    ]);
    const wctx = {
      ...ctxAt(WIDE),
      registry: wide,
      available: new Set(wide.defs.map((d) => d.kind)),
    };
    const l2 = plan(defaultLayout(wide, WIDE), { type: "open", kind: "t.wide" }, wctx);
    expect(l2.log).toEqual(["open:t.wide>L2"]);
    expect(get(l2.windows, "t.wide").w).toBeLessThan(1000);
    expect(get(l2.windows, "t.wide").w).toBeGreaterThanOrEqual(440);
    // L3: at 1280×720 one 440-wide window fits left of Initiative: the next puts it away (LRU).
    let ws = reduce(base(LAPTOP), { type: "open", kind: "t.a" }, ctxAt(LAPTOP));
    const l3 = plan(ws, { type: "open", kind: "t.b" }, ctxAt(LAPTOP));
    expect(get(l3.windows, "t.a").state).toBe("minimised");
    expect(l3.putAway.get("t.a:main")).toBe("open:t.b");
    const b = get(l3.windows, "t.b");
    expect(b.w >= 440 && b.h >= 400).toBe(true);
    // L4: wider than any free spot at its useful size even with every launcher window gone.
    const huge = createWindowRegistry("dm", [
      ...dm.defs.filter((d) => d.defaultOpen),
      def("t.huge", { defaultSize: { w: 820, h: 412 }, usefulSize: { w: 820, h: 412 } }),
    ]);
    const hctx = {
      ...ctxAt(LAPTOP),
      registry: huge,
      available: new Set(huge.defs.map((d) => d.kind)),
    };
    const l4 = plan(defaultLayout(huge, LAPTOP), { type: "open", kind: "t.huge" }, hctx);
    expect(l4.log).toEqual(["open:t.huge>L4"]);
    expect(get(l4.windows, "t.huge").w).toBeLessThan(820);
    // L5: PCs everywhere: the clear spot over the least PC area, `data-pc-clear` absent.
    const everywhere: PlacementToken[] = [];
    for (let x = 60; x < 1440; x += 70)
      for (let y = 60; y < 830; y += 70) everywhere.push(pc(x, y));
    const l5 = plan(
      base(WIDE),
      { type: "open", kind: "t.small" },
      ctxAt(WIDE, { avoid: () => everywhere }),
    );
    expect(l5.log).toEqual(["open:t.small>L5"]);
    expect(l5.pcClear.get("t.small:main")).toBe(false);
    ws = l5.windows;
    expect(hits(get(ws, "t.small"), get(ws, "t.init"))).toBe(false);
  });

  test("FR-SHELL-98 tight gap: a slot clear only at 4 px is taken at its rung before shrinking", () => {
    // A window 4 px right of t.a's slot: the full size fits only at the 4-px gap.
    const ws = reduce(defaultLayout(dm, WIDE), { type: "open", kind: "t.a" }, ctxAt(WIDE));
    const a = get(ws, "t.a");
    const blocker = {
      ...a,
      kind: "t.c",
      x: a.x + a.w + 4,
      y: a.y,
      w: 300,
      h: 200,
      z: 9,
      userSpot: true as const,
    };
    const moved = reduce(
      [...ws.filter((w) => w.kind !== "t.a"), blocker],
      { type: "open", kind: "t.b" },
      ctxAt(WIDE),
    );
    const b = get(moved, "t.b");
    expect(b.w).toBe(440);
    const gapTo = (r: Rect, o: Rect) =>
      Math.max(o.x - (r.x + r.w), r.x - (o.x + o.w), o.y - (r.y + r.h), r.y - (o.y + o.h));
    expect(gapTo(b, blocker)).toBeGreaterThanOrEqual(4);
  });

  test("FR-SHELL-99 FR-SHELL-151 zones: protected windows take their named default rect; with a `moved` camera and a PC under it, the ladder (zone first); an untouched launcher window in it is displaced and returns when the zone's window closes; a remembered one stays under it", () => {
    for (const vp of [LAPTOP, WIDE]) {
      const init = zone(vp, "t.init");
      // A Compendium the shell put in Initiative's zone while it was closed.
      let ws = reduce(defaultLayout(dm, vp), { type: "close", kind: "t.init" }, ctxAt(vp));
      ws = reduce(ws, { type: "open", kind: "t.a" }, ctxAt(vp));
      const drop = { x: init.x, y: init.y, w: 440, h: 400 };
      // Remembered (the user dropped it there): it stays, no memory; Initiative on top.
      const mine = reduce(ws, { type: "setRect", kind: "t.a", rect: drop }, ctxAt(vp));
      const kept = plan(mine, { type: "open", kind: "t.init", by: "feature" }, ctxAt(vp));
      expect(rectOf(get(kept.windows, "t.init"))).toEqual(init);
      expect({ ...get(kept.windows, "t.a"), z: 0 }).toEqual({ ...get(mine, "t.a"), z: 0 });
      expect(kept.memory).toEqual([]);
      expect(get(kept.windows, "t.init").z).toBeGreaterThan(get(kept.windows, "t.a").z);
      ws = shellSpot(ws, "t.a", drop, vp);
      const p = plan(ws, { type: "open", kind: "t.init", by: "feature" }, ctxAt(vp));
      expect(rectOf(get(p.windows, "t.init"))).toEqual(init);
      expect(p.placed.get("t.init:main")).toBe("zone");
      const a = get(p.windows, "t.a");
      expect(a.state === "minimised" || !hits(a, init)).toBe(true);
      expect(p.memory.find((d) => d.kind === "t.a")?.cause).toBe("window:t.init");
      // Initiative closes: the Compendium goes back to its spot (then, shell-shrunk, grows back
      // toward its default size, FR-SHELL-103).
      const back = plan(
        p.windows,
        { type: "close", kind: "t.init" },
        ctxAt(vp, { memory: () => p.memory }),
      );
      expect(back.log).toContain("return:t.a>returned");
      expect(get(back.windows, "t.a").state).toBe("open");
    }
    // A moved camera with PCs under the zone: Initiative goes through the ladder, PC-clear.
    const pcs = [pc(zone(WIDE, "t.init").x + 100, 200)];
    const moved = ctxAt(WIDE, { avoid: () => pcs, camera: () => "moved" });
    const p = plan(defaultLayout(dm, WIDE), { type: "load", drawn: true }, moved);
    expect(pcClear(get(p.windows, "t.init"), pcs)).toBe(true);
    // The same PCs with a `fitted` camera: the zone (the map refits around it).
    const fitted = ctxAt(WIDE, { avoid: () => pcs, camera: () => "fitted" });
    expect(
      rectOf(get(reduce(defaultLayout(dm, WIDE), { type: "load", drawn: true }, fitted), "t.init")),
    ).toEqual(zone(WIDE, "t.init"));
  });

  test("FR-SHELL-101 Game log stays readable: the protected squeeze shrinks the Game log, then Initiative, in their zones to their useful sizes, never below, never put away", () => {
    // PCs fill the band left of Initiative: t.small fits only under a squeezed Initiative.
    const pcs: PlacementToken[] = [];
    for (let x = 80; x < 1000; x += 90) for (let y = 70; y < 820; y += 90) pcs.push(pc(x, y));
    const ctx = ctxAt(WIDE, { avoid: () => pcs });
    const p = plan(defaultLayout(dm, WIDE), { type: "open", kind: "t.small" }, ctx);
    const log = get(p.windows, "t.log");
    const init = get(p.windows, "t.init");
    expect(log.state).toBe("open");
    expect(init.state).toBe("open");
    expect(log.w).toBeGreaterThanOrEqual(460);
    expect(log.h).toBeGreaterThanOrEqual(160);
    expect(init.h).toBeGreaterThanOrEqual(380);
    if (p.placed.get("t.init:main") === "squeezed") {
      expect(rectOf(init)).toEqual({ ...zone(WIDE, "t.init"), h: 380 });
      expect(p.memory.find((d) => d.kind === "t.init")?.cause).toBe("window:t.small");
    }
    expect(hits(get(p.windows, "t.small"), init)).toBe(false);
  });

  test("FR-SHELL-102 return: a displaced window comes back when its cause ends iff untouched and clear; a user move drops the memory", () => {
    const vp = { current: WIDE };
    const { c, win } = shell(vp);
    c.dispatch({ type: "open", kind: "t.a" }, all);
    const at1440 = rectOf(win("t.a"));
    vp.current = LAPTOP;
    c.dispatch({ type: "viewport" }, all);
    const mem = c.store.getState().memory.find((d: Displacement) => d.kind === "t.a");
    if (!mem) throw new Error("t.a not displaced");
    expect(mem.cause).toBe("viewport:1440×900");
    vp.current = WIDE;
    c.dispatch({ type: "viewport" }, all);
    expect(rectOf(win("t.a"))).toEqual(at1440);
    expect(c.store.getState().placed.get("t.a:main")).toBe("returned");
    // Touched while displaced: it stays where the user put it.
    vp.current = LAPTOP;
    c.dispatch({ type: "viewport" }, all);
    c.dispatch({ type: "setRect", kind: "t.a", rect: { x: 500, y: 70, w: 440, h: 400 } }, all);
    expect(c.store.getState().memory).toEqual([]);
    vp.current = WIDE;
    c.dispatch({ type: "viewport" }, all);
    expect(rectOf(win("t.a"))).toEqual({ x: 500, y: 70, w: 440, h: 400 });
  });

  test("FR-SHELL-103 resize round trip (BL-60): 1440×900 → 1280×720 → 1440×900 = the start; the Game log 1150×280 again, not stuck at its min", () => {
    const vp = { current: WIDE };
    const { c, win } = shell(vp);
    c.dispatch({ type: "open", kind: "t.a" }, all);
    c.dispatch({ type: "open", kind: "t.b" }, all);
    const start = JSON.stringify(
      c.store.getState().windows.map((w) => [w.kind, w.state, rectOf(w)]),
    );
    vp.current = LAPTOP;
    c.dispatch({ type: "viewport" }, all);
    expect(rectOf(win("t.log"))).toEqual(zone(LAPTOP, "t.log"));
    vp.current = WIDE;
    c.dispatch({ type: "viewport" }, all);
    expect(rectOf(win("t.log"))).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
    expect(
      JSON.stringify(c.store.getState().windows.map((w) => [w.kind, w.state, rectOf(w)])),
    ).toBe(start);
  });

  test("FR-SHELL-103 grow back after reload: no memory, a shell-shrunk window grows toward its target at the next viewport up; a user size never changes", () => {
    const vp = { current: LAPTOP };
    const { c, storage, win } = shell(vp);
    c.dispatch({ type: "open", kind: "t.a" }, all);
    const small = rectOf(win("t.a"));
    expect(small.h).toBeLessThan(512);
    c.dispatch({ type: "open", kind: "t.small" }, all);
    c.dispatch(
      { type: "setRect", kind: "t.small", rect: { x: 540, y: 80, w: 300, h: 250 }, resized: true },
      all,
    );
    expect(win("t.small").userSize).toBe(true);
    const reloaded = createShellController({
      registry: dm,
      storage,
      viewport: () => vp.current,
      keepOuts: (v) => keepOuts("dm", v, new Map()),
    });
    reloaded.restore("k");
    expect(reloaded.store.getState().memory).toEqual([]);
    expect(rectOf(get(reloaded.store.getState().windows, "t.a"))).toEqual(small);
    vp.current = WIDE;
    reloaded.dispatch({ type: "viewport" }, all);
    const grown = get(reloaded.store.getState().windows, "t.a");
    expect(grown.h).toBeGreaterThan(small.h);
    expect(reloaded.store.getState().placed.get("t.a:main")).toBe("grown");
    expect(rectOf(get(reloaded.store.getState().windows, "t.small"))).toEqual({
      x: 540,
      y: 80,
      w: 300,
      h: 250,
    });
  });

  test("FR-SHELL-107 player Initiative at Start (BL-70): it appears in its zone (68, 60); the window there is displaced and returns at End", () => {
    const players = createWindowRegistry("player", [
      def("p.log", {
        clients: ["player"],
        defaultOpen: true,
        defaultSize: { w: 510, h: 160 },
        minSize: { w: 300, h: 160 },
        minOpenH: undefined,
        usefulSize: { w: 460, h: 200 },
        defaultPosition: { anchor: "bottom-left", dx: 56 },
      }),
      def("p.sheet", {
        clients: ["player"],
        defaultOpen: true,
        defaultSize: { w: 320, h: 440 },
        minSize: { w: 280, h: 320 },
        minOpenH: undefined,
        usefulSize: { w: 320, h: 338 },
        defaultPosition: { anchor: "top-right" },
      }),
      def("p.init", {
        clients: ["player"],
        defaultOpen: true,
        defaultSize: { w: 280, h: 400 },
        minSize: { w: 240, h: 200 },
        minOpenH: undefined,
        usefulSize: { w: 280, h: 320 },
      }),
      def("p.stats", {
        clients: ["player"],
        defaultSize: { w: 400, h: 412 },
        minSize: { w: 320, h: 280 },
        minOpenH: undefined,
        usefulSize: { w: 400, h: 360 },
      }),
    ]);
    const vp = { w: 1280, h: 800 };
    const fight = new Set(players.defs.map((d) => d.kind));
    const ended = new Set([...fight].filter((k) => k !== "p.init"));
    const ctx = (
      available: ReadonlySet<string>,
      memory: readonly Displacement[] = [],
    ): ManagerContext => ({
      registry: players,
      viewport: vp,
      available,
      keepOuts: () => keepOuts("player", vp, new Map()),
      memory: () => memory,
    });
    const home = rectOf(get(defaultLayout(players, vp), "p.init"));
    expect(home).toMatchObject({ x: 68, y: 60 });
    // End: Initiative goes; Stats opens at the free corner.
    let ws = reduce(defaultLayout(players, vp), { type: "open", kind: "p.stats" }, ctx(ended));
    expect(rectOf(get(ws, "p.stats"))).toMatchObject({ x: 68, y: 60 });
    // Start: Initiative appears in its zone, Stats displaced (never over it, never mid-map over it).
    const start = plan(ws, { type: "appear", kind: "p.init" }, ctx(fight));
    ws = start.windows;
    expect(rectOf(get(ws, "p.init"))).toEqual(home);
    const stats = get(ws, "p.stats");
    expect(stats.state === "minimised" || !hits(stats, home)).toBe(true);
    // End again: the cause ends, Stats returns to its corner.
    const end = plan(ws, { type: "return" }, ctx(ended, start.memory));
    expect(rectOf(get(end.windows, "p.stats"))).toMatchObject({ x: 68, y: 60 });
    expect(get(end.windows, "p.stats").state).toBe("open");
  });

  test("FR-SHELL-108 map yields (players, `fitted`): a spot ≥ useful over PCs is accepted iff the dry fit keeps the PCs clear at ≥ 75 % of the last full fit's cell; the map then refits once", () => {
    const players = createWindowRegistry("player", [
      def("p.stats", {
        clients: ["player"],
        defaultSize: { w: 400, h: 412 },
        minSize: { w: 320, h: 280 },
        minOpenH: undefined,
      }),
    ]);
    const vp = LAPTOP;
    const pcs: PlacementToken[] = [];
    for (let x = 60; x < 1280; x += 80) for (let y = 60; y < 650; y += 80) pcs.push(pc(x, y));
    const base: ManagerContext = {
      registry: players,
      viewport: vp,
      available: new Set(["p.stats"]),
      keepOuts: () => keepOuts("player", vp, new Map()),
      avoid: () => pcs,
      camera: () => "fitted",
      lastFullCell: () => 40,
    };
    const ok = plan(
      [],
      { type: "open", kind: "p.stats" },
      { ...base, dryFit: () => ({ cellPx: 31, clear: true }) },
    );
    expect(ok.log).toEqual(["open:p.stats>L2b"]);
    expect(ok.yields).toBe(true);
    const tooSmall = plan(
      [],
      { type: "open", kind: "p.stats" },
      { ...base, dryFit: () => ({ cellPx: 29, clear: true }) },
    );
    expect(tooSmall.yields).toBe(false);
    const notClear = plan(
      [],
      { type: "open", kind: "p.stats" },
      { ...base, dryFit: () => ({ cellPx: 40, clear: false }) },
    );
    expect(notClear.yields).toBe(false);
    const moved = plan(
      [],
      { type: "open", kind: "p.stats" },
      { ...base, camera: () => "moved", dryFit: () => ({ cellPx: 40, clear: true }) },
    );
    expect(moved.yields).toBe(false);
  });

  test("FR-SHELL-110 plan and hooks: `data-placed` zone / displaced / grown / squeezed / returned, the settle log, the put-away cause", () => {
    const vp = { current: WIDE };
    const yields = { n: 0 };
    const { c } = shell(vp, { onYield: () => yields.n++ });
    expect(c.store.getState().placed.get("t.init:main")).toBe("zone");
    c.dispatch({ type: "open", kind: "t.a" }, all);
    expect(c.store.getState().settleLog).toMatch(/^open:t\.a>L\d/);
    vp.current = LAPTOP;
    c.dispatch({ type: "viewport" }, all);
    expect(c.store.getState().settleLog).toContain("viewport:t.log>zone");
    expect(["displaced", "auto", "default", undefined]).toContain(
      c.store.getState().placed.get("t.a:main"),
    );
    vp.current = WIDE;
    c.dispatch({ type: "viewport" }, all);
    expect(["returned", "grown", undefined]).toContain(c.store.getState().placed.get("t.a:main"));
    expect(yields.n).toBe(0);
  });

  test("FR-SHELL-100 userSize: set at a user resize end, cleared by Reset; an old entry infers it iff a user spot at a size that is neither a default nor the min", () => {
    const vp = { current: WIDE };
    const { c, win } = shell(vp);
    c.dispatch({ type: "open", kind: "t.a" }, all);
    c.dispatch({ type: "setRect", kind: "t.a", rect: { x: 100, y: 100, w: 450, h: 450 } }, all);
    expect(win("t.a").userSize).toBeUndefined();
    c.dispatch(
      { type: "setRect", kind: "t.a", rect: { x: 100, y: 100, w: 450, h: 450 }, resized: true },
      all,
    );
    expect(win("t.a").userSize).toBe(true);
    c.dispatch({ type: "reset" }, all);
    expect(c.store.getState().windows.some((w) => w.userSize || w.userSpot)).toBe(false);
    const entry = (w: Partial<WindowState>) =>
      JSON.stringify({
        windows: [
          {
            kind: "t.a",
            instance: "main",
            state: "open",
            x: 100,
            y: 100,
            w: 450,
            h: 450,
            z: 1,
            ...w,
          },
        ],
      });
    expect(get(restoreLayout(dm, entry({ userSpot: true }), WIDE).windows, "t.a").userSize).toBe(
      true,
    );
    expect(get(restoreLayout(dm, entry({}), WIDE).windows, "t.a").userSize).toBeUndefined();
    const atDefault = entry({ userSpot: true, w: 440, h: 560 });
    expect(get(restoreLayout(dm, atDefault, WIDE).windows, "t.a").userSize).toBeUndefined();
    // Stored (0 B on the wire): it round-trips through the entry.
    const ws = restoreLayout(dm, entry({ userSpot: true }), WIDE).windows;
    expect(serialise(ws, dm).windows[0]?.userSize).toBe(true);
  });

  test("FR-SHELL-111 run twice: the same inputs give the same plan (windows, memory, log)", () => {
    const pcs = [pc(300, 200), pc(700, 300), pc(1000, 400)];
    const ctx = ctxAt(LAPTOP, { avoid: () => pcs });
    const actions: WindowAction[] = [
      { type: "open", kind: "t.a" },
      { type: "open", kind: "t.b" },
      { type: "open", kind: "t.small" },
      { type: "close", kind: "t.init" },
      { type: "open", kind: "t.init", by: "feature" },
    ];
    const once = () => {
      let ws: Windows = defaultLayout(dm, LAPTOP);
      let memory: readonly Displacement[] = [];
      const out: unknown[] = [];
      for (const a of actions) {
        const p = plan(ws, a, { ...ctx, memory: () => memory });
        ws = p.windows;
        memory = p.memory;
        out.push([ws, memory, p.log]);
      }
      return out;
    };
    expect(once()).toEqual(once());
  });

  test("FR-SHELL-113 chrome keep-out: a shown entry is a hard keep-out the placer avoids; its showing pushes, its going returns; ≤ 64-px strip or ≤ 360×240", () => {
    const strip: ChromeKeepOut = {
      id: "test.strip",
      clients: ["dm"],
      rect: (vp) => ({ x: 68, y: 60, w: vp.w - 80, h: 48 }),
      fitObstacle: true,
    };
    expect(chromeFits(strip.rect(LAPTOP, emptyStore()) as Rect)).toBe(true);
    expect(chromeFits({ x: 0, y: 0, w: 400, h: 300 })).toBe(false);
    const regions = chromeKeepOuts("dm", LAPTOP, emptyStore(), [strip]);
    expect(regions).toEqual([
      { id: "test.strip", rect: { x: 68, y: 60, w: 1200, h: 48 }, kind: "hard" },
    ]);
    expect(chromeKeepOuts("player", LAPTOP, emptyStore(), [strip])).toEqual([]);
    const ctx = ctxAt(LAPTOP, { keepOuts: () => keepOuts("dm", LAPTOP, new Map(), regions) });
    const a = get(reduce(defaultLayout(dm, LAPTOP), { type: "open", kind: "t.a" }, ctx), "t.a");
    expect(hits(a, regions[0]?.rect as Rect)).toBe(false);
    // Shown over an open window: the push moves it; gone: it returns.
    const before = reduce(
      defaultLayout(dm, LAPTOP),
      { type: "open", kind: "t.small" },
      ctxAt(LAPTOP),
    );
    const pushed = plan(before, { type: "push", rect: regions[0]?.rect as Rect }, ctx);
    expect(hits(get(pushed.windows, "t.small"), regions[0]?.rect as Rect)).toBe(false);
    const back = plan(
      pushed.windows,
      { type: "return" },
      ctxAt(LAPTOP, { memory: () => pushed.memory }),
    );
    expect(rectOf(get(back.windows, "t.small"))).toEqual(rectOf(get(before, "t.small")));
  });

  test("FR-SHELL-112 registries: overlays in `layer` order per client, top-bar items per client, created empty (TT4 appended the pause entries, SP1 the palette)", async () => {
    const { OVERLAYS } = await import("./overlays");
    const { TOP_BAR_ITEMS } = await import("./top-bar-items");
    const { CHROME_KEEP_OUTS } = await import("./chrome-keep-outs");
    expect([
      OVERLAYS.map((o) => o.id),
      TOP_BAR_ITEMS.map((t) => t.id),
      CHROME_KEEP_OUTS.length,
    ]).toEqual([["pause", "palette"], ["pause", "palette"], 0]);
    const entries: OverlayEntry[] = [
      { id: "b", clients: ["player"], layer: 20, Component: Body },
      { id: "a", clients: ["player", "dm"], layer: 10, Component: Body, blocksInput: () => true },
    ];
    expect(overlaysFor("player", entries).map((o) => o.id)).toEqual(["a", "b"]);
    expect(overlaysFor("dm", entries).map((o) => o.id)).toEqual(["a"]);
    expect(blockingOverlay(entries, emptyStore())?.id).toBe("a");
    const broken: OverlayEntry = {
      id: "x",
      clients: ["dm"],
      layer: 1,
      Component: Body,
      blocksInput: () => {
        throw new Error("boom");
      },
    };
    expect(blockingOverlay([broken], emptyStore())).toBeNull();
    expect(
      topBarItemsFor("dm", [
        { id: "p", clients: ["dm"], width: 96, order: 2, Component: Body },
        { id: "q", clients: ["dm"], width: 40, order: 1, Component: Body },
      ]).map((t) => t.id),
    ).toEqual(["q", "p"]);
  });

  test("FR-SHELL-112 blocksInput overlay: siblings inert, focus trapped (Tab stays inside), a window drag cancelled, Space / Escape / arrow / wheel / pointerdown outside don't reach their handlers, settles queued then run once", () => {
    // DOM-shaped stand-ins (bun test has no DOM): the window's capture listeners, the overlay.
    type L = { type: string; fn: (e: Event) => void };
    const winListeners: L[] = [];
    const docListeners: L[] = [];
    const add = (list: L[]) => (type: string, fn: EventListenerOrEventListenerObject) =>
      list.push({ type, fn: fn as (e: Event) => void });
    const remove = (list: L[]) => (type: string, fn: EventListenerOrEventListenerObject) => {
      const i = list.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) list.splice(i, 1);
    };
    const doc = {
      activeElement: null as unknown,
      addEventListener: add(docListeners),
      removeEventListener: remove(docListeners),
    };
    const button = (name: string) => ({
      name,
      focus: () => {
        doc.activeElement = button.at[name];
      },
    });
    button.at = {} as Record<string, unknown>;
    const inside = ["ok", "cancel"].map((n) => {
      const b = button(n);
      button.at[n] = b;
      return b;
    });
    const outside = { name: "map" };
    const overlay = {
      contains: (n: unknown) => inside.includes(n as never) || n === overlay,
      focusables: () => inside,
      focus: () => {
        doc.activeElement = overlay;
      },
    };
    const siblings = [{ inert: false }, { inert: true }];
    let dragCancelled = 0;
    const off = onGestureCancel(() => dragCancelled++);
    const release = blockInput({
      overlay,
      siblings,
      win: {
        addEventListener: add(winListeners),
        removeEventListener: remove(winListeners),
      } as unknown as Window,
      doc: doc as unknown as Parameters<typeof blockInput>[0]["doc"],
    });
    off();
    expect(siblings.map((s) => s.inert)).toEqual([true, true]);
    expect(dragCancelled).toBe(1);
    expect(doc.activeElement).toBe(inside[0]);
    const fire = (type: string, target: unknown, extra: Record<string, unknown> = {}) => {
      const e = {
        type,
        target,
        cancelable: true,
        stopped: false,
        prevented: false,
        stopImmediatePropagation() {
          this.stopped = true;
        },
        preventDefault() {
          this.prevented = true;
        },
        ...extra,
      };
      for (const l of winListeners.filter((x) => x.type === type)) l.fn(e as unknown as Event);
      return e;
    };
    for (const key of [" ", "Escape", "ArrowLeft"])
      expect(fire("keydown", outside, { key }).stopped).toBe(true);
    expect(fire("wheel", outside).stopped).toBe(true);
    expect(fire("pointerdown", outside).stopped).toBe(true);
    expect(fire("pointerdown", inside[1]).stopped).toBe(false);
    expect(fire("keydown", inside[0], { key: "Enter" }).stopped).toBe(false);
    // Tab cycles inside: ok → cancel → ok; Shift+Tab back.
    fire("keydown", doc.activeElement, { key: "Tab" });
    expect(doc.activeElement).toBe(inside[1]);
    fire("keydown", doc.activeElement, { key: "Tab" });
    expect(doc.activeElement).toBe(inside[0]);
    fire("keydown", doc.activeElement, { key: "Tab", shiftKey: true });
    expect(doc.activeElement).toBe(inside[1]);
    // Focus moving outside comes back.
    for (const l of docListeners.filter((x) => x.type === "focusin"))
      l.fn({ target: outside } as unknown as Event);
    expect(doc.activeElement).toBe(inside[0]);
    release();
    expect(siblings.map((s) => s.inert)).toEqual([false, true]);
    expect(winListeners).toEqual([]);
    expect(docListeners).toEqual([]);
    cancelGestures(); // nothing subscribed any more
    expect(dragCancelled).toBe(1);

    // Settles queue while blocked and run once, in order, when it goes.
    const vp = { current: WIDE };
    const { c, win } = shell(vp);
    c.setBlocked(true);
    vp.current = LAPTOP;
    c.dispatch({ type: "viewport" }, all);
    c.dispatch({ type: "viewport" }, all);
    c.dispatch({ type: "open", kind: "t.a", by: "feature" }, all);
    expect(win("t.log").w).toBe(1150);
    expect(win("t.a")).toBeUndefined();
    let writes = 0;
    const unsub = c.store.subscribe(() => writes++);
    c.setBlocked(false);
    unsub();
    expect(win("t.log").w).toBe(690);
    expect(win("t.a").state).toBe("open");
    expect(writes).toBe(2); // one viewport settle, one open
  });
});

test("FR-SHELL-97 L5 never covers more PC footprint than the window's own rect (walkthrough F14: B 1280×800 reload, Stats touching Thorn's +4 margin stays at 584, 382)", () => {
  const vp = { w: 1280, h: 800 };
  const players = createWindowRegistry("player", [
    def("p.log", {
      clients: ["player"],
      defaultOpen: true,
      defaultSize: { w: 510, h: 160 },
      minSize: { w: 300, h: 160 },
      minOpenH: undefined,
      usefulSize: { w: 460, h: 200 },
      defaultPosition: { anchor: "bottom-left", dx: 56 },
    }),
    def("p.sheet", {
      clients: ["player"],
      defaultOpen: true,
      defaultSize: { w: 320, h: 440 },
      minSize: { w: 280, h: 320 },
      minOpenH: undefined,
      usefulSize: { w: 320, h: 338 },
      defaultPosition: { anchor: "top-right" },
    }),
    def("p.init", {
      clients: ["player"],
      defaultOpen: true,
      defaultSize: { w: 280, h: 400 },
      minSize: { w: 240, h: 200 },
      minOpenH: undefined,
      usefulSize: { w: 280, h: 320 },
    }),
    def("p.stats", {
      clients: ["player"],
      defaultSize: { w: 400, h: 412 },
      minSize: { w: 320, h: 280 },
      minOpenH: undefined,
      usefulSize: { w: 400, h: 360 },
    }),
  ]);
  const stats = { x: 584, y: 382, w: 320, h: 342 };
  const ws: Windows = [
    ...defaultLayout(players, vp),
    { kind: "p.stats", instance: "main", state: "open", ...stats, z: 9, area: { w: 1280, h: 688 } },
  ];
  // The reload's fit put the PCs 4 px right, 8 px up: Thorn's +4 margin now reaches x 588.
  const pcs = [pc(584, 324), pc(538, 508), pc(492, 416)].map((t) => ({ ...t, w: 46, h: 46 }));
  const p = plan(
    ws,
    { type: "load", drawn: true },
    {
      registry: players,
      viewport: vp,
      available: new Set(players.defs.map((d) => d.kind)),
      keepOuts: () => keepOuts("player", vp, new Map()),
      avoid: () => pcs,
    },
  );
  const after = get(p.windows, "p.stats");
  expect(p.log).toContain("load:p.stats>L5"); // the ladder ran, and kept its own rect
  expect(rectOf(after)).toEqual(stats);
  expect(pcs.some((t) => hits(after, t))).toBe(false);
});

describe("pushes and the rail inset (FR-SHELL-104–106, -109; WF2)", () => {
  const bar = { x: 64, y: 56, w: 300, h: 100 };
  const grown = (r: Rect): Rect => ({ x: r.x - 12, y: r.y - 12, w: r.w + 24, h: r.h + 24 });
  /** PC footprints every 60 px over the whole viewport: no PC-clear spot anywhere. */
  const crowd = (vp: Viewport) => {
    const out: PlacementToken[] = [];
    for (let x = 0; x < vp.w; x += 60) for (let y = 48; y < vp.h; y += 60) out.push(pc(x, y));
    return out;
  };
  const withBar = (reports: Map<string, Rect>, tokens: PlacementToken[] = []) =>
    ctxAt(LAPTOP, { keepOuts: () => keepOuts("dm", LAPTOP, reports), avoid: () => tokens });

  test("FR-SHELL-104 push keeps PCs clear (BL-61): pushed through the ladder, PC-clear, `pushed`, cause toolbar; no PC-clear spot ≥ useful → the pushed launcher window itself is put away (no other window) and comes back at `return`; a protected window is never put away: L5, flagged", () => {
    const reports = new Map<string, Rect>();
    let ws = reduce(defaultLayout(dm, LAPTOP), { type: "open", kind: "t.small" }, withBar(reports));
    const before = rectOf(get(ws, "t.small"));
    expect(hits(before, bar)).toBe(true);
    // PCs right of the bar, where the retired push right (FR-SHELL-55) put it.
    const tokens = [pc(400, 80), pc(400, 200), pc(520, 140)];
    reports.set("map.toolbar", bar);
    const p = plan(ws, { type: "push", rect: bar }, withBar(reports, tokens));
    const r = rectOf(get(p.windows, "t.small"));
    expect(hits(r, grown(bar))).toBe(false);
    expect(pcClear(r, tokens)).toBe(true);
    expect(p.placed.get("t.small:main")).toBe("pushed");
    expect(p.pcClear.get("t.small:main")).toBe(true);
    expect(p.memory).toEqual([
      {
        kind: "t.small",
        instance: "main",
        rect: before,
        area: get(ws, "t.small").area,
        cause: "toolbar:map.toolbar",
        at: r,
      },
    ]);
    // PCs everywhere: t.small is put away itself; t.a (open, off the bar) stays open.
    reports.delete("map.toolbar");
    ws = reduce(ws, { type: "open", kind: "t.a" }, withBar(reports));
    ws = reduce(
      ws,
      { type: "setRect", kind: "t.a", rect: { x: 760, y: 60, w: 440, h: 400 } },
      withBar(reports),
    );
    reports.set("map.toolbar", bar);
    const full = plan(ws, { type: "push", rect: bar }, withBar(reports, crowd(LAPTOP)));
    expect(get(full.windows, "t.small").state).toBe("minimised");
    expect(full.putAway).toEqual(new Map([["t.small:main", "toolbar:map.toolbar"]]));
    expect(get(full.windows, "t.a")).toBe(get(ws, "t.a"));
    expect(full.log).toContain("push:t.small>put-away");
    // The tool closes: it comes back at its rect.
    reports.delete("map.toolbar");
    const back = plan(
      full.windows,
      { type: "return" },
      {
        ...withBar(reports),
        memory: () => full.memory,
        autoMinimised: () => new Set(["t.small:main"]),
      },
    );
    expect(get(back.windows, "t.small").state).toBe("open");
    expect(rectOf(get(back.windows, "t.small"))).toEqual(before);
    expect(back.placed.get("t.small:main")).toBe("returned");
    // A protected window over the bar, PCs everywhere: moved off it, never put away, flagged L5.
    let prot = shellSpot(
      defaultLayout(dm, LAPTOP),
      "t.init",
      { x: 68, y: 60, w: 400, h: 400 },
      LAPTOP,
    );
    prot = reduce(prot, { type: "minimise", kind: "t.log" }, withBar(new Map()));
    reports.set("map.toolbar", bar);
    const pushed = plan(prot, { type: "push", rect: bar }, withBar(reports, crowd(LAPTOP)));
    const init = get(pushed.windows, "t.init");
    expect(init.state).toBe("open");
    expect(hits(init, grown(bar))).toBe(false);
    expect(pushed.pcClear.get("t.init:main")).toBe(false);
    expect(pushed.log).toContain("push:t.init>L5");
    expect(pushed.putAway.size).toBe(0);
  });

  test("FR-SHELL-105 FR-SHELL-150 drag under a bar (BL-52): a move end over the shown tool bar stores the dropped rect (remembered) and renders it pushed off the bar (`pushed`), nothing written; the bar gone, it renders at the dropped rect; dropped off the bar, it stays", () => {
    const reports = new Map<string, Rect>();
    const { c, win } = shell({ current: LAPTOP }, { keepOuts: (v) => keepOuts("dm", v, reports) });
    const t = dm.get("t.small") as WindowDef;
    const shownNow = () => {
      const bars = pushBars(keepOuts("dm", LAPTOP, reports));
      const w = win("t.small");
      const placed = c.store.getState().placed.get("t.small:main");
      return {
        r: placedRect(w, t.minSize, LAPTOP, bars),
        how: renderedPlaced(w, t, LAPTOP, bars, placed),
      };
    };
    c.dispatch({ type: "open", kind: "t.small" }, all);
    reports.set("map.toolbar", bar);
    c.dispatch({ type: "push", rect: bar }, all);
    expect(hits(win("t.small"), grown(bar))).toBe(false);
    const dropped = { x: 70, y: 70, w: 320, h: 300 };
    c.dispatch({ type: "setRect", kind: "t.small", rect: dropped }, all);
    expect(rectOf(win("t.small"))).toEqual(dropped);
    expect(win("t.small").userSpot).toBe(true);
    expect(hits(shownNow().r, grown(bar))).toBe(false);
    expect(shownNow().how).toBe("pushed");
    expect(c.store.getState().memory).toEqual([]);
    reports.delete("map.toolbar");
    c.dispatch({ type: "return" }, all);
    expect(rectOf(win("t.small"))).toEqual(dropped);
    expect(shownNow()).toEqual({ r: dropped, how: "stored" });
    // Off a shown bar: the user's spot, nothing pushed.
    reports.set("map.toolbar", bar);
    const off = { x: 600, y: 200, w: 320, h: 300 };
    c.dispatch({ type: "setRect", kind: "t.small", rect: off }, all);
    expect(rectOf(win("t.small"))).toEqual(off);
    expect(c.store.getState().placed.get("t.small:main")).toBe("stored");
  });

  test("FR-SHELL-105 re-select pushes: the same bar rect again pushes an untouched window that got under it (a reload with the tool active); a tool swap pushes with the new bar, the first pre-push rect kept", () => {
    const reports = new Map<string, Rect>();
    // t.small placed under the bar while no bar was shown; then the tool comes up.
    let ws = reduce(defaultLayout(dm, LAPTOP), { type: "open", kind: "t.small" }, withBar(reports));
    const home = { x: 68, y: 60, w: 320, h: 300 };
    ws = shellSpot(ws, "t.small", home, LAPTOP);
    reports.set("map.toolbar", bar);
    const p = plan(ws, { type: "push", rect: bar }, withBar(reports));
    expect(hits(get(p.windows, "t.small"), grown(bar))).toBe(false);
    expect(p.placed.get("t.small:main")).toBe("pushed");
    // The same bar again: nothing left under it, nothing moves.
    const again = plan(
      p.windows,
      { type: "push", rect: bar },
      { ...withBar(reports), memory: () => p.memory },
    );
    expect(again.windows).toBe(p.windows);
    // A taller bar (Fog → AoE): pushed again; the memory keeps the pre-Fog rect.
    const aoe = { ...bar, h: 420 };
    reports.set("map.toolbar", aoe);
    const swap = plan(
      p.windows,
      { type: "push", rect: aoe },
      { ...withBar(reports), memory: () => p.memory },
    );
    expect(hits(get(swap.windows, "t.small"), grown(aoe))).toBe(false);
    expect(swap.memory.find((d) => d.kind === "t.small")?.rect).toEqual(home);
    reports.delete("map.toolbar");
    const back = plan(
      swap.windows,
      { type: "return" },
      { ...withBar(reports), memory: () => swap.memory },
    );
    expect(rectOf(get(back.windows, "t.small"))).toEqual(home);
    expect(get(back.windows, "t.small").userSpot).toBeUndefined();
  });

  test("FR-SHELL-106 drag onto a PC: kept as a user spot; no load, viewport, reopen or other open moves it for PCs", () => {
    // Clear of the zones (a zone may displace a user spot, rulings-b 8): over a PC only.
    const tokens = [pc(500, 260)];
    const { c, win } = shell({ current: LAPTOP }, { avoid: () => tokens });
    c.dispatch({ type: "open", kind: "t.small" }, all);
    const onPc = { x: 400, y: 180, w: 320, h: 280 };
    c.dispatch({ type: "setRect", kind: "t.small", rect: onPc }, all);
    expect(pcClear(onPc, tokens)).toBe(false);
    const steps: WindowAction[] = [
      { type: "load", drawn: true },
      { type: "viewport" },
      { type: "close", kind: "t.small" },
      { type: "open", kind: "t.small" },
      { type: "open", kind: "t.b" },
      { type: "return" },
    ];
    for (const a of steps) {
      c.dispatch(a, all);
      expect({ after: a.type, rect: rectOf(win("t.small")) }).toEqual({
        after: a.type,
        rect: onPc,
      });
      expect(win("t.small").userSpot).toBe(true);
    }
  });

  test("FR-SHELL-109 rail inset (BL-53): the render clamp keeps windows at x ≥ 68 (a window parked off-screen keeps its x; one too wide sits flush right); auto placement's minX is always 68", () => {
    const vp = LAPTOP;
    // Party at min width dragged to x 0: renders at 68, whole.
    expect(clampRect({ x: 0, y: 60, w: 320, h: 400 }, vp)).toEqual({
      x: 68,
      y: 60,
      w: 320,
      h: 400,
    });
    expect(renderedRect({ x: 30, y: 60, w: 320, h: 400 }, { w: 320, h: 360 }, vp).x).toBe(68);
    expect(moveRect({ x: 100, y: 60, w: 320, h: 400 }, -100, 0, vp).x).toBe(68);
    // Parked off-screen (FR-SHELL-12): keeps its x (≥ 120 px inside).
    expect(clampRect({ x: -150, y: 60, w: 320, h: 400 }, vp).x).toBe(-150);
    // Wider than the room right of the rail: flush right, all of it on screen.
    expect(clampRect({ x: 10, y: 60, w: 1250, h: 400 }, vp).x).toBe(30);
    // Auto placement: a type whose default column is x 12 moves right of the rail.
    const edge = def("t.edge", { defaultPosition: { anchor: "top-left" } });
    const taken = { x: 12, y: 60, w: 440, h: 560 };
    const r = placeWindow(edge, vp, { windows: [taken] }).rect;
    expect(r.x).toBeGreaterThanOrEqual(RAIL_CLEAR);
    expect(RAIL_CLEAR).toBe(68);
  });
});
