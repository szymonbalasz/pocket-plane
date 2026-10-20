import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { clampRect, type Rect, renderedRect, TOP_BAR_H, workArea } from "./geometry";
import {
  defaultLayout,
  launcherState,
  launcherTooltip,
  type ManagerContext,
  mountedWindows,
  reduce,
  restoreLayout,
  serialise,
  topWindow,
  type WindowAction,
  type Windows,
} from "./manager";
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
const run = (ws: Windows, ...actions: WindowAction[]) =>
  actions.reduce((acc, a) => reduce(acc, a, ctx), ws);
const get = (ws: Windows, kind: string) => ws.find((w) => w.kind === kind) as WindowState;
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

  test("FR-SHELL-18, -41 appear: a default window avoids open ones; a moved one stays unless it covers one", () => {
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
    const fixed = get(reduce(ws, { type: "appear", kind: "a.late" }, here), "a.late");
    expect(covered(fixed, one)).toBe(false);
    expect(reduce(ws, { type: "appear", kind: "a.late" }, gone)).toBe(ws); // still unavailable
    // Moved by the user clear of a.one → kept; over a.one → auto-placed (FR-SHELL-41).
    const clear = { x: 900, y: 500, w: 300, h: 200 };
    const away = reduce(ws, { type: "setRect", kind: "a.late", rect: clear }, here);
    expect(reduce(away, { type: "appear", kind: "a.late" }, here)).toBe(away);
    const rect = { x: one.x + 50, y: one.y + 50, w: 300, h: 200 };
    const moved = reduce(ws, { type: "setRect", kind: "a.late", rect }, here);
    const placed = get(reduce(moved, { type: "appear", kind: "a.late" }, here), "a.late");
    expect(covered(placed, one)).toBe(false);
    expect(placed.area).toEqual(workArea(vp));
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
    return run(ws, { type: "setRect", kind: "a.two", rect: onInit(ws) });
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

  test("FR-SHELL-40 a feature open at an untouched default rect is auto-placed against the tokens", () => {
    const ws = setUp();
    const stored = get(ws, "a.one");
    const tokens = [{ x: stored.x + 10, y: stored.y + 10, w: 60, h: 60 }];
    const withTokens = { ...ctx, avoid: () => tokens };
    const one = get(
      reduce(ws, { type: "open", kind: "a.one", by: "feature" }, withTokens),
      "a.one",
    );
    expect(tokens.some((t) => overlap(one, t))).toBe(false);
    // No tokens: it stays where it is.
    const same = get(run(ws, { type: "open", kind: "a.one", by: "feature" }), "a.one");
    expect(same).toMatchObject({ x: stored.x, y: stored.y, w: stored.w, h: stored.h });
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
  const rectOf = (w: WindowState): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });
  /** `a.two` open, moved to `spot`, then closed (or minimised); `a.three` open at `other`. */
  const stage = (spot: Rect, other: Rect, how: "close" | "minimise" = "close") =>
    run(
      defaultLayout(registry, vp),
      { type: "open", kind: "a.two" },
      { type: "setRect", kind: "a.two", rect: spot },
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
      defaultLayout(players, vp),
      { type: "open", kind: "a.two" },
      { type: "setRect", kind: "a.two", rect: over },
      { type: "close", kind: "a.two" },
    );
    const back = get(reduce(pws, { type: "open", kind: "a.two" }, pctx), "a.two");
    expect(overlap(back, corner)).toBe(false);
  });

  test("FR-SHELL-56 a minimised (auto-minimised) window restored onto a spot now taken is re-placed; screen full parks the least recently used other window, never itself", () => {
    const big = { defaultSize: { w: 600, h: 584 }, minSize: { w: 600, h: 584 } };
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
    // Three 600-wide windows; the screen holds two: b.one is auto-minimised for b.three.
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

  test("FR-SHELL-56 (6) applying the layout on load re-places nothing, overlaps included", () => {
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
    expect(r.windows.map(rectOf)).toEqual(entry.windows.map((w) => rectOf(w as WindowState)));
  });
});
