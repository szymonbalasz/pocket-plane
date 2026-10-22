import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { type Rect, workArea } from "./geometry";
import { createWindowRegistry, type WindowDef } from "./registry";
import { createShellController } from "./shell-store";
import { createLayoutStorage } from "./storage";

const Body = () => null;
const def = (kind: string, over: Partial<WindowDef> = {}): WindowDef => ({
  kind,
  title: kind,
  clients: ["dm"],
  defaultSize: { w: 300, h: 200 },
  minSize: { w: 200, h: 100 },
  defaultPosition: { anchor: "top-left" },
  component: Body,
  ...over,
});
const registry = createWindowRegistry("dm", [
  def("a.one", { defaultOpen: true }),
  def("a.two", { defaultOpen: true }),
]);
const vp = { w: 1600, h: 900 };
const all = new Set(["a.one", "a.two"]);

function controller(entries: Record<string, string> = {}) {
  const backend = new Map(Object.entries(entries));
  const storage = createLayoutStorage(() => ({
    getItem: (k) => backend.get(k) ?? null,
    setItem: (k, v) => void backend.set(k, v),
  }));
  return createShellController({ registry, storage, viewport: () => vp });
}

test("FR-SHELL-40 FR-SHELL-110 data-placed: the default layout's windows `zone`, move end stored, reset `zone` again, a reloaded protected window `zone`", () => {
  const c = controller();
  c.restore("k");
  const placed = () => Object.fromEntries(c.store.getState().placed);
  // Both protected: the named default layout is their zone (FR-SHELL-99).
  expect(placed()).toEqual({ "a.one:main": "zone", "a.two:main": "zone" });
  c.dispatch({ type: "setRect", kind: "a.one", rect: { x: 500, y: 300, w: 300, h: 200 } }, all);
  expect(placed()["a.one:main"]).toBe("stored");
  expect(placed()["a.two:main"]).toBe("zone"); // untouched
  c.dispatch({ type: "reset" }, all);
  expect(placed()).toEqual({ "a.one:main": "zone", "a.two:main": "zone" });

  const raw = JSON.stringify({ windows: c.store.getState().windows });
  const reloaded = controller({ k: raw });
  reloaded.restore("k");
  expect(Object.fromEntries(reloaded.store.getState().placed)).toEqual({
    "a.one:main": "zone",
    "a.two:main": "zone",
  });
});

