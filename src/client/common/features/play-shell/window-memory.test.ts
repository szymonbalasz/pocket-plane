// Window memory (FR-SHELL-144–155, ADR-0064, protocol §18): a window the user moved or resized
// is remembered; the placer never writes it again, it reopens exactly, on top, nudged on-screen
// and pushed off a shown tool bar only as drawn. Untouched windows keep the ladder. Pure: the
// placer, the manager and the in-memory shell controller.
import { describe, expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import {
  clampRect,
  isRemembered,
  placedRect,
  pushedRect,
  type Rect,
  type Viewport,
} from "./geometry";
import { keepOuts } from "./keep-outs";
import { bruteBest } from "./layout-checks";
import {
  defaultLayout,
  type ManagerContext,
  plan,
  pushBars,
  reduce,
  renderedPlaced,
  restoreLayout,
  type WindowAction,
  type Windows,
} from "./manager";
import { type PlacementToken, pcClear } from "./placement";
import { createWindowRegistry, type WindowDef, type WindowRegistry } from "./registry";
import { createShellController } from "./shell-store";
import { createLayoutStorage } from "./storage";

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
const protectedDefs = [
  def("t.log", {
    defaultOpen: true,
    defaultSize: (vp) => (vp.w >= 1440 ? { w: 1150, h: 240 } : { w: 690, h: 160 }),
    minSize: { w: 300, h: 160 },
    minOpenH: undefined,
    usefulSize: { w: 460, h: 160 },
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
];
const dm = createWindowRegistry("dm", [
  ...protectedDefs,
  def("t.a"),
  def("t.b"),
  def("t.c"),
  def("t.small", { defaultSize: { w: 320, h: 300 }, minSize: { w: 280, h: 240 } }),
]);
const all = new Set(dm.defs.map((d) => d.kind));
const get = (ws: Windows, kind: string) => ws.find((w) => w.kind === kind) as WindowState;
const rectOf = (w: Rect): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });
const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const pc = (x: number, y: number): PlacementToken => ({ x, y, w: 40, h: 40, pc: true });
const topKind = (ws: Windows) => [...ws].sort((a, b) => b.z - a.z)[0]?.kind;
const bar = { x: 64, y: 56, w: 300, h: 100 };

function shell(
  vp: { current: Viewport },
  over: Partial<Parameters<typeof createShellController>[0]> & {
    reports?: Map<string, Rect>;
    backend?: Map<string, string>;
    registry?: WindowRegistry;
  } = {},
) {
  const backend = over.backend ?? new Map<string, string>();
  const reports = over.reports ?? new Map<string, Rect>();
  const registry = over.registry ?? dm;
  const storage = createLayoutStorage(() => ({
    getItem: (k) => backend.get(k) ?? null,
    setItem: (k, v) => void backend.set(k, v),
  }));
  const c = createShellController({
    registry,
    storage,
    viewport: () => vp.current,
    keepOuts: (v) => keepOuts("dm", v, reports),
    ...over,
  });
  c.restore("k");
  const win = (kind: string) => get(c.store.getState().windows, kind);
  const kinds = new Set(registry.defs.map((d) => d.kind));
  const act = (...as: WindowAction[]) => {
    for (const a of as) c.dispatch(a, kinds);
  };
  /** Where `kind` draws now (fit + clamp + the render-only push), and its `data-placed`. */
  const drawn = (kind: string) => {
    const w = win(kind);
    const d = registry.get(kind) as WindowDef;
    const bars = pushBars(keepOuts("dm", vp.current, reports));
    const how = c.store.getState().placed.get(`${kind}:main`);
    return {
      r: placedRect(w, d.minSize, vp.current, bars),
      how: renderedPlaced(w, d, vp.current, bars, how),
    };
  };
  return { c, backend, reports, win, act, drawn };
}

describe("window memory (FR-SHELL-144–155)", () => {
  test("FR-SHELL-144 only a move or resize remembers: click, focus, minimise, restore, close, reopen, a feature open → still untouched; a move end sets userSpot, a resize end userSize", () => {
    const { win, act } = shell({ current: WIDE });
    act({ type: "open", kind: "t.a" });
    for (const a of [
      { type: "focus", kind: "t.a" },
      { type: "minimise", kind: "t.a" },
      { type: "toggle", kind: "t.a" },
      { type: "close", kind: "t.a" },
      { type: "open", kind: "t.a" },
      { type: "open", kind: "t.a", by: "feature" },
      { type: "toggle", kind: "t.a" },
      { type: "open", kind: "t.a", by: "feature" },
    ] as const) {
      act(a);
      expect(isRemembered(win("t.a"))).toBe(false);
    }
    act({ type: "setRect", kind: "t.a", rect: { x: 600, y: 200, w: 440, h: 560 } });
    expect(win("t.a").userSpot).toBe(true);
    expect(win("t.a").userSize).toBeUndefined();
    act(
      { type: "open", kind: "t.b" },
      { type: "setRect", kind: "t.b", rect: { x: 300, y: 200, w: 400, h: 420 }, resized: true },
    );
    expect(win("t.b")).toMatchObject({ userSpot: true, userSize: true });
  });

  test("FR-SHELL-146 reopen exact: over another window, over a PC, in a protected zone; restore from minimised; a feature open; `appear`; `load`; the launcher toggle → the stored rect, `stored`, `>remembered`", () => {
    const init = rectOf(get(defaultLayout(dm, WIDE), "t.init"));
    const over = { x: init.x - 100, y: init.y + 20, w: 440, h: 400 };
    const tokens = [pc(over.x + 60, over.y + 60)];
    const s = shell({ current: WIDE }, { avoid: () => tokens });
    const { c, win, act, backend } = s;
    for (const spot of [over, { ...init, w: 440, h: 420 }]) {
      act({ type: "open", kind: "t.a" }, { type: "setRect", kind: "t.a", rect: spot });
      const stored = rectOf(win("t.a"));
      const others = c.store.getState().windows.filter((w) => w.kind !== "t.a");
      for (const steps of [
        [
          { type: "close", kind: "t.a" },
          { type: "open", kind: "t.a" },
        ],
        [
          { type: "minimise", kind: "t.a" },
          { type: "open", kind: "t.a" },
        ],
        [
          { type: "close", kind: "t.a" },
          { type: "open", kind: "t.a", by: "feature" },
        ],
        [
          { type: "close", kind: "t.a" },
          { type: "toggle", kind: "t.a" },
        ],
      ] as WindowAction[][]) {
        act(...steps);
        expect(rectOf(win("t.a"))).toEqual(stored);
        expect(win("t.a").state).toBe("open");
        expect(c.store.getState().placed.get("t.a:main")).toBe("stored");
        expect(c.store.getState().settleLog).toMatch(/:t\.a>remembered/);
        expect(topKind(c.store.getState().windows)).toBe("t.a");
        // Nothing else moved for it (FR-SHELL-149).
        for (const o of others) expect(rectOf(win(o.kind))).toEqual(rectOf(o));
      }
    }
    // `appear` of a remembered protected window: its stored rect, on top.
    act({ type: "setRect", kind: "t.init", rect: { x: 700, y: 200, w: 400, h: 400 } });
    act({ type: "focus", kind: "t.a" }, { type: "appear", kind: "t.init" });
    expect(rectOf(win("t.init"))).toEqual({ x: 700, y: 200, w: 400, h: 400 });
    expect(topKind(c.store.getState().windows)).toBe("t.init");
    // `load`: a reload restores both exactly (and the settle after the first token draw too).
    const again = shell({ current: WIDE }, { avoid: () => tokens, backend });
    again.act({ type: "load", drawn: true });
    expect(rectOf(again.win("t.a"))).toEqual(rectOf(win("t.a")));
    expect(rectOf(again.win("t.init"))).toEqual({ x: 700, y: 200, w: 400, h: 400 });
  });

  test("FR-SHELL-146 feature opens (seams S14): a feature open never moves a remembered window; it places the opened window only if untouched; an already-open window is fronted, not moved", () => {
    const { c, win, act } = shell({ current: WIDE });
    const mine = { x: 68, y: 60, w: 440, h: 560 }; // the first spot a launcher window takes
    act({ type: "open", kind: "t.a" }, { type: "setRect", kind: "t.a", rect: mine });
    act({ type: "open", kind: "t.b", by: "feature" });
    expect(rectOf(win("t.a"))).toEqual(mine);
    expect(hits(win("t.b"), mine)).toBe(false);
    expect(isRemembered(win("t.b"))).toBe(false);
    act({ type: "minimise", kind: "t.a" }, { type: "open", kind: "t.a", by: "feature" });
    expect(rectOf(win("t.a"))).toEqual(mine);
    const b = rectOf(win("t.b"));
    act({ type: "open", kind: "t.b", by: "feature" });
    expect(rectOf(win("t.b"))).toEqual(b);
    expect(topKind(c.store.getState().windows)).toBe("t.b");
  });

  test("FR-SHELL-147 clamp on-screen: stored at 1440 at the right edge → at 1280 nudged in, size kept, stored rect unchanged; bigger than the work area → shrunk render-only; back at 1440 → exact; a parked window → FR-SHELL-12 only", () => {
    const vp = { current: WIDE };
    const { win, act, drawn } = shell(vp);
    const edge = { x: WIDE.w - 480 - 12, y: 200, w: 480, h: 440 };
    const big = { x: 68, y: 60, w: 1360, h: 500 };
    const parked = { x: -200, y: 200, w: 440, h: 400 };
    act({ type: "open", kind: "t.a" }, { type: "setRect", kind: "t.a", rect: edge });
    act({ type: "open", kind: "t.b" }, { type: "setRect", kind: "t.b", rect: big });
    act({ type: "open", kind: "t.c" }, { type: "setRect", kind: "t.c", rect: parked });
    vp.current = LAPTOP;
    act({ type: "viewport" });
    expect(rectOf(win("t.a"))).toEqual(edge);
    expect(rectOf(win("t.b"))).toEqual(big);
    const a = drawn("t.a").r;
    expect({ w: a.w, h: a.h }).toEqual({ w: 480, h: 440 });
    expect(a.x + a.w).toBeLessThanOrEqual(LAPTOP.w);
    const b = drawn("t.b").r;
    expect(b.w).toBeLessThan(big.w);
    expect(b.x + b.w).toBeLessThanOrEqual(LAPTOP.w);
    expect(drawn("t.c").r).toEqual(clampRect(parked, LAPTOP));
    vp.current = WIDE;
    act({ type: "viewport" });
    expect(drawn("t.a").r).toEqual(edge);
    expect(rectOf(win("t.b"))).toEqual(big);
    expect(drawn("t.a").how).toBe("stored");
  });

  test("FR-SHELL-148 MRU on top: open, toggle, pointer-down (focus), drag start, `appear`, a feature open → highest z; a placer write keeps z; load keeps z", () => {
    const reports = new Map<string, Rect>();
    const { c, act, backend } = shell({ current: WIDE }, { reports });
    const top = () => topKind(c.store.getState().windows);
    act({ type: "open", kind: "t.a" });
    expect(top()).toBe("t.a");
    act({ type: "open", kind: "t.b" });
    expect(top()).toBe("t.b");
    act({ type: "focus", kind: "t.a" }); // a pointer-down inside it, or a move / resize start
    expect(top()).toBe("t.a");
    act({ type: "toggle", kind: "t.b" }); // behind → front
    expect(top()).toBe("t.b");
    act({ type: "appear", kind: "t.init" });
    expect(top()).toBe("t.init");
    act({ type: "minimise", kind: "t.a" }, { type: "open", kind: "t.a", by: "feature" });
    expect(top()).toBe("t.a");
    // A placer write (an untouched window pushed off a bar) keeps z.
    act({ type: "open", kind: "t.small" });
    const st = c.store.getState();
    c.store.setState({
      windows: st.windows.map((w) =>
        w.kind === "t.small" ? { ...w, x: 68, y: 60, w: 320, h: 300 } : w,
      ),
    });
    const z = c.store.getState().windows.map((w) => [w.kind, w.z]);
    reports.set("map.toolbar", bar);
    act({ type: "push", rect: bar });
    expect(c.store.getState().placed.get("t.small:main")).toBe("pushed");
    expect(c.store.getState().windows.map((w) => [w.kind, w.z])).toEqual(z);
    // Load keeps the stored order.
    const again = shell({ current: WIDE }, { backend });
    const order = (ws: Windows) => [...ws].sort((p, q) => p.z - q.z).map((w) => w.kind);
    expect(order(again.c.store.getState().windows)).toEqual(order(c.store.getState().windows));
  });

  test("FR-SHELL-149 nothing makes room: a remembered open over windows and PCs → every other rect and state equal, memory equal, no put-away, `yields` false", () => {
    const tokens = [pc(200, 200), pc(700, 300)];
    const ctx: ManagerContext = {
      registry: dm,
      viewport: LAPTOP,
      available: all,
      keepOuts: () => keepOuts("dm", LAPTOP, new Map()),
      avoid: () => tokens,
      camera: () => "fitted",
      lastFullCell: () => 40,
      dryFit: () => ({ cellPx: 40, clear: true }),
    };
    let ws: Windows = defaultLayout(dm, LAPTOP);
    for (const k of ["t.a", "t.b"]) ws = reduce(ws, { type: "open", kind: k }, ctx);
    ws = reduce(ws, { type: "open", kind: "t.c" }, ctx);
    const over = { x: 150, y: 150, w: 900, h: 450 }; // over both PCs, t.a, t.b, Initiative
    ws = reduce(ws, { type: "setRect", kind: "t.c", rect: over, resized: true }, ctx);
    ws = reduce(ws, { type: "close", kind: "t.c" }, ctx);
    const memory = [
      {
        kind: "t.b",
        instance: "main",
        rect: rectOf(get(ws, "t.b")),
        cause: "viewport:1440×900",
        at: rectOf(get(ws, "t.b")),
      },
    ];
    const p = plan(ws, { type: "open", kind: "t.c" }, { ...ctx, memory: () => memory });
    expect(rectOf(get(p.windows, "t.c"))).toEqual(over);
    for (const w of ws) {
      if (w.kind === "t.c") continue;
      expect({ ...get(p.windows, w.kind), z: 0 }).toEqual({ ...w, z: 0 });
    }
    expect(p.memory).toEqual(memory);
    expect(p.putAway.size).toBe(0);
    expect(p.yields).toBe(false);
    expect(p.log).toEqual(["reopen:t.c>remembered"]);
  });

  test("FR-SHELL-150 render-only push of a remembered window: the least move off the bar (below, else right), ignoring PCs and windows, never shrunk or put away; the stored rect never written; at the stored rect once the bar goes even when overlapped; reload while pushed → the stored rect after the bar goes; a drag while pushed stores the drop rect", () => {
    // The least move: below a short bar; right of a tall one; the size kept.
    const r = { x: 68, y: 60, w: 300, h: 200 };
    expect(pushedRect(r, [bar], WIDE)).toEqual({ ...r, y: bar.y + bar.h + 12 });
    const tall = { x: 64, y: 56, w: 200, h: 700 };
    expect(pushedRect(r, [tall], WIDE)).toEqual({ ...r, x: tall.x + tall.w + 12 });
    expect(pushedRect({ ...r, x: 700 }, [bar], WIDE)).toEqual({ ...r, x: 700 });
    const reports = new Map<string, Rect>();
    const tokens = [pc(100, 180)];
    const s = shell({ current: LAPTOP }, { reports, avoid: () => tokens });
    const { c, win, act, drawn, backend } = s;
    const mine = { x: 70, y: 70, w: 440, h: 420 };
    act({ type: "open", kind: "t.a" }, { type: "setRect", kind: "t.a", rect: mine });
    act({ type: "open", kind: "t.b" }, { type: "setRect", kind: "t.b", rect: { ...mine, x: 300 } });
    const before = c.store.getState().windows;
    reports.set("map.toolbar", bar);
    act({ type: "push", rect: bar });
    expect(c.store.getState().windows).toBe(before);
    expect(c.store.getState().memory).toEqual([]);
    expect(drawn("t.a")).toEqual({ r: { ...mine, y: bar.y + bar.h + 12 }, how: "pushed" });
    expect(win("t.a").state).toBe("open");
    // Reload while the bar shows: still the stored rect; drawn pushed until the bar goes.
    const again = shell({ current: LAPTOP }, { reports, backend });
    expect(rectOf(again.win("t.a"))).toEqual(mine);
    expect(again.drawn("t.a").how).toBe("pushed");
    reports.delete("map.toolbar");
    again.act({ type: "return" });
    expect(again.drawn("t.a")).toEqual({ r: mine, how: "stored" });
    act({ type: "return" });
    expect(drawn("t.a")).toEqual({ r: mine, how: "stored" }); // t.b overlaps it: no matter
    // A drag while pushed stores where it was dropped.
    reports.set("map.toolbar", bar);
    const drop = { x: 120, y: 90, w: 440, h: 420 };
    act({ type: "setRect", kind: "t.a", rect: drop });
    expect(rectOf(win("t.a"))).toEqual(drop);
    expect(drawn("t.a").how).toBe("pushed");
    reports.delete("map.toolbar");
    act({ type: "return" });
    expect(drawn("t.a")).toEqual({ r: drop, how: "stored" });
  });

  test("FR-SHELL-151 untouched first open still placed: PC-clear by the ladder with remembered windows as obstacles; L3 never picks a remembered window; a zone over a remembered window keeps it", () => {
    const tokens = [pc(900, 400), pc(1000, 450)];
    const { win, act, c } = shell({ current: WIDE }, { avoid: () => tokens });
    const mine = { x: 68, y: 60, w: 440, h: 560 };
    act({ type: "open", kind: "t.a" }, { type: "setRect", kind: "t.a", rect: mine });
    act({ type: "open", kind: "t.b" });
    expect(isRemembered(win("t.b"))).toBe(false);
    expect(hits(win("t.b"), mine)).toBe(false);
    expect(pcClear(win("t.b"), tokens)).toBe(true);
    // Remembered windows fill the band; an untouched open with PCs everywhere else: no
    // remembered window is put away (the new one may land on one, FR-SHELL-45's last resort).
    const crowd: PlacementToken[] = [];
    for (let x = 0; x < LAPTOP.w; x += 60)
      for (let y = 48; y < LAPTOP.h; y += 60) crowd.push(pc(x, y));
    const full = shell({ current: LAPTOP }, { avoid: () => crowd });
    full.act(
      { type: "open", kind: "t.a" },
      { type: "setRect", kind: "t.a", rect: { x: 68, y: 60, w: 440, h: 420 } },
      { type: "open", kind: "t.b" },
      { type: "setRect", kind: "t.b", rect: { x: 520, y: 60, w: 400, h: 420 } },
      { type: "open", kind: "t.small" },
    );
    for (const k of ["t.a", "t.b"]) expect(full.win(k).state).toBe("open");
    expect(full.win("t.small").state).toBe("open");
    expect(full.c.store.getState().autoMinimised.size).toBe(0);
    // A zone over a remembered window: Initiative takes it, the remembered window stays under.
    act({ type: "close", kind: "t.init" });
    const zone = rectOf(get(defaultLayout(dm, WIDE), "t.init"));
    act({ type: "setRect", kind: "t.b", rect: { ...zone, w: 440, h: 420 } });
    act({ type: "open", kind: "t.init", by: "feature" });
    expect(rectOf(win("t.init"))).toEqual(zone);
    expect(rectOf(win("t.b"))).toEqual({ ...zone, w: 440, h: 420 });
    expect(topKind(c.store.getState().windows)).toBe("t.init");
  });

  test("FR-SHELL-152 put away stays put away: an untouched window put away for another's open (`open:<kind>`) stays minimised when that window closes; one click reopens it", () => {
    const big = { defaultSize: { w: 580, h: 584 }, minSize: { w: 580, h: 584 } };
    const reg = createWindowRegistry("dm", [
      def("b.one", big),
      def("b.two", big),
      def("b.three", big),
    ]);
    const s = shell({ current: LAPTOP }, { registry: reg });
    s.act({ type: "open", kind: "b.one" }, { type: "open", kind: "b.two" });
    s.act({ type: "open", kind: "b.three" });
    expect(s.win("b.one").state).toBe("minimised");
    expect(s.c.store.getState().autoMinimisedCause.get("b.one:main")).toBe("open:b.three");
    s.act({ type: "close", kind: "b.three" });
    expect(s.win("b.one").state).toBe("minimised");
    s.act({ type: "toggle", kind: "b.one" });
    expect(s.win("b.one").state).toBe("open");
  });

  test("FR-SHELL-153 reset restores defaults: every flag cleared (closed entries too), the named default layout, memory empty, a later open placed", () => {
    const reports = new Map<string, Rect>();
    const { c, win, act } = shell({ current: WIDE }, { reports });
    act(
      { type: "open", kind: "t.a" },
      { type: "setRect", kind: "t.a", rect: { x: 600, y: 300, w: 440, h: 420 } },
    );
    act(
      { type: "open", kind: "t.b" },
      { type: "setRect", kind: "t.b", rect: { x: 100, y: 300, w: 400, h: 400 }, resized: true },
      { type: "close", kind: "t.b" },
    );
    act({ type: "setRect", kind: "t.init", rect: { x: 700, y: 300, w: 400, h: 400 } });
    act({ type: "open", kind: "t.small" });
    reports.set("map.toolbar", rectOf(win("t.small")));
    act({ type: "push", rect: rectOf(win("t.small")) });
    expect(c.store.getState().memory.length).toBeGreaterThan(0);
    reports.delete("map.toolbar");
    act({ type: "reset" });
    const ws = c.store.getState().windows;
    expect(ws).toEqual(defaultLayout(dm, WIDE));
    expect(ws.some((w) => w.userSpot || w.userSize || w.fixedH)).toBe(false);
    expect(c.store.getState().memory).toEqual([]);
    act({ type: "open", kind: "t.a" });
    expect(isRemembered(win("t.a"))).toBe(false);
    expect(c.store.getState().placed.get("t.a:main")).not.toBe("stored");
  });

  test("FR-SHELL-154 old entries: a sprint-8 entry with `userSpot` (and FR-SHELL-100's inferred `userSize`) is remembered from the first load and reopens exact", () => {
    const layout = defaultLayout(dm, WIDE);
    const zone = rectOf(get(layout, "t.init"));
    const raw = JSON.stringify({
      windows: [
        ...layout,
        // In Initiative's zone, no `area` (older entry), a user size never stored.
        {
          kind: "t.a",
          instance: "main",
          state: "open",
          ...zone,
          w: 430,
          h: 410,
          z: 9,
          userSpot: true,
        },
      ],
    });
    const r = restoreLayout(dm, raw, WIDE, [pc(zone.x + 20, zone.y + 20)]);
    const a = get(r.windows, "t.a");
    expect(rectOf(a)).toEqual({ ...zone, w: 430, h: 410 });
    expect(a).toMatchObject({ userSpot: true, userSize: true });
    const p = plan(
      r.windows,
      { type: "close", kind: "t.a" },
      { registry: dm, viewport: WIDE, available: all },
    );
    const back = plan(
      p.windows,
      { type: "open", kind: "t.a" },
      { registry: dm, viewport: WIDE, available: all },
    );
    expect(rectOf(get(back.windows, "t.a"))).toEqual({ ...zone, w: 430, h: 410 });
  });

  test("FR-SHELL-155 party.summary layout migrated: an absorbed entry open / minimised → the absorbing window in that state and z, its own remembered rect or the absorbed x / y at its own size, else placed; `onAbsorb` once; the entry written without it; both open → unchanged; absorbed closed → nothing", () => {
    const calls: string[] = [];
    const reg = createWindowRegistry("dm", [
      ...protectedDefs,
      def("t.board", {
        defaultSize: { w: 550, h: 560 },
        absorbs: ["t.summary"],
        onAbsorb: (from, you) => void calls.push(`${from}:${you?.campaignId ?? "-"}`),
      }),
    ]);
    const base = defaultLayout(reg, WIDE);
    const z0 = base.length + 1;
    const summary = (over: Partial<WindowState>): WindowState =>
      ({
        kind: "t.summary",
        instance: "main",
        state: "open",
        x: 300,
        y: 200,
        w: 320,
        h: 400,
        z: z0,
        ...over,
      }) as WindowState;
    const board = (over: Partial<WindowState>): WindowState =>
      ({
        kind: "t.board",
        instance: "main",
        state: "closed",
        x: 600,
        y: 120,
        w: 500,
        h: 480,
        z: z0 + 1,
        ...over,
      }) as WindowState;
    const load = (windows: WindowState[]) => {
      const backend = new Map([["k", JSON.stringify({ windows: [...base, ...windows] })]]);
      const s = shell(
        { current: WIDE },
        { registry: reg, backend, you: () => ({ campaignId: "c1", role: "dm", playerId: null }) },
      );
      const written = JSON.parse(backend.get("k") ?? "{}") as { windows: WindowState[] };
      return { s, written };
    };
    // Remembered summary, no board entry: the board at its x / y, own size, remembered.
    calls.length = 0;
    let { s, written } = load([summary({ userSpot: true })]);
    expect(s.win("t.board")).toMatchObject({
      state: "open",
      x: 300,
      y: 200,
      w: 550,
      h: 560,
      userSpot: true,
    });
    expect(topKind(s.c.store.getState().windows)).toBe("t.board");
    expect(calls).toEqual(["t.summary:c1"]);
    expect(written.windows.some((w) => w.kind === "t.summary")).toBe(false);
    // A reload: nothing to absorb any more.
    shell({ current: WIDE }, { registry: reg, backend: new Map([["k", JSON.stringify(written)]]) });
    expect(calls).toEqual(["t.summary:c1"]);
    // Minimised, untouched: the board minimised, placed untouched.
    calls.length = 0;
    ({ s } = load([summary({ state: "minimised" })]));
    expect(s.win("t.board").state).toBe("minimised");
    expect(isRemembered(s.win("t.board"))).toBe(false);
    expect(calls).toEqual(["t.summary:c1"]);
    // The board's own remembered rect wins.
    calls.length = 0;
    ({ s } = load([summary({ userSpot: true }), board({ userSpot: true })]));
    expect(s.win("t.board")).toMatchObject({ state: "open", x: 600, y: 120, w: 500, h: 480 });
    // Both open: the board keeps its own state; the summary goes; no onAbsorb.
    calls.length = 0;
    ({ s, written } = load([summary({}), board({ state: "open", userSpot: true })]));
    expect(s.win("t.board")).toMatchObject({ state: "open", x: 600, y: 120 });
    expect(written.windows.some((w) => w.kind === "t.summary")).toBe(false);
    expect(calls).toEqual([]);
    // Summary closed: nothing for the board.
    ({ s } = load([summary({ state: "closed" })]));
    expect(s.win("t.board")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("FR-SHELL-166 oracle starts at the rail (BL-76): a synthetic default x of 20 → no candidate x < 68", () => {
    const left = def("t.left", {
      defaultSize: { w: 300, h: 400 },
      minSize: { w: 300, h: 400 },
      minOpenH: undefined,
      defaultPosition: { anchor: "top-left", dx: 8 }, // x 20
    });
    // A window from x 340 on: only a spot left of the rail (x 20) would be clear.
    const scene = { windows: [{ x: 340, y: 48, w: 1100, h: 800 }], hard: [], tokens: [] };
    expect(bruteBest(left, LAPTOP, scene)[0]).toBe(1);
  });
});

describe("transient displacements are never stored (FR-SHELL-102, -159)", () => {
  test("FR-SHELL-102 a tool bar's push or put-away is never written: a reload while the bar shows (the tool gone) → the window back at its rect, open", () => {
    const crowd: PlacementToken[] = [];
    for (let x = 0; x < LAPTOP.w; x += 60)
      for (let y = 48; y < LAPTOP.h; y += 60) crowd.push(pc(x, y));
    for (const tokens of [[], crowd]) {
      const reports = new Map<string, Rect>();
      const s = shell({ current: LAPTOP }, { reports, avoid: () => tokens });
      s.act({ type: "open", kind: "t.small" });
      const st = s.c.store.getState();
      const home = { x: 68, y: 60, w: 320, h: 300 };
      s.c.store.setState({
        windows: st.windows.map((w) => (w.kind === "t.small" ? { ...w, ...home } : w)),
      });
      reports.set("map.toolbar", bar);
      s.act({ type: "push", rect: bar });
      const now = s.win("t.small");
      // Pushed off the bar (no PCs) or put away (PCs everywhere): either way transient.
      expect(now.state).toBe(tokens === crowd ? "minimised" : "open");
      if (now.state === "open") expect(hits(now, bar)).toBe(false);
      const entry = (JSON.parse(s.backend.get("k") ?? "{}") as { windows: WindowState[] }).windows;
      expect(rectOf(get(entry, "t.small"))).toEqual(home);
      expect(get(entry, "t.small").state).toBe("open");
      // The reload: the tool doesn't survive it.
      const again = shell({ current: LAPTOP }, { backend: s.backend, avoid: () => tokens });
      expect(again.win("t.small").state).toBe("open");
    }
  });
});
