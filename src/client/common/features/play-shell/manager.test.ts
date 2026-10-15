import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { clampRect, renderedRect, TOP_BAR_H, workArea } from "./geometry";
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

  test("FR-SHELL-18 appear: a never-moved default window avoids open ones; a moved one stays", () => {
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
    // Moved by the user → kept, even if it covers a.one.
    const rect = { x: one.x + 50, y: one.y + 50, w: 300, h: 200 };
    const moved = reduce(ws, { type: "setRect", kind: "a.late", rect }, here);
    expect(reduce(moved, { type: "appear", kind: "a.late" }, here)).toBe(moved);
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
