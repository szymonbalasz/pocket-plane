import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { clampRect, type Rect, renderedRect, TOP_BAR_H, workArea } from "./geometry";
import { brutePcArea, pcAreaOf } from "./layout-checks";
import {
  autoMinimiseOrder,
  bandAt,
  defaultLayout,
  launcherState,
  launcherTooltip,
  type ManagerContext,
  mountedWindows,
  reduce,
  restoreLayout,
  serialise,
  topWindow,
  useful,
  usefulSize,
  type WindowAction,
  type Windows,
} from "./manager";
import { type PlacementToken, pcClear } from "./placement";
import { createWindowRegistry, type WindowDef } from "./registry";

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
  def("a.one", { defaultOpen: true, defaultPosition: { anchor: "top-right" } }),
  def("a.two"),
  def("a.three"),
  def("a.gated", { available: () => false }),
]);
const vp = { w: 1600, h: 900 };
const ctx: ManagerContext = {
  registry,
  viewport: vp,
  available: new Set(["a.one", "a.two", "a.three"]),
};
/** A spot the shell chose for `kind` (untouched: no `userSpot` / `userSize`), with its area. */
type ShellSpot = { type: "spot"; kind: string; rect: Rect };
const shellSpot = (ws: Windows, kind: string, r: Rect, at = vp): Windows =>
  ws.map((w) =>
    w.kind === kind ? { ...w, x: r.x, y: r.y, w: r.w, h: r.h, area: workArea(at) } : w,
  );
const run = (ws: Windows, ...actions: (WindowAction | ShellSpot)[]) =>
  actions.reduce(
    (acc, a) => (a.type === "spot" ? shellSpot(acc, a.kind, a.rect) : reduce(acc, a, ctx)),
    ws,
  );
const get = (ws: Windows, kind: string) => ws.find((w) => w.kind === kind) as WindowState;
const rectOf = (w: WindowState): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });
const order = (ws: Windows) =>
  [...ws]
    .filter((w) => w.state === "open")
    .sort((a, b) => a.z - b.z)
    .map((w) => w.kind);