describe("FR-SHELL-40, -41 settle after first layout", () => {
  // M8 at 1280×720 (M4 re-test 2, step 2): the Compendium dragged to 808,104, the Game log at
  // 68,404, Initiative (grows to content, min 240) closed before Start: no measured height.
  const m8 = createWindowRegistry("dm", [
    def("cbt.initiative", {
      defaultPosition: { anchor: "top-right" },
      defaultSize: { w: 400, h: 500 },
      minSize: { w: 320, h: 240 },
      growToContent: true,
    }),
    def("cmp.compendium", { defaultSize: { w: 440, h: 560 } }),
    def("dice.log", { defaultSize: { w: 460, h: 240 }, defaultOpen: true }),
  ]);
  const small = { w: 1280, h: 720 };
  const kinds = new Set(["cbt.initiative", "cmp.compendium", "dice.log"]);
  const INIT = "cbt.initiative:main";
  const comp = { x: 808, y: 104, w: 440, h: 560 };
  const log = { x: 68, y: 404, w: 460, h: 240 };
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  function m8Controller(initiative: Rect & { state: "open" | "closed" }) {
    const area = workArea(small);
    const raw = JSON.stringify({
      windows: [
        { kind: "cmp.compendium", instance: "main", state: "open", ...comp, z: 1, area },
        { kind: "dice.log", instance: "main", state: "open", ...log, z: 2, area },
        { kind: "cbt.initiative", instance: "main", z: 3, area, ...initiative },
      ],
    });
    const heights = new Map<string, number>();
    const storage = createLayoutStorage(() => ({ getItem: () => raw, setItem: () => {} }));
    const c = createShellController({
      registry: m8,
      storage,
      viewport: () => small,
      heights: (id) => heights.get(id),
    });
    c.restore("k");
    const init = () => c.store.getState().windows.find((w) => w.kind === "cbt.initiative");
    return { c, heights, init };
  }

  test("FR-SHELL-41 Initiative closed before Start (no measured height) ends clear of the Game log and the Compendium", () => {
    const { c, heights, init } = m8Controller({ state: "closed", x: 868, y: 60, w: 400, h: 500 });
    c.dispatch({ type: "open", kind: "cbt.initiative", by: "feature" }, kinds);
    // Sprint 7 (FR-SHELL-77, -79): no clear slot at its useful 360 px with the Compendium open, so
    // the Compendium (the only launcher window) is auto-minimised; clear of the Game log before
    // its height is known.
    const first = init() as WindowState;
    const compendium = () => c.store.getState().windows.find((w) => w.kind === "cmp.compendium");
    expect(compendium()?.state).toBe("minimised");
    expect(first.h).toBeGreaterThanOrEqual(360);
    expect(overlaps(first, log)).toBe(false);
    expect(c.store.getState().settling.has(INIT)).toBe(true);
    // First layout: ShellWindow reports the measured height, then settles.
    heights.set(INIT, 302);
    c.dispatch({ type: "settle", kind: "cbt.initiative" }, kinds);
    const r = init() as WindowState;
    expect(r.h).toBeGreaterThanOrEqual(302);
    expect(overlaps(r, log)).toBe(false);
    expect(compendium()?.state).toBe("minimised");
    expect(c.store.getState().settling.has(INIT)).toBe(false);
    // Once: a later settle (or growth) never moves it again.
    heights.set(INIT, 600);
    c.dispatch({ type: "settle", kind: "cbt.initiative" }, kinds);
    expect(init()).toEqual(r);
  });

  test("FR-SHELL-08 a user's stored rect is never re-placed by settle", () => {
    // A user open at a clear stored rect (FR-SHELL-56: kept, `stored`): not settling; a settle is
    // ignored, even once its measured height would reach the Game log.
    const clearSpot = { x: 68, y: 60, w: 400, h: 240 };
    const user = m8Controller({ state: "closed", ...clearSpot });
    user.c.dispatch({ type: "open", kind: "cbt.initiative" }, kinds);
    expect(user.c.store.getState().settling.has(INIT)).toBe(false);
    expect(user.c.store.getState().placed.get(INIT)).toBe("stored");
    user.heights.set(INIT, 400);
    user.c.dispatch({ type: "settle", kind: "cbt.initiative" }, kinds);
    expect(user.init()).toMatchObject({ state: "open", ...clearSpot });
    const stored = { x: 700, y: 300, w: 400, h: 240 };
    // A feature-placed window the user moves before it settles keeps the user's rect.
    const moved = m8Controller({ state: "closed", x: 868, y: 60, w: 400, h: 500 });
    moved.c.dispatch({ type: "open", kind: "cbt.initiative", by: "feature" }, kinds);
    moved.c.dispatch({ type: "setRect", kind: "cbt.initiative", rect: stored }, kinds);
    expect(moved.c.store.getState().settling.has(INIT)).toBe(false);
    moved.heights.set(INIT, 302);
    moved.c.dispatch({ type: "settle", kind: "cbt.initiative" }, kinds);
    expect(moved.init()).toMatchObject(stored);
  });
});

