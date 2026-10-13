import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { clampRect } from "./geometry";
import {
  defaultLayout,
  launcherState,
  type ManagerContext,
  reduce,
  restoreLayout,
  serialise,
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
      { kind: "a.one", instance: "main", state: "open", x: 1288, y: 60, w: 300, h: 200, z: 1 },
    ]);
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