describe("window manager", () => {
  test("FR-SHELL-14 default layout: defaultOpen types at default geometry", () => {
    const ws = defaultLayout(registry, vp);
    expect(ws).toEqual([
      {
        kind: "a.one",
        instance: "main",
        state: "open",
        x: 1288,
        y: 60,
        w: 300,
        h: 200,
        z: 1,
        area: workArea(vp),
      },
    ]);
  });

  describe("FR-SHELL-29 per-window work area", () => {
    const big = { w: 1440, h: 900 };
    const small = { w: 1280, h: 720 };
    const at = (viewport: { w: number; h: number }) => ({ ...ctx, viewport });
    const shown = (w: WindowState, viewport: { w: number; h: number }) =>
      renderedRect(w, { w: 200, h: 100 }, viewport);
    const inside = (r: { x: number; y: number; w: number; h: number }, v: typeof small) =>
      r.x >= 0 && r.x + r.w <= v.w && r.y + r.h <= TOP_BAR_H + workArea(v).h;

    test("open, appear, reset and setRect stamp the current work area", () => {
      let ws = reduce(defaultLayout(registry, big), { type: "open", kind: "a.two" }, at(big));
      expect(get(ws, "a.one").area).toEqual(workArea(big));
      expect(get(ws, "a.two").area).toEqual(workArea(big));
      ws = reduce(
        ws,
        { type: "setRect", kind: "a.two", rect: { x: 500, y: 300, w: 300, h: 200 } },
        at(small),
      );
      expect(get(ws, "a.two").area).toEqual(workArea(small));
      expect(reduce(ws, { type: "reset" }, at(small))[0]?.area).toEqual(workArea(small));
    });

    test("15b: at 1280×720 move one window → the others keep their 1440×900 area and still fit", () => {
      let ws = run([], { type: "open", kind: "a.two" });
      ws = reduce(
        ws,
        { type: "setRect", kind: "a.two", rect: { x: 1100, y: 600, w: 300, h: 200 } },
        at(big),
      );
      ws = reduce(ws, { type: "open", kind: "a.three" }, at(big));
      ws = reduce(
        ws,
        { type: "setRect", kind: "a.three", rect: { x: 100, y: 200, w: 300, h: 200 } },
        at(small),
      );
      const two = get(ws, "a.two");
      expect(two.area).toEqual(workArea(big));
      expect(two).toMatchObject({ x: 1100, y: 600 }); // stored geometry untouched
      expect(inside(shown(two, small), small)).toBe(true);
      // Back at 1440×900: untouched window at its stored spot, the moved one where it was moved.
      expect(shown(two, big)).toMatchObject({ x: 1100, y: 600, w: 300, h: 200 });
      expect(shown(get(ws, "a.three"), big)).toMatchObject({ x: 100, y: 200 });
    });

    test("an area-only change survives patch (written, not dropped as a no-op)", () => {
      let ws = reduce([], { type: "open", kind: "a.two" }, at(big));
      const rect = { x: 100, y: 200, w: 300, h: 200 };
      ws = reduce(ws, { type: "setRect", kind: "a.two", rect }, at(big));
      const next = reduce(ws, { type: "setRect", kind: "a.two", rect }, at(small));
      expect(next).not.toBe(ws);
      expect(get(next, "a.two").area).toEqual(workArea(small));
      expect(reduce(next, { type: "setRect", kind: "a.two", rect }, at(small))).toBe(next);
    });

    test("FR-SHELL-15 entries without `area` still parse; `area` round-trips", () => {
      const old = { kind: "a.two", instance: "main", state: "open", x: 10, y: 60, w: 300, h: 200 };
      const raw = JSON.stringify({
        windows: [
          { ...old, z: 1 },
          { ...old, kind: "a.three", z: 2, area: { w: 1440, h: 788 } },
        ],
      });
      const r = restoreLayout(registry, raw, vp);
      expect(r.warning).toBeUndefined();
      expect(get(r.windows, "a.two").area).toBeUndefined();
      expect(get(r.windows, "a.three").area).toEqual({ w: 1440, h: 788 });
      expect(serialise(r.windows, registry).windows[1]?.area).toEqual({ w: 1440, h: 788 });
      const bad = JSON.stringify({ windows: [{ ...old, z: 1, area: { w: 0, h: 788 } }] });
      expect(restoreLayout(registry, bad, vp).warning).toBeString();
    });
  });

  test("FR-SHELL-08 open at default, then front; already open → front; minimised → restored", () => {
    let ws = run(defaultLayout(registry, vp), { type: "open", kind: "a.two" });
    expect(get(ws, "a.two")).toMatchObject({ state: "open", x: 12, y: 60, w: 300, h: 200 });
    expect(order(ws)).toEqual(["a.one", "a.two"]);
    ws = run(ws, { type: "open", kind: "a.one" });
    expect(order(ws)).toEqual(["a.two", "a.one"]);
    ws = run(ws, { type: "minimise", kind: "a.two" }, { type: "open", kind: "a.two" });
    expect(get(ws, "a.two").state).toBe("open");
    expect(order(ws)).toEqual(["a.one", "a.two"]);
  });

  test("FR-SHELL-08 first open never lands on an open window; minimised / unavailable don't count", () => {
    let ws = run([], { type: "open", kind: "a.two" }, { type: "open", kind: "a.three" });
    const two = get(ws, "a.two");
    const three = get(ws, "a.three");
    expect(two).toMatchObject({ x: 12, y: 60 });
    const overlap =
      two.x < three.x + three.w &&
      three.x < two.x + two.w &&
      two.y < three.y + three.h &&
      three.y < two.y + two.h;
    expect(overlap).toBe(false);
    // Minimised windows don't block the default slot.
    ws = run([], { type: "open", kind: "a.two" }, { type: "minimise", kind: "a.two" });
    ws = run(ws, { type: "open", kind: "a.three" });
    expect(get(ws, "a.three")).toMatchObject({ x: 12, y: 60 });
  });

  test("FR-SHELL-18 FR-SHELL-99 FR-SHELL-107 FR-SHELL-148 appear: a default window takes its zone, the launcher window in it moves; a user spot stays, on top, and nothing moves for it", () => {
    const reg = createWindowRegistry("dm", [
      def("a.one"),
      def("a.late", { defaultOpen: true, available: () => false }),
    ]);
    const gone = { registry: reg, viewport: vp, available: new Set(["a.one"]) };
    const here = { ...gone, available: new Set(["a.one", "a.late"]) };
    // a.one opens while a.late is unavailable: a.late's default spot is free to it.
    const ws: Windows = reduce(defaultLayout(reg, vp), { type: "open", kind: "a.one" }, gone);
    const one = get(ws, "a.one");
    const covered = (a: WindowState, b: WindowState) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(covered(get(ws, "a.late"), one)).toBe(true);
    const zone = get(ws, "a.late");
    const appeared = reduce(ws, { type: "appear", kind: "a.late" }, here);
    const fixed = get(appeared, "a.late");
    expect(rectOf(fixed)).toEqual(rectOf(zone));
    expect(covered(fixed, get(appeared, "a.one"))).toBe(false);
    expect(reduce(ws, { type: "appear", kind: "a.late" }, gone)).toBe(ws); // still unavailable
    // Moved by the user (remembered) clear of a.one or over it → kept and fronted; a.one stays
    // (FR-SHELL-146, -148, -149).
    const clear = { x: 900, y: 500, w: 300, h: 200 };
    const away = reduce(ws, { type: "setRect", kind: "a.late", rect: clear }, here);
    const shown = reduce(away, { type: "appear", kind: "a.late" }, here);
    expect(rectOf(get(shown, "a.late"))).toEqual(clear);
    expect(order(shown).at(-1)).toBe("a.late");
    const rect = { x: one.x + 50, y: one.y + 50, w: 300, h: 200 };
    const moved = reduce(ws, { type: "setRect", kind: "a.late", rect }, here);
    const after = reduce(moved, { type: "appear", kind: "a.late" }, here);
    expect(rectOf(get(after, "a.late"))).toEqual(rect);
    expect(rectOf(get(after, "a.one"))).toEqual(rectOf(one));
    expect(order(after).at(-1)).toBe("a.late");
  });

  test("FR-SHELL-08 reopen uses last geometry", () => {
    let ws = run([], { type: "open", kind: "a.two" });
    ws = run(ws, { type: "setRect", kind: "a.two", rect: { x: 500, y: 400, w: 350, h: 250 } });
    ws = run(ws, { type: "close", kind: "a.two" }, { type: "open", kind: "a.two" });
    expect(get(ws, "a.two")).toMatchObject({ state: "open", x: 500, y: 400, w: 350, h: 250 });
  });

  test("FR-SHELL-09 launcher toggle: closed → open; behind → front; on top → minimise", () => {
    let ws = run([], { type: "toggle", kind: "a.one" }, { type: "toggle", kind: "a.two" });
    expect(order(ws)).toEqual(["a.one", "a.two"]);
    ws = run(ws, { type: "toggle", kind: "a.one" }); // behind → front
    expect(order(ws)).toEqual(["a.two", "a.one"]);
    expect(get(ws, "a.one").state).toBe("open");
    ws = run(ws, { type: "toggle", kind: "a.one" }); // on top → minimise
    expect(launcherState(ws, "a.one")).toBe("minimised");
    ws = run(ws, { type: "toggle", kind: "a.one" }); // minimised → open + front
    expect(launcherState(ws, "a.one")).toBe("open");
    expect(order(ws)).toEqual(["a.two", "a.one"]);
    expect(launcherState(ws, "a.three")).toBe("closed");
  });

  test("FR-SHELL-10 focus brings to front; focusing the top window changes nothing", () => {
    const ws = run([], { type: "open", kind: "a.one" }, { type: "open", kind: "a.two" });
    expect(run(ws, { type: "focus", kind: "a.two" })).toBe(ws);
    expect(order(run(ws, { type: "focus", kind: "a.one" }))).toEqual(["a.two", "a.one"]);
  });

  test("FR-SHELL-10 z-order stays 1..n", () => {
    let ws: Windows = [];
    for (let i = 0; i < 50; i++) {
      ws = run(
        ws,
        { type: "open", kind: i % 2 ? "a.one" : "a.two" },
        { type: "open", kind: "a.three" },
      );
    }
    expect(ws.map((w) => w.z).sort()).toEqual([1, 2, 3]);
  });

  test("FR-SHELL-11 minimise and close keep geometry", () => {
    let ws = run([], { type: "open", kind: "a.two" });
    ws = run(ws, { type: "setRect", kind: "a.two", rect: { x: 40, y: 80, w: 320, h: 220 } });
    const geom = { x: 40, y: 80, w: 320, h: 220 };
    expect(get(run(ws, { type: "minimise", kind: "a.two" }), "a.two")).toMatchObject({
      state: "minimised",
      ...geom,
    });
    expect(get(run(ws, { type: "close", kind: "a.two" }), "a.two")).toMatchObject({
      state: "closed",
      ...geom,
    });
  });

  test("FR-SHELL-10 setRect never below min size", () => {
    const ws = run(
      [],
      { type: "open", kind: "a.two" },
      { type: "setRect", kind: "a.two", rect: { x: 1, y: 60, w: 10, h: 10 } },
    );
    expect(get(ws, "a.two")).toMatchObject({ w: 200, h: 100 });
  });

  test("FR-SHELL-12 clamp is render-only: untouched windows keep stored geometry on write", () => {
    // a.one stored far off-screen; a.two is moved. a.one's stored geometry is written as-is.
    const offscreen: WindowState = {
      kind: "a.one",
      instance: "main",
      state: "open",
      x: 3000,
      y: 2000,
      w: 300,
      h: 200,
      z: 1,
    };
    let ws: Windows = [offscreen];
    ws = run(ws, { type: "open", kind: "a.two" });
    ws = run(ws, { type: "setRect", kind: "a.two", rect: { x: 100, y: 100, w: 300, h: 200 } });
    const written = serialise(ws, registry).windows.find((w) => w.kind === "a.one");
    expect(written).toEqual(offscreen);
    expect(clampRect(offscreen, vp).x).toBeLessThan(3000); // rendered clamped
  });

  test("FR-SHELL-14 reset → default layout", () => {
    const ws = run([], { type: "open", kind: "a.two" }, { type: "close", kind: "a.one" });
    expect(run(ws, { type: "reset" })).toEqual(defaultLayout(registry, vp));
  });

  test("FR-SHELL-18 unknown kinds: never opened, skipped, dropped on write; unavailable kept", () => {
    const unknown: WindowState = {
      kind: "gone.window",
      instance: "main",
      state: "open",
      x: 0,
      y: 60,
      w: 300,
      h: 200,
      z: 1,
    };
    const gated: WindowState = { ...unknown, kind: "a.gated", z: 2 };
    const ws: Windows = [unknown, gated];
    expect(run(ws, { type: "open", kind: "gone.window" })).toBe(ws);
    const out = serialise(run(ws, { type: "open", kind: "a.two" }), registry).windows;
    expect(out.map((w) => w.kind)).toEqual(["a.gated", "a.two"]);
    // Unavailable window keeps its saved state; toggle's "on top" ignores it.
    expect(get(out, "a.gated").state).toBe("open");
  });

  test("FR-SHELL-18 availability flip: rendered set changes, stored state doesn't", () => {
    const ws = run([], { type: "open", kind: "a.two" }, { type: "open", kind: "a.three" });
    const without = { ...ctx, available: new Set(["a.one", "a.two"]) };
    // a.three is on top but unavailable: a.two counts as the top rendered window → minimise.
    const next = reduce(ws, { type: "toggle", kind: "a.two" }, without);
    expect(get(next, "a.two").state).toBe("minimised");
    expect(get(next, "a.three")).toEqual(get(ws, "a.three"));
  });
});