describe("sprint 5 (FR-SHELL-47, -53)", () => {
  // 580 wide: two fit right of the tool rail at 1280 (FR-SHELL-109), not three.
  const big = { defaultSize: { w: 580, h: 584 }, minSize: { w: 580, h: 584 } };
  const reg = createWindowRegistry("dm", [
    def("b.one", big),
    def("b.two", big),
    def("b.three", big),
  ]);
  const small = { w: 1280, h: 720 };
  const kinds = new Set(["b.one", "b.two", "b.three"]);

  test("FR-SHELL-47 FR-SHELL-56 screen full: the least recently used launcher window is minimised, written, marked auto-minimised until restored; its restore onto a taken spot is reopened; a reload loads it plain minimised", () => {
    const backend = new Map<string, string>();
    const storage = createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    }));
    const c = createShellController({ registry: reg, storage, viewport: () => small });
    c.restore("k");
    for (const kind of ["b.one", "b.two", "b.three"]) c.dispatch({ type: "open", kind }, kinds);
    const state = (kind: string) => c.store.getState().windows.find((w) => w.kind === kind)?.state;
    expect([state("b.one"), state("b.two"), state("b.three")]).toEqual([
      "minimised",
      "open",
      "open",
    ]);
    expect([...c.store.getState().autoMinimised]).toEqual(["b.one:main"]);
    const written = JSON.parse(backend.get("k") ?? "{}") as { windows: WindowState[] };
    expect(written.windows.find((w) => w.kind === "b.one")?.state).toBe("minimised");
    // A user restore clears the mark; its spot is taken now (FR-SHELL-56), so it is re-placed and
    // the least recently used other window is auto-minimised, never itself.
    c.dispatch({ type: "open", kind: "b.one" }, kinds);
    expect(c.store.getState().autoMinimised.has("b.one:main")).toBe(false);
    expect([state("b.one"), state("b.two"), state("b.three")]).toEqual([
      "open",
      "minimised",
      "open",
    ]);
    expect(c.store.getState().placed.get("b.one:main")).toBe("reopened");
    expect([...c.store.getState().autoMinimised]).toEqual(["b.two:main"]);
    // A user minimise isn't auto; closing an auto-minimised window drops its mark.
    c.dispatch({ type: "minimise", kind: "b.three" }, kinds);
    expect([...c.store.getState().autoMinimised]).toEqual(["b.two:main"]);
    c.dispatch({ type: "close", kind: "b.two" }, kinds);
    expect(c.store.getState().autoMinimised.size).toBe(0);
    const reloaded = createShellController({ registry: reg, storage, viewport: () => small });
    reloaded.restore("k");
    expect(reloaded.store.getState().autoMinimised.size).toBe(0);
  });

  test("FR-SHELL-53 a window still at a previous default takes the new one when the entry is applied, and the entry is written", () => {
    const log = def("dice.log", {
      defaultSize: (v) => (v.w >= 1440 ? { w: 900, h: 200 } : { w: 500, h: 160 }),
      minSize: { w: 300, h: 160 },
      previousDefaults: [{ w: 460, h: 240 }],
      defaultPosition: { anchor: "bottom-left", dx: 56 },
    });
    const r2 = createWindowRegistry("dm", [log]);
    const raw = JSON.stringify({
      windows: [
        { kind: "dice.log", instance: "main", state: "open", x: 68, y: 404, w: 460, h: 240, z: 1 },
      ],
    });
    const backend = new Map([["k", raw]]);
    const storage = createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    }));
    const c = createShellController({ registry: r2, storage, viewport: () => small });
    c.restore("k");
    const w = c.store.getState().windows[0];
    expect(w).toMatchObject({ x: 68, y: 404, w: 500, h: 160, area: workArea(small) });
    expect(backend.get("k")).not.toBe(raw);
    expect(c.store.getState().placed.get("dice.log:main")).toBe("stored");
  });
});