describe("layout restore (FR-SHELL-17)", () => {
  const valid = (windows: unknown[]) => JSON.stringify({ windows });
  const w = (over: Partial<WindowState> = {}) => ({
    kind: "a.two",
    instance: "main",
    state: "open",
    x: 10,
    y: 60,
    w: 300,
    h: 200,
    z: 1,
    ...over,
  });

  test("FR-SHELL-16 no entry → default layout, no warning", () => {
    expect(restoreLayout(registry, null, vp)).toEqual({ windows: defaultLayout(registry, vp) });
  });

  test("FR-SHELL-16 valid entry restored as stored", () => {
    const r = restoreLayout(registry, valid([w(), w({ kind: "a.three", z: 2 })]), vp);
    expect(r.warning).toBeUndefined();
    expect(r.windows.map((x) => x.kind)).toEqual(["a.two", "a.three"]);
  });

  test("FR-SHELL-17 invalid entries → default + warning", () => {
    const bad = [
      "{not json",
      JSON.stringify([]),
      valid(Array.from({ length: 41 }, (_, i) => w({ kind: `a.k${i}` }))),
      valid([w(), w()]),
      valid([w({ kind: "Bad Kind" })]),
      valid([w({ kind: `a.${"x".repeat(70)}` })]),
      valid([w({ x: 10_001 })]),
      valid([w({ y: -10_001 })]),
      valid([w({ w: 1.5 })]),
      valid([w({ state: "maximised" as WindowState["state"] })]),
    ];
    for (const raw of bad) {
      const r = restoreLayout(registry, raw, vp);
      expect(r.windows).toEqual(defaultLayout(registry, vp));
      expect(r.warning).toBeString();
    }
  });

  test("FR-SHELL-17 40 windows is accepted", () => {
    const raw = valid(Array.from({ length: 40 }, (_, i) => w({ kind: `a.k${i}`, z: i })));
    expect(restoreLayout(registry, raw, vp).warning).toBeUndefined();
  });
});

describe("FR-SHELL-39 grow to content: fixedH", () => {
  const grows = createWindowRegistry("dm", [
    def("cbt.initiative", { growToContent: true }),
    def("a.plain"),
  ]);
  const gctx: ManagerContext = {
    ...ctx,
    registry: grows,
    available: new Set(["cbt.initiative", "a.plain"]),
  };
  const go = (ws: Windows, ...actions: WindowAction[]) =>
    actions.reduce((acc, a) => reduce(acc, a, gctx), ws);
  const rect = { x: 100, y: 100, w: 320, h: 400 };

  test("FR-SHELL-39 resize end sets fixedH and writes h; a move doesn't", () => {
    let ws = go([], { type: "open", kind: "cbt.initiative" });
    ws = go(ws, { type: "setRect", kind: "cbt.initiative", rect });
    expect(get(ws, "cbt.initiative").fixedH).toBeUndefined();
    ws = go(ws, { type: "setRect", kind: "cbt.initiative", rect, resized: true });
    expect(get(ws, "cbt.initiative")).toMatchObject({ ...rect, fixedH: true });
    ws = go(ws, { type: "setRect", kind: "cbt.initiative", rect: { ...rect, x: 300 } });
    expect(get(ws, "cbt.initiative").fixedH).toBe(true); // a later move keeps it
  });

  test("FR-SHELL-39 a fixedH-only change is written (not dropped as a no-op)", () => {
    let ws = go([], { type: "open", kind: "cbt.initiative" });
    ws = go(ws, { type: "setRect", kind: "cbt.initiative", rect });
    const next = go(ws, { type: "setRect", kind: "cbt.initiative", rect, resized: true });
    expect(next).not.toBe(ws);
  });

  test("FR-SHELL-39 only opted-in types get fixedH", () => {
    let ws = go([], { type: "open", kind: "a.plain" });
    ws = go(ws, { type: "setRect", kind: "a.plain", rect, resized: true });
    expect(get(ws, "a.plain").fixedH).toBeUndefined();
  });

  test("FR-SHELL-39 reset clears it", () => {
    let ws = go([], { type: "open", kind: "cbt.initiative" });
    ws = go(
      ws,
      { type: "setRect", kind: "cbt.initiative", rect, resized: true },
      { type: "reset" },
    );
    expect(ws.some((w) => w.fixedH)).toBe(false);
  });

  test("FR-SHELL-39 entries without fixedH parse; fixedH round-trips; other values are invalid", () => {
    const w = { kind: "cbt.initiative", instance: "main", state: "open", ...rect, z: 1 };
    const back = (x: object) => restoreLayout(grows, JSON.stringify({ windows: [x] }), vp);
    expect(back(w).warning).toBeUndefined();
    expect(get(back(w).windows, "cbt.initiative").fixedH).toBeUndefined();
    const fixed = back({ ...w, fixedH: true });
    expect(get(fixed.windows, "cbt.initiative").fixedH).toBe(true);
    expect(serialise(fixed.windows, grows).windows[0]?.fixedH).toBe(true);
    expect(back({ ...w, fixedH: false }).warning).toBeString();
  });
});

describe("FR-SHELL-36/37 minimised = parked", () => {
  const keys = (ws: Windows, available = ctx.available) =>
    mountedWindows(ws, available).map((w) => `${w.kind}:${w.state}`);

  test("FR-SHELL-36 minimised stays mounted; close unmounts; geometry kept for the next open", () => {
    let ws = run([], { type: "open", kind: "a.two" }, { type: "open", kind: "a.three" });
    ws = run(ws, { type: "minimise", kind: "a.two" });
    expect(keys(ws)).toEqual(["a.two:minimised", "a.three:open"]);
    const parked = get(ws, "a.two");
    ws = run(ws, { type: "open", kind: "a.two" }); // restore: the same mounted window
    expect(keys(ws)).toEqual(["a.two:open", "a.three:open"]);
    ws = run(ws, { type: "close", kind: "a.two" });
    expect(keys(ws)).toEqual(["a.three:open"]);
    ws = run(ws, { type: "open", kind: "a.two" }); // fresh mount, last geometry
    expect(get(ws, "a.two")).toMatchObject({ x: parked.x, y: parked.y, w: parked.w, h: parked.h });
  });

  test("FR-SHELL-36 unavailable kinds unmount whatever their state", () => {
    const ws = run([], { type: "open", kind: "a.two" }, { type: "open", kind: "a.three" });
    const parked = run(ws, { type: "minimise", kind: "a.three" });
    expect(keys(parked, new Set(["a.one"]))).toEqual([]);
    expect(keys(parked, new Set(["a.three"]))).toEqual(["a.three:minimised"]);
  });

  test("FR-SHELL-36 a minimised window is not the focused one and isn't on screen for placement", () => {
    let ws = run([], { type: "open", kind: "a.two" }, { type: "open", kind: "a.three" });
    ws = run(ws, { type: "minimise", kind: "a.three" });
    expect(topWindow(ws, ctx.available)?.kind).toBe("a.two");
    expect(run(ws, { type: "focus", kind: "a.three" })).toBe(ws);
  });

  test("FR-SHELL-36 a layout restored after reload keeps minimised windows minimised", () => {
    const ws = run([], { type: "open", kind: "a.two" }, { type: "minimise", kind: "a.two" });
    const raw = JSON.stringify(serialise(ws, registry));
    const back = restoreLayout(registry, raw, vp).windows;
    expect(keys(back)).toEqual(["a.two:minimised"]);
  });

  test("FR-SHELL-37 launcher states and Tooltips", () => {
    let ws = run([], { type: "open", kind: "a.two" });
    expect(launcherState(ws, "a.two")).toBe("open");
    expect(launcherTooltip("Log", "open")).toBe("Log (open)");
    ws = run(ws, { type: "toggle", kind: "a.two" });
    expect(launcherState(ws, "a.two")).toBe("minimised");
    expect(launcherTooltip("Log", "minimised")).toBe("Log (minimised — click to restore)");
    ws = run(ws, { type: "close", kind: "a.two" });
    expect(launcherState(ws, "a.two")).toBe("closed");
    expect(launcherState(ws, "a.three")).toBe("closed");
    expect(launcherTooltip("Log", "closed")).toBe("Log");
  });
});

describe("sprint 4: feature vs user opens, restoreOpen (FR-SHELL-08, -41, -42)", () => {
  // `a.one` = Initiative (default-open, top-right); `a.two` = a window the user drags over it.
  const onInit = (ws: Windows) => {
    const one = get(ws, "a.one");
    return { x: one.x + 20, y: one.y + 20, w: 300, h: 200 };
  };
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** Initiative minimised (End), then `a.two` opened and dragged onto its spot. */
  const setUp = () =>
    run(
      defaultLayout(registry, vp),
      { type: "minimise", kind: "a.one" },
      { type: "open", kind: "a.two" },
    );
  const covered = () => {
    const ws = setUp();
    return run(ws, { type: "spot", kind: "a.two", rect: onInit(ws) });
  };

  test("FR-SHELL-41 a feature open whose stored rect overlaps an open window is auto-placed and written with its area", () => {
    const ws = covered();
    const stored = get(ws, "a.one");
    expect(overlap(stored, get(ws, "a.two"))).toBe(true);
    const next = run(ws, { type: "open", kind: "a.one", by: "feature" });
    const one = get(next, "a.one");
    expect(one.state).toBe("open");
    expect(overlap(one, get(next, "a.two"))).toBe(false);
    expect(one.area).toEqual(workArea(vp));
    expect(serialise(next, registry).windows.find((w) => w.kind === "a.one")).toEqual(one);
    // In front, like any open.
    expect(order(next).at(-1)).toBe("a.one");
  });

  test('FR-SHELL-08 FR-SHELL-56 (5) a protected window, user-opened (no `by`, or `by: "user"`) keeps its stored rect, even over a window; the window over it moves', () => {
    const ws = covered();
    const stored = get(ws, "a.one");
    for (const by of [undefined, "user"] as const) {
      const next = run(ws, { type: "open", kind: "a.one", by });
      const one = get(next, "a.one");
      expect(one).toMatchObject({
        state: "open",
        x: stored.x,
        y: stored.y,
        w: stored.w,
        h: stored.h,
      });
      expect(overlap(one, get(next, "a.two"))).toBe(false);
      expect(get(next, "a.two").state).toBe("open");
    }
    // The launcher toggle is a user open too.
    expect(get(run(ws, { type: "toggle", kind: "a.one" }), "a.one")).toMatchObject({
      x: stored.x,
      y: stored.y,
    });
  });

  test("FR-SHELL-41 a feature open of a spot the user chose, clear of other windows, keeps it", () => {
    const ws = run(
      setUp(),
      { type: "setRect", kind: "a.one", rect: { x: 700, y: 500, w: 300, h: 200 } },
      { type: "minimise", kind: "a.one" },
    );
    const one = get(run(ws, { type: "open", kind: "a.one", by: "feature" }), "a.one");
    expect(one).toMatchObject({ state: "open", x: 700, y: 500, w: 300, h: 200 });
    // Already open: a feature open only brings it to front.
    const open = run(ws, { type: "open", kind: "a.one" });
    expect(run(open, { type: "open", kind: "a.one", by: "feature" })).toBe(open);
  });

  test("FR-SHELL-99 FR-SHELL-118 a feature open of a protected window takes its zone over monsters (the map refits); over a PC with a moved camera, the ladder", () => {
    const ws = setUp();
    const stored = get(ws, "a.one");
    const tokens = [{ x: stored.x + 10, y: stored.y + 10, w: 60, h: 60 }];
    const withTokens = { ...ctx, avoid: () => tokens };
    const one = get(
      reduce(ws, { type: "open", kind: "a.one", by: "feature" }, withTokens),
      "a.one",
    );
    expect(rectOf(one)).toEqual(rectOf(stored));
    // A PC under the zone: kept with a `fitted` camera, the ladder with a `moved` one.
    const pcs = [{ ...tokens[0], pc: true }] as PlacementToken[];
    const fitted = { ...ctx, avoid: () => pcs, camera: () => "fitted" as const };
    expect(
      rectOf(get(reduce(ws, { type: "open", kind: "a.one", by: "feature" }, fitted), "a.one")),
    ).toEqual(rectOf(stored));
    const moved = { ...ctx, avoid: () => pcs, camera: () => "moved" as const };
    const placed = get(reduce(ws, { type: "open", kind: "a.one", by: "feature" }, moved), "a.one");
    expect(pcClear(placed, pcs)).toBe(true);
  });

  test("FR-SHELL-42 restoreOpen: false loads closed after a reload, geometry kept; the next open is at it; other kinds unchanged", () => {
    const reg = createWindowRegistry("dm", [
      def("a.one", { defaultOpen: true }),
      def("a.viewer", { restoreOpen: false }),
    ]);
    const stored = [
      { kind: "a.one", instance: "main", state: "open", x: 12, y: 60, w: 300, h: 200, z: 1 },
      { kind: "a.viewer", instance: "main", state: "open", x: 700, y: 300, w: 320, h: 240, z: 2 },
    ];
    for (const state of ["open", "minimised"] as const) {
      const raw = JSON.stringify({ windows: [stored[0], { ...stored[1], state }] });
      const { windows } = restoreLayout(reg, raw, vp);
      expect(get(windows, "a.one").state).toBe("open");
      expect(get(windows, "a.viewer")).toMatchObject({ state: "closed", x: 700, y: 300, w: 320 });
      const all = { registry: reg, viewport: vp, available: new Set(["a.one", "a.viewer"]) };
      const opened = get(reduce(windows, { type: "open", kind: "a.viewer" }, all), "a.viewer");
      expect(opened).toMatchObject({ state: "open", x: 700, y: 300, w: 320, h: 240 });
    }
  });
});