describe("sprint 7: reset, returns, test hooks (FR-SHELL-80, -81, -88)", () => {
  const wide = { w: 1440, h: 900 };
  const reg = createWindowRegistry("dm", [
    def("c.log", {
      defaultOpen: true,
      defaultSize: { w: 600, h: 200 },
      minSize: { w: 300, h: 160 },
      defaultPosition: { anchor: "bottom-left", dx: 56 },
    }),
    def("c.init", {
      defaultOpen: true,
      defaultSize: { w: 400, h: 500 },
      minSize: { w: 320, h: 240 },
      defaultPosition: { anchor: "top-left", dx: 56 },
      growToContent: true,
    }),
    def("c.side", { defaultSize: { w: 300, h: 300 }, defaultPosition: { anchor: "top-right" } }),
  ]);
  const kinds = new Set(reg.defs.map((d) => d.kind));
  const bar = { x: 62, y: 56, w: 300, h: 80 };
  function make(fits: { n: number }) {
    const backend = new Map<string, string>();
    const storage = createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    }));
    const c = createShellController({
      registry: reg,
      storage,
      viewport: () => wide,
      onReset: () => {
        fits.n += 1;
      },
    });
    c.restore("k");
    const win = (kind: string) => c.store.getState().windows.find((w) => w.kind === kind);
    const rect = (kind: string) => {
      const w = win(kind);
      return w && { x: w.x, y: w.y, w: w.w, h: w.h };
    };
    return { c, win, rect, storage };
  }

  test("FR-SHELL-80 reset keeps the zones: the default layout written (`zone`, FR-SHELL-110), other windows closed, fixedH cleared, one Fit requested", () => {
    const fits = { n: 0 };
    const { c, win } = make(fits);
    c.dispatch({ type: "open", kind: "c.side" }, kinds);
    const init = win("c.init") as WindowState;
    c.dispatch(
      { type: "setRect", kind: "c.init", rect: { ...init, h: 300 }, resized: true },
      kinds,
    );
    expect(win("c.init")?.fixedH).toBe(true);
    c.dispatch({ type: "reset" }, kinds);
    expect(fits.n).toBe(1);
    expect(win("c.side")).toBeUndefined();
    expect(win("c.init")?.fixedH).toBeUndefined();
    expect(Object.fromEntries(c.store.getState().placed)).toEqual({
      "c.log:main": "zone",
      "c.init:main": "zone",
    });
    c.dispatch({ type: "open", kind: "c.side" }, kinds); // not a reset: no Fit
    expect(fits.n).toBe(1);
  });

  test("FR-SHELL-81 FR-SHELL-102 pushed windows return: bar shown → Initiative pushed; bar gone → back at the pre-push rect, `returned`, userSpot restored; Fog → AoE switch → back to the pre-Fog rect; reload → no memory, the protected window at its zone (FR-SHELL-99)", () => {
    const { c, rect, win, storage } = make({ n: 0 });
    const home = rect("c.init");
    // The user's spot (userSpot), then the Fog bar pushes it.
    c.dispatch({ type: "setRect", kind: "c.init", rect: home as Rect }, kinds);
    c.dispatch({ type: "push", rect: bar }, kinds);
    // FR-SHELL-104: off the bar + 12 through the ladder, nearest the pre-push rect.
    const off = (b: Rect) => ({ x: b.x - 12, y: b.y - 12, w: b.w + 24, h: b.h + 24 });
    const hits = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(hits(rect("c.init") as Rect, off(bar))).toBe(false);
    expect(rect("c.init")).not.toEqual(home);
    expect(c.store.getState().placed.get("c.init:main")).toBe("pushed");
    expect(win("c.init")?.userSpot).toBeUndefined();
    // A taller AoE panel replaces the bar before it went: pushed again, memory kept from before Fog.
    const aoe = { ...bar, h: bar.h + 200 };
    c.dispatch({ type: "push", rect: aoe }, kinds);
    expect(hits(rect("c.init") as Rect, off(aoe))).toBe(false);
    expect(c.store.getState().memory.find((d) => d.kind === "c.init")?.rect).toEqual(home);
    c.dispatch({ type: "return" }, kinds);
    expect(rect("c.init")).toEqual(home);
    expect(c.store.getState().placed.get("c.init:main")).toBe("returned");
    expect(win("c.init")?.userSpot).toBe(true);
    expect(c.store.getState().memory.length).toBe(0);
    // Pushed, then the page reloads (no bar shown yet): no memory; the pushed shell spot is
    // stored, and the load settle puts the protected window back in its zone.
    c.dispatch({ type: "push", rect: bar }, kinds);
    expect(rect("c.init")).not.toEqual(home);
    const reloaded = createShellController({ registry: reg, storage, viewport: () => wide });
    reloaded.restore("k");
    expect(reloaded.store.getState().memory.length).toBe(0);
    reloaded.dispatch({ type: "return" }, kinds);
    const after = reloaded.store.getState().windows.find((w) => w.kind === "c.init");
    expect(after && { x: after.x, y: after.y, w: after.w, h: after.h }).toEqual(home);
  });

  test("FR-SHELL-81 a window moved or minimised while pushed drops out of the memory and stays", () => {
    const { c, rect } = make({ n: 0 });
    c.dispatch({ type: "push", rect: bar }, kinds);
    const at = rect("c.init") as Rect;
    c.dispatch({ type: "setRect", kind: "c.init", rect: { ...at, x: at.x + 30 } }, kinds);
    expect(c.store.getState().memory.some((d) => d.kind === "c.init")).toBe(false);
    c.dispatch({ type: "return" }, kinds);
    expect(rect("c.init")?.x).toBe(at.x + 30);
  });

  test("FR-SHELL-88 test hooks: data-auto-minimised-for = the kind it made room for; the last placement's moves; cleared on restore", () => {
    // Screen full at 1280×720 (FR-SHELL-47): three 500×400 launcher windows.
    const small = { w: 1280, h: 720 };
    const big = { defaultSize: { w: 500, h: 400 }, minSize: { w: 500, h: 400 } };
    const r = createWindowRegistry("dm", [
      def("d.one", big),
      def("d.two", big),
      def("d.three", big),
    ]);
    const all = new Set(["d.one", "d.two", "d.three"]);
    const storage = createLayoutStorage(() => ({ getItem: () => null, setItem: () => {} }));
    const c = createShellController({ registry: r, storage, viewport: () => small });
    c.restore("k");
    for (const kind of ["d.one", "d.two", "d.three"]) c.dispatch({ type: "open", kind }, all);
    expect(Object.fromEntries(c.store.getState().autoMinimisedFor)).toEqual({
      "d.one:main": "d.three",
    });
    expect(c.store.getState().autoMinimiseLog).toBe("d.one>d.three");
    c.dispatch({ type: "focus", kind: "d.two" }, all); // not a placement: the log stays
    expect(c.store.getState().autoMinimiseLog).toBe("d.one>d.three");
    c.dispatch({ type: "close", kind: "d.three" }, all);
    c.dispatch({ type: "open", kind: "d.one" }, all);
    expect(c.store.getState().autoMinimisedFor.has("d.one:main")).toBe(false);
  });
});