describe("sprint 6: reopen rule (FR-SHELL-56)", () => {
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** `a.two` open, moved to `spot`, then closed (or minimised); `a.three` open at `other`. */
  const stage = (spot: Rect, other: Rect, how: "close" | "minimise" = "close") =>
    run(
      defaultLayout(registry, vp),
      { type: "open", kind: "a.two" },
      { type: "spot", kind: "a.two", rect: spot },
      { type: how, kind: "a.two" },
      { type: "open", kind: "a.three" },
      { type: "setRect", kind: "a.three", rect: other },
    );
  const spot = { x: 400, y: 300, w: 300, h: 200 };

  test("FR-SHELL-56 reopen covered vs free spot: a clear stored rect is kept; one overlapping an open window by 1 px is auto-placed, clear, written with its area", () => {
    const free = stage(spot, { x: 700, y: 300, w: 300, h: 200 }); // touching, not overlapping
    const kept = get(run(free, { type: "open", kind: "a.two" }), "a.two");
    expect(rectOf(kept)).toEqual(spot);
    expect(kept.state).toBe("open");
    const by1 = stage(spot, { x: 699, y: 300, w: 300, h: 200 });
    for (const action of [
      { type: "open", kind: "a.two" },
      { type: "open", kind: "a.two", by: "user" },
      { type: "toggle", kind: "a.two" },
    ] as const) {
      const next = run(by1, action);
      const two = get(next, "a.two");
      expect(two.state).toBe("open");
      expect(rectOf(two)).not.toEqual(spot);
      expect(overlap(two, get(next, "a.three"))).toBe(false);
      expect(overlap(two, get(next, "a.one"))).toBe(false);
      expect(two.area).toEqual(workArea(vp));
      expect(serialise(next, registry).windows.find((w) => w.kind === "a.two")).toEqual(two);
      // The next reopen starts from the new spot: it is clear, so it is kept.
      const again = run(next, { type: "close", kind: "a.two" }, { type: "open", kind: "a.two" });
      expect(rectOf(get(again, "a.two"))).toEqual(rectOf(two));
    }
  });

  test("FR-SHELL-56 covered (OQ-SHELL-41 A): the DM's soft box or a token under the stored rect doesn't count; a hard region (the players' corner, a reported tool bar) does", () => {
    const ws = stage(spot, { x: 1000, y: 600, w: 200, h: 100 });
    const soft = { id: "toasts", rect: { ...spot, x: spot.x + 100 }, kind: "soft" as const };
    const withSoft = { ...ctx, keepOuts: () => [soft], avoid: () => [{ ...spot, w: 50, h: 50 }] };
    expect(rectOf(get(reduce(ws, { type: "open", kind: "a.two" }, withSoft), "a.two"))).toEqual(
      spot,
    );
    const bar = {
      id: "map.toolbar",
      rect: { x: 380, y: 290, w: 100, h: 40 },
      kind: "hard" as const,
    };
    const withBar = { ...ctx, keepOuts: () => [soft, bar] };
    const moved = get(reduce(ws, { type: "open", kind: "a.two" }, withBar), "a.two");
    expect(overlap(moved, bar.rect)).toBe(false);
    // The players' toast corner (hard by default for a player registry).
    const players = createWindowRegistry(
      "player",
      registry.defs.map((d) => ({ ...d, clients: ["player" as const] })),
    );
    const pctx: ManagerContext = { ...ctx, registry: players };
    const corner = { x: 1228, y: 590, w: 356, h: 238 }; // toastKeepOut("player", 1600×900)
    const over = { x: 1100, y: 560, w: 300, h: 200 };
    const pgo = (w0: Windows, ...as: WindowAction[]) =>
      as.reduce((acc, a) => reduce(acc, a, pctx), w0);
    const pws = pgo(
      shellSpot(pgo(defaultLayout(players, vp), { type: "open", kind: "a.two" }), "a.two", over),
      { type: "close", kind: "a.two" },
    );
    const back = get(reduce(pws, { type: "open", kind: "a.two" }, pctx), "a.two");
    expect(overlap(back, corner)).toBe(false);
  });

  test("FR-SHELL-56 a minimised (auto-minimised) window restored onto a spot now taken is re-placed; screen full parks the least recently used other window, never itself", () => {
    const big = { defaultSize: { w: 580, h: 584 }, minSize: { w: 580, h: 584 } };
    const full = createWindowRegistry("dm", [
      def("b.one", big),
      def("b.two", big),
      def("b.three", big),
    ]);
    const small = { w: 1280, h: 720 };
    const fctx: ManagerContext = {
      registry: full,
      viewport: small,
      available: new Set(["b.one", "b.two", "b.three"]),
    };
    const go = (ws: Windows, ...as: WindowAction[]) =>
      as.reduce((acc, a) => reduce(acc, a, fctx), ws);
    // Three 580-wide windows; the screen holds two right of the rail (FR-SHELL-109): b.one is
    // auto-minimised for b.three.
    const ws = go(
      [],
      ...["b.one", "b.two", "b.three"].map((kind) => ({ type: "open", kind }) as const),
    );
    expect(ws.map((w) => w.state)).toEqual(["minimised", "open", "open"]);
    const stored = rectOf(get(ws, "b.one"));
    expect(overlap(stored, get(ws, "b.three"))).toBe(true); // its spot is b.three's now
    const back = go(ws, { type: "open", kind: "b.one" });
    expect(back.map((w) => w.state)).toEqual(["open", "minimised", "open"]);
    expect(overlap(get(back, "b.one"), get(back, "b.three"))).toBe(false);
  });

  test("FR-SHELL-56 bring to front of an open window never moves it, even when it overlaps another", () => {
    const ws = run(
      stage(spot, { x: 450, y: 350, w: 300, h: 200 }),
      { type: "open", kind: "a.two" }, // re-placed (covered)
      { type: "setRect", kind: "a.two", rect: spot }, // the user drags it back over a.three
    );
    for (const action of [
      { type: "open", kind: "a.two" },
      { type: "focus", kind: "a.two" },
      { type: "toggle", kind: "a.two" },
    ] as const) {
      const two = get(run(ws, action), "a.two");
      expect(rectOf(two)).toEqual(spot);
    }
  });

  test("FR-SHELL-56 a stored rect from 1440×900 shown at 1280×720 (fitted, FR-SHELL-29) is tested as shown", () => {
    const small = { w: 1280, h: 720 };
    const sctx: ManagerContext = { ...ctx, viewport: small };
    const stored = {
      kind: "a.two",
      instance: "main",
      state: "closed" as const,
      x: 1100,
      y: 300,
      w: 300,
      h: 200,
      z: 2,
      area: workArea({ w: 1440, h: 900 }),
    };
    expect(renderedRect(stored, { w: 200, h: 100 }, small)).toEqual({
      x: 980,
      y: 300,
      w: 300,
      h: 200,
    });
    const other = (x: number) => ({
      kind: "a.three",
      instance: "main",
      state: "open" as const,
      x,
      y: 320,
      w: 60,
      h: 60,
      z: 1,
      area: workArea(small),
    });
    // Overlaps the shown rect (980…1280), not the stored one (1100…1400): re-placed.
    const moved = get(
      reduce([other(1000), stored], { type: "open", kind: "a.two" }, sctx),
      "a.two",
    );
    expect(moved.x).not.toBe(1100);
    expect(overlap(renderedRect(moved, { w: 200, h: 100 }, small), other(1000))).toBe(false);
    // Left of the shown rect: clear, so the stored rect is kept as stored (its fit stays render-only).
    const kept = get(reduce([other(900), stored], { type: "open", kind: "a.two" }, sctx), "a.two");
    expect(rectOf(kept)).toEqual({ x: 1100, y: 300, w: 300, h: 200 });
  });

  test("FR-SHELL-56 (6) FR-SHELL-99 applying the layout on load re-places no launcher window, overlaps included; a protected one takes its zone", () => {
    const entry = {
      windows: [
        { kind: "a.one", instance: "main", state: "open", x: 400, y: 300, w: 300, h: 200, z: 1 },
        { kind: "a.two", instance: "main", state: "open", x: 450, y: 350, w: 300, h: 200, z: 2 },
        {
          kind: "a.three",
          instance: "main",
          state: "minimised",
          x: 420,
          y: 320,
          w: 300,
          h: 200,
          z: 3,
        },
      ],
    };
    const r = restoreLayout(registry, JSON.stringify(entry), vp);
    const zone = rectOf(get(defaultLayout(registry, vp), "a.one"));
    expect(r.windows.map(rectOf)).toEqual([
      zone,
      ...entry.windows.slice(1).map((w) => rectOf(w as WindowState)),
    ]);
    expect(r.migrated).toBe(true);
  });
});

describe("sprint 7: auto-minimise instead of covering a PC (FR-SHELL-77–81)", () => {
  // 1280×720: the Game log bottom-left (band 412 above it), Initiative top-right, launcher
  // windows top-left; `s7.card` declares a useful size (FR-SHELL-79). The log is 224 tall so the
  // band stays 412 with the work area to vh − 12 (FR-KIT-14).
  const box = { w: 440, h: 400 };
  const TL = { anchor: "top-left", dx: 56 } as const;
  const s7 = createWindowRegistry("dm", [
    def("sv.log", {
      defaultOpen: true,
      defaultSize: { w: 690, h: 224 },
      minSize: { w: 300, h: 160 },
      defaultPosition: { anchor: "bottom-left", dx: 56 },
    }),
    def("sv.init", {
      defaultOpen: true,
      defaultSize: { w: 400, h: 400 },
      minSize: { w: 320, h: 240 },
      defaultPosition: { anchor: "top-right" },
    }),
    def("sv.a", { defaultSize: box, minSize: { w: 300, h: 200 }, defaultPosition: TL }),
    def("sv.b", { defaultSize: box, minSize: { w: 300, h: 200 }, defaultPosition: TL }),
    def("sv.c", { defaultSize: box, minSize: { w: 300, h: 200 }, defaultPosition: TL }),
    def("sv.card", {
      defaultSize: { w: 320, h: 360 },
      minSize: { w: 280, h: 240 },
      usefulSize: { w: 320, h: 360 },
      defaultPosition: TL,
    }),
  ]);
  const small = { w: 1280, h: 720 };
  const kinds = new Set(s7.defs.map((d) => d.kind));
  const pc = (x: number, y: number) => ({ x, y, w: 42, h: 42, pc: true });
  /** A PC in the strip below Initiative (236 high since FR-KIT-14: room for a min-size window). */
  const belowInit = pc(1000, 560);
  const rectOf = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });
  const hits = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const ctxWith = (tokens: PlacementToken[], log?: string[]): ManagerContext => ({
    registry: s7,
    viewport: small,
    available: kinds,
    avoid: () => tokens,
    ...(log && { onAutoMinimise: (id: string, forKind: string) => log.push(`${id}>${forKind}`) }),
  });
  /** The default layout plus `s7.a` opened on an empty map: 68, 60, 440×400. */
  const withA = () => reduce(defaultLayout(s7, small), { type: "open", kind: "sv.a" }, ctxWith([]));
  const stateOf = (ws: Windows, kind: string) => get(ws, kind).state;
  const defOf = (kind: string) => s7.get(kind) as WindowDef;

  test("FR-SHELL-79 band and useful size: the Game log's top − 12 − the usable top; useful = usefulSize, else minOpenH, else min(default h, 360), capped by the band", () => {
    const log = get(defaultLayout(s7, small), "sv.log");
    expect(bandAt(s7, small)).toBe(log.y - 12 - 60);
    expect(bandAt(s7, small)).toBe(412);
    const a = defOf("sv.a");
    expect(useful(a, small, s7)).toEqual({ w: 440, h: 360 });
    expect(useful(defOf("sv.card"), small, s7)).toEqual({ w: 320, h: 360 });
    expect(usefulSize({ ...a, minOpenH: 480 }, small, 412)).toEqual({ w: 440, h: 400 });
    const tall = { ...a, defaultSize: { w: 440, h: 560 }, minOpenH: 480 };
    expect(usefulSize(tall, small, 412).h).toBe(412);
    expect(usefulSize({ ...a, defaultSize: { w: 440, h: 300 } }, small, 412).h).toBe(300);
  });

  test("FR-SHELL-77 auto-minimise instead of covering a PC: a clear spot over a PC + 4 px is not accepted; the look-ahead finds one → the first auto-minimisable window goes and the window lands clear and PC-free", () => {
    // A PC in the only clear column (x 520–856): no PC-free spot there even at min size.
    const tokens = [pc(660, 240)];
    const log: string[] = [];
    const ws = reduce(withA(), { type: "open", kind: "sv.b" }, ctxWith(tokens, log));
    expect(stateOf(ws, "sv.a")).toBe("minimised");
    const b = get(ws, "sv.b");
    expect(rectOf(b)).toEqual({ x: 68, y: 60, ...box });
    expect(pcClear(b, tokens)).toBe(true);
    expect(log).toEqual(["sv.a:main>sv.b"]);
    // Same input twice → same windows auto-minimised and rect.
    expect(reduce(withA(), { type: "open", kind: "sv.b" }, ctxWith(tokens))).toEqual(ws);
  });

  test("FR-SHELL-77 the look-ahead fails (no useful-size PC-free spot even with every launcher window gone): nothing is auto-minimised; shrink to a PC-free spot below the useful size, else the least PC area (not PC-clear)", () => {
    // (d') at the min size: a shrunk PC-free spot that needs sv.a gone → sv.a is auto-minimised.
    const minOnly = [pc(200, 200), pc(660, 240), pc(560, 100), pc(760, 400), belowInit];
    const viaMin = reduce(withA(), { type: "open", kind: "sv.b" }, ctxWith(minOnly));
    expect(stateOf(viaMin, "sv.a")).toBe("minimised");
    expect(pcClear(get(viaMin, "sv.b"), minOnly)).toBe(true);
    // PCs under s7.a's spot and in the middle: no 440×360 PC-free spot on an empty map.
    const hole = [pc(200, 200), pc(660, 300)];
    const shrunk = reduce(withA(), { type: "open", kind: "sv.b" }, ctxWith(hole));
    expect(stateOf(shrunk, "sv.a")).toBe("open");
    const b = get(shrunk, "sv.b");
    expect(pcClear(b, hole)).toBe(true);
    expect(b.w < 440 || b.h < 360).toBe(true); // below its useful size: only step (d) goes there
    // No PC-free spot at all, not even at the min size with sv.a gone (PCs every 150 px): the
    // clear spot over the least PC area, nothing auto-minimised.
    const spread: PlacementToken[] = [];
    for (let x = 80; x < 860; x += 150) for (let y = 70; y < 480; y += 150) spread.push(pc(x, y));
    spread.push(belowInit);
    const last = reduce(withA(), { type: "open", kind: "sv.b" }, ctxWith(spread));
    expect(stateOf(last, "sv.a")).toBe("open");
    const lb = get(last, "sv.b");
    expect(pcClear(lb, spread)).toBe(false);
    expect(hits(lb, get(last, "sv.a"))).toBe(false);
    const scene = {
      windows: [get(last, "sv.a"), get(last, "sv.init"), get(last, "sv.log")].map(rectOf),
      hard: [],
      tokens: spread,
    };
    expect(pcAreaOf(lb, spread)).toBeLessThanOrEqual(brutePcArea(defOf("sv.b"), small, scene));
  });

  test("FR-SHELL-77 FR-SHELL-151 a protected window (Initiative at Start) auto-minimises untouched launcher windows for its spot, never a protected or a remembered one", () => {
    const home = rectOf(get(defaultLayout(s7, small), "sv.init"));
    const closed = reduce(withA(), { type: "close", kind: "sv.init" }, ctxWith([]));
    // Remembered there: stays open, under Initiative.
    const mine = reduce(closed, { type: "setRect", kind: "sv.a", rect: home }, ctxWith([]));
    const started = reduce(mine, { type: "open", kind: "sv.init", by: "feature" }, ctxWith([]));
    expect(stateOf(started, "sv.a")).toBe("open");
    expect(rectOf(get(started, "sv.a"))).toEqual(rectOf(get(mine, "sv.a")));
    let ws = shellSpot(closed, "sv.a", home, small);
    // PCs over the rest of the band.
    const tokens: PlacementToken[] = [];
    for (let x = 80; x < 800; x += 110) for (let y = 70; y < 470; y += 110) tokens.push(pc(x, y));
    tokens.push(belowInit);
    const log: string[] = [];
    ws = reduce(ws, { type: "open", kind: "sv.init", by: "feature" }, ctxWith(tokens, log));
    expect(stateOf(ws, "sv.a")).toBe("minimised");
    expect(stateOf(ws, "sv.log")).toBe("open");
    expect(rectOf(get(ws, "sv.init"))).toEqual(home);
    expect(log).toEqual(["sv.a:main>sv.init"]);
  });

  test("FR-SHELL-78 auto-minimise order: lowest z first, ties → earlier in the entry, a window placed earlier in the sequence last; never protected, fixedDefault, unshown or the window placed", () => {
    const at = (kind: string, z: number): WindowState => ({
      kind,
      instance: "main",
      state: "open",
      x: 68,
      y: 60,
      w: 300,
      h: 200,
      z,
    });
    const ws = [
      at("sv.log", 1),
      at("sv.init", 2),
      at("sv.a", 5),
      at("sv.b", 3),
      at("sv.c", 3),
      at("sv.card", 6),
    ];
    const c = ctxWith([]);
    const order = (list: Windows, late?: Set<string>) =>
      autoMinimiseOrder(list, c, "sv.card", "main", late).map((w) => w.kind);
    expect(order(ws)).toEqual(["sv.b", "sv.c", "sv.a"]);
    expect(order(ws, new Set(["sv.b:main"]))).toEqual(["sv.c", "sv.a", "sv.b"]);
    const hidden = ws.map((w) => (w.kind === "sv.c" ? { ...w, state: "minimised" as const } : w));
    expect(order(hidden)).toEqual(["sv.b", "sv.a"]);
    // Through placement: two windows in the way; the least recently fronted goes first.
    const tokens = [pc(660, 240)];
    const both = reduce(
      reduce(withA(), { type: "open", kind: "sv.c" }, ctxWith([])),
      { type: "focus", kind: "sv.a" },
      ctxWith([]),
    );
    const log: string[] = [];
    const next = reduce(both, { type: "open", kind: "sv.b" }, ctxWith(tokens, log));
    expect(log[0]).toBe("sv.c:main>sv.b");
    expect(new Set(log).size).toBe(log.length); // each window at most once
    expect(pcClear(get(next, "sv.b"), tokens)).toBe(true);
  });

  test("FR-SHELL-79 useful size before shrinking: a card with room only 300 px high PC-free auto-minimises the launcher window and opens at its useful 320×360 (sim-10 a03: 280×308)", () => {
    const tokens = [pc(600, 380)];
    const ws = reduce(withA(), { type: "open", kind: "sv.card" }, ctxWith(tokens));
    expect(stateOf(ws, "sv.a")).toBe("minimised");
    const card = get(ws, "sv.card");
    expect({ w: card.w, h: card.h }).toEqual({ w: 320, h: 360 });
    expect(pcClear(card, tokens)).toBe(true);
  });

  test("FR-SHELL-56 OQ-SHELL-55 B FR-SHELL-146 reopen keeps only spots the user set: a move sets userSpot; a shell-chosen spot now over a PC is re-placed, a user's is kept, even covered (remembered)", () => {
    const tokens = [pc(100, 100)];
    // Shell-chosen: s7.a auto-placed at 68,60 on an empty map, closed, a PC walks under it.
    const shell = reduce(withA(), { type: "close", kind: "sv.a" }, ctxWith([]));
    expect(get(shell, "sv.a").userSpot).toBeUndefined();
    const reopened = reduce(shell, { type: "open", kind: "sv.a" }, ctxWith(tokens));
    expect(pcClear(get(reopened, "sv.a"), tokens)).toBe(true);
    // The user's: moved there (userSpot), closed, the PC under it → kept.
    const spot = { x: 68, y: 60, ...box };
    let user = reduce(withA(), { type: "setRect", kind: "sv.a", rect: spot }, ctxWith([]));
    expect(get(user, "sv.a").userSpot).toBe(true);
    user = reduce(user, { type: "close", kind: "sv.a" }, ctxWith([]));
    user = reduce(user, { type: "open", kind: "sv.a" }, ctxWith(tokens));
    expect(rectOf(get(user, "sv.a"))).toEqual(spot);
    expect(get(user, "sv.a").userSpot).toBe(true);
    // A covered reopen of a remembered window: exact, still the user's (FR-SHELL-146).
    let covered = reduce(user, { type: "close", kind: "sv.a" }, ctxWith([]));
    covered = reduce(covered, { type: "open", kind: "sv.b" }, ctxWith([]));
    covered = reduce(covered, { type: "setRect", kind: "sv.b", rect: spot }, ctxWith([]));
    covered = reduce(covered, { type: "open", kind: "sv.a" }, ctxWith([]));
    expect(rectOf(get(covered, "sv.a"))).toEqual(spot);
    expect(get(covered, "sv.a").userSpot).toBe(true);
    // Round-trips through the entry; older entries without it parse (absent).
    const raw = JSON.stringify(serialise(user, s7));
    const back = restoreLayout(s7, raw, small).windows.find((w) => w.kind === "sv.a");
    expect(back?.userSpot).toBe(true);
  });

  test("FR-SHELL-80 reset keeps the zones: the token-free default layout whatever tokens are drawn; other windows closed; fixedH cleared", () => {
    const tokens = [pc(900, 100), pc(100, 520)];
    const ws = reduce(withA(), { type: "reset" }, ctxWith(tokens));
    expect(ws).toEqual(defaultLayout(s7, small));
    expect(ws.some((w) => w.kind === "sv.a" || w.fixedH || w.userSpot)).toBe(false);
  });

  test("FR-SHELL-81 FR-SHELL-102 FR-SHELL-150 pushed windows return: an untouched one back to the pre-push rect when clear and PC-free; moved, taken or minimised ones stay; a remembered one is never written", () => {
    const tokens = [pc(100, 100)];
    const bar = { x: 68, y: 60, w: 300, h: 44 };
    const spot = { x: 68, y: 60, ...box };
    // Remembered: the push is render-only (FR-SHELL-150), nothing written.
    const mine = reduce(withA(), { type: "setRect", kind: "sv.a", rect: spot }, ctxWith([]));
    expect(reduce(mine, { type: "push", rect: bar }, ctxWith([]))).toBe(mine);
    const base = shellSpot(withA(), "sv.a", spot, small);
    const pushed = reduce(base, { type: "push", rect: bar }, ctxWith([]));
    const at = rectOf(get(pushed, "sv.a"));
    // FR-SHELL-104: through the ladder; full size (rank 6) before nearest the pre-push rect (8).
    expect(at).toEqual({ ...spot, x: bar.x + bar.w + 12 });
    expect(get(pushed, "sv.a").userSpot).toBeUndefined();
    const memory = [
      { kind: "sv.a", instance: "main", rect: spot, cause: "toolbar:map.toolbar", at },
    ];
    const ret = (ws: Windows, t: PlacementToken[] = []) =>
      reduce(ws, { type: "return" }, { ...ctxWith(t), memory: () => memory });
    const back = ret(pushed);
    expect(rectOf(get(back, "sv.a"))).toEqual(spot);
    expect(get(back, "sv.a").userSpot).toBeUndefined();
    // A PC under the old rect: an untouched window doesn't go back over it.
    expect(pcClear(get(ret(pushed, tokens), "sv.a"), tokens)).toBe(true);
    // Moved since the push: stays.
    const moved = { ...at, x: at.x + 20 };
    const dragged = reduce(pushed, { type: "setRect", kind: "sv.a", rect: moved }, ctxWith([]));
    expect(ret(dragged)).toBe(dragged);
    // Its old spot now taken by another window: stays.
    let taken = reduce(pushed, { type: "open", kind: "sv.b" }, ctxWith([]));
    taken = reduce(
      taken,
      { type: "setRect", kind: "sv.b", rect: { x: 68, y: 60, w: 300, h: 200 } },
      ctxWith([]),
    );
    expect(rectOf(get(ret(taken), "sv.a"))).toEqual(at);
    // Minimised meanwhile: stays minimised.
    const parked = reduce(pushed, { type: "minimise", kind: "sv.a" }, ctxWith([]));
    expect(get(ret(parked), "sv.a").state).toBe("minimised");
  });
});
