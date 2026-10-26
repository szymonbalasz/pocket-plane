// FR-SHELL-104 (tool bars push windows through the placer's ladder) and the live viewport follow (FR-SHELL-51, -53),
// registry-driven on the DM's windows at the four reference viewports.
import { expect, mock, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { renderedWindowRects } from "@ui/features/play-shell/free-area";
import { placedRect, type Rect, type Viewport } from "@ui/features/play-shell/geometry";
import { hardRects, keepOuts } from "@ui/features/play-shell/keep-outs";
import {
  launcherSequence,
  overlaps,
  REFERENCE_VIEWPORTS,
  rectIn,
  rectOf,
} from "@ui/features/play-shell/layout-checks";
import {
  defaultLayout,
  plan,
  pushBars,
  reduce,
  renderedPlaced,
  useful,
  type Windows,
} from "@ui/features/play-shell/manager";
import type { WindowDef } from "@ui/features/play-shell/registry";
import { createShellController } from "@ui/features/play-shell/shell-store";
import { createLayoutStorage } from "@ui/features/play-shell/storage";
import { toolBarMaxWidth } from "@ui/features/scenes-map/tool-bar-spot";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const all = new Set(dmWindows.defs.map((d) => d.kind));
const ctxAt = (viewport: Viewport) => ({ registry: dmWindows, viewport, available: all });

/** The DM's fog bar at its home spot, wrapped to 3 rows at its max width (FR-FOG-58). */
const fogBar = (vp: Viewport): Rect => ({
  x: 64,
  y: 56,
  w: toolBarMaxWidth("dm", { top: 56, left: 64 }, vp),
  h: 128,
});

const grownBy12 = (r: Rect): Rect => ({ x: r.x - 12, y: r.y - 12, w: r.w + 24, h: r.h + 24 });

/** Rendered rects of the open windows, by kind. */
function shown(ws: Windows, vp: Viewport): Map<string, Rect> {
  const open = ws.filter((w) => w.state === "open");
  const rects = renderedWindowRects(
    open,
    dmWindows,
    all,
    vp,
    new Map(),
    hardRects(keepOuts("dm", vp)),
  );
  return new Map(open.map((w, i) => [w.kind, rects[i] as Rect]));
}

function controller(vp: { current: Viewport }) {
  const backend = new Map<string, string>();
  const storage = createLayoutStorage(() => ({
    getItem: (k) => backend.get(k) ?? null,
    setItem: (k, v) => void backend.set(k, v),
  }));
  const c = createShellController({ registry: dmWindows, storage, viewport: () => vp.current });
  return { c, backend };
}

test("FR-SHELL-104 push through the ladder (DM): the Fog tool with Scenes and Compendium open at the four sizes → each window off the bar + 12, on no other window, ≥ its useful size, or (a launcher window) put away itself; Initiative and the Game log off the bar untouched; the same bar again (re-select) changes nothing", () => {
  for (const vp of REFERENCE_VIEWPORTS) {
    const bar = fogBar(vp);
    const label = `${vp.w}×${vp.h}`;
    // Scenes, then Compendium opened from the launcher (the bar not shown yet).
    const { windows: start } = launcherSequence(dmWindows, vp, ["map.scenes", "cmp.compendium"]);
    const before = shown(start, vp);
    expect(overlaps(before.get("map.scenes") as Rect, bar), label).toBe(true);
    const ctx = ctxAt(vp);
    const p = plan(start, { type: "push", rect: bar }, ctx);
    const ws = p.windows;
    const after = shown(ws, vp);
    for (const kind of ["map.scenes", "cmp.compendium"]) {
      const w = ws.find((x) => x.kind === kind) as WindowState;
      if (w.state === "minimised") {
        expect(p.putAway.get(`${kind}:main`), `${label} ${kind}`).toBe("toolbar:map.toolbar");
        continue;
      }
      const r = after.get(kind) as Rect;
      const u = useful(dmWindows.get(kind) as WindowDef, vp, dmWindows);
      expect(r.w >= u.w && r.h >= u.h, `${label} ${kind} ≥ useful`).toBe(true);
      expect(p.placed.get(`${kind}:main`), `${label} ${kind}`).toBe("pushed");
    }
    // Initiative and the Game log are off the bar: untouched (same stored object).
    for (const kind of ["cbt.initiative", "dice.log"]) {
      expect(
        ws.find((w) => w.kind === kind),
        `${label} ${kind}`,
      ).toBe(start.find((w) => w.kind === kind));
    }
    // Nothing on the bar; no shown window on another.
    const list = [...after];
    for (const [kind, r] of list) {
      expect(overlaps(r, grownBy12(bar)), `${label} ${kind} on the bar`).toBe(false);
    }
    list.forEach(([a, ra], i) => {
      for (const [b, rb] of list.slice(i + 1)) {
        expect(overlaps(ra, rb), `${label} ${a} × ${b}`).toBe(false);
      }
    });
    // A second push with the same bar (FR-SHELL-105 re-select): nothing jumps twice.
    expect(reduce(ws, { type: "push", rect: bar }, { ...ctx, memory: () => p.memory })).toBe(ws);
  }
});

test("FR-SHELL-104 push (DM): pushed with area and data-placed pushed, cause toolbar in the memory, the entry keeping the pre-push rect (FR-SHELL-102: never stored); the bar gone, it returns; a window off the bar untouched", () => {
  const vp = { current: { w: 1440, h: 900 } };
  const { c, backend } = controller(vp);
  c.restore("k");
  c.dispatch({ type: "open", kind: "map.scenes" }, all);
  const scenesBefore = rectIn(c.store.getState().windows, "map.scenes");
  const initBefore = c.store.getState().windows.find((w) => w.kind === "cbt.initiative");
  const bar = fogBar(vp.current);
  c.dispatch({ type: "push", rect: bar }, all);
  const state = c.store.getState();
  const scenes = state.windows.find((w) => w.kind === "map.scenes") as WindowState;
  expect(overlaps(rectOf(scenes), grownBy12(bar))).toBe(false);
  expect(scenes.area).toEqual({ w: 1440, h: 900 - 48 - 12 });
  expect(state.placed.get("map.scenes:main")).toBe("pushed");
  expect(state.memory).toEqual([
    {
      kind: "map.scenes",
      instance: "main",
      rect: scenesBefore,
      area: { w: 1440, h: 900 - 48 - 12 },
      cause: "toolbar:map.toolbar",
      at: rectOf(scenes),
    },
  ]);
  expect(state.windows.find((w) => w.kind === "cbt.initiative")).toBe(initBefore);
  expect(state.placed.get("cbt.initiative:main")).not.toBe("pushed");
  const written = JSON.parse(backend.get("k") ?? "{}") as { windows: WindowState[] };
  expect(rectIn(written.windows, "map.scenes")).toEqual(scenesBefore);
  // The tool closes (the bar's report goes): back at its pre-push rect.
  c.dispatch({ type: "return" }, all);
  expect(rectIn(c.store.getState().windows, "map.scenes")).toEqual(scenesBefore);
  expect(c.store.getState().placed.get("map.scenes:main")).toBe("returned");
});

test("FR-SHELL-104 push (DM, OQ-SHELL-61 A): no spot ≥ useful → the pushed launcher window is put away itself (no other window), cause toolbar, back at return; a protected window is never put away: below useful (L4), else the least PC area (L5, flagged)", () => {
  for (const vp of REFERENCE_VIEWPORTS) {
    const label = `${vp.w}×${vp.h}`;
    let ws = reduce(defaultLayout(dmWindows, vp), { type: "open", kind: "map.scenes" }, ctxAt(vp));
    ws = reduce(ws, { type: "open", kind: "cmp.compendium" }, ctxAt(vp));
    // Initiative placed (untouched) over the top-left too.
    ws = ws.map((w) => (w.kind === "cbt.initiative" ? { ...w, x: 68, y: 60, w: 400, h: 500 } : w));
    const scenes0 = ws.find((w) => w.kind === "map.scenes") as WindowState;
    // A bar over all but a strip on the right: no launcher window fits there at its useful size.
    const bar = { x: 64, y: 56, w: vp.w - 64 - 12 - 12 - 320, h: vp.h - 200 };
    const p = plan(ws, { type: "push", rect: bar }, ctxAt(vp));
    const scenes = p.windows.find((w) => w.kind === "map.scenes") as WindowState;
    expect(scenes.state, label).toBe("minimised");
    expect(p.putAway.get("map.scenes:main"), label).toBe("toolbar:map.toolbar");
    // Compendium, not on the bar, stays open where it was.
    const cmp = p.windows.find((w) => w.kind === "cmp.compendium") as WindowState;
    const cmp0 = ws.find((w) => w.kind === "cmp.compendium") as WindowState;
    if (!overlaps(shown(ws, vp).get("cmp.compendium") as Rect, grownBy12(bar))) {
      expect(cmp, label).toBe(cmp0);
    }
    const init = p.windows.find((w) => w.kind === "cbt.initiative") as WindowState;
    expect(init.state, label).toBe("open");
    expect(overlaps(rectOf(init), grownBy12(bar)), label).toBe(false);
    expect(
      p.log.some((l) => /^push:cbt\.initiative>L[1245]/.test(l)),
      label,
    ).toBe(true);
    // The bar goes: Scenes comes back (its old rect if clear, else a spot by L1–L2, FR-SHELL-102).
    const back = plan(
      p.windows,
      { type: "return" },
      { ...ctxAt(vp), memory: () => p.memory, autoMinimised: () => new Set(["map.scenes:main"]) },
    );
    expect(back.windows.find((w) => w.kind === "map.scenes")?.state, label).toBe("open");
    expect(back.windows.find((w) => w.kind === "cbt.initiative")?.state, label).toBe("open");
    expect(back.placed.get("map.scenes:main"), label).toMatch(/returned|grown/);
    expect(scenes0.state, label).toBe("open");
  }
});

test("FR-SHELL-53 live viewport change (DM, W2 finding): the never-resized Game log follows 1440×900 → 1280×720 → back without a reload; a user-resized one keeps its size", () => {
  const vp = { current: { w: 1440, h: 900 } };
  const { c, backend } = controller(vp);
  c.restore("k");
  const log = () => rectIn(c.store.getState().windows, "dice.log");
  expect(log()).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
  vp.current = { w: 1280, h: 720 };
  c.dispatch({ type: "viewport" }, all);
  expect(log()).toEqual({ x: 68, y: 508, w: 690, h: 200 });
  const stored = JSON.parse(backend.get("k") ?? "{}") as { windows: WindowState[] };
  expect(rectIn(stored.windows, "dice.log")).toEqual(log());
  // Same viewport again: nothing changes (same array, no write).
  const same = c.store.getState().windows;
  c.dispatch({ type: "viewport" }, all);
  expect(c.store.getState().windows).toBe(same);
  vp.current = { w: 1440, h: 900 };
  c.dispatch({ type: "viewport" }, all);
  expect(log()).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
  // Resized by the user: kept at its size on the next live change (render-only fit / clamp).
  c.dispatch(
    {
      type: "setRect",
      kind: "dice.log",
      rect: { x: 68, y: 608, w: 900, h: 280 },
      resized: true,
    },
    all,
  );
  vp.current = { w: 1280, h: 720 };
  c.dispatch({ type: "viewport" }, all);
  expect(log()).toEqual({ x: 68, y: 608, w: 900, h: 280 });
  const rendered = shown(c.store.getState().windows, vp.current).get("dice.log") as Rect;
  expect(rendered.y + rendered.h).toBeLessThanOrEqual(720 - 12);
  expect(rendered.x + rendered.w).toBeLessThanOrEqual(1280);
});

test("FR-SHELL-167 pushed window returns to its drop spot (BL-90, sim-12 glitch 9): Scenes dragged under the Fog bar at 1280×720 and 1440×900 → drawn pushed off the bar while Fog is open; on Fog close at the drop rect (`stored`), not its pre-drag spot", () => {
  for (const vp of [
    { w: 1280, h: 720 },
    { w: 1440, h: 900 },
  ]) {
    const label = `${vp.w}×${vp.h}`;
    const reports = new Map<string, Rect>();
    const backend = new Map<string, string>();
    const storage = createLayoutStorage(() => ({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => void backend.set(k, v),
    }));
    const c = createShellController({
      registry: dmWindows,
      storage,
      viewport: () => vp,
      keepOuts: (v) => keepOuts("dm", v, reports),
    });
    c.restore("k");
    const scenes = dmWindows.get("map.scenes") as WindowDef;
    const drawn = () => {
      const w = c.store.getState().windows.find((x) => x.kind === "map.scenes") as WindowState;
      const bars = pushBars(keepOuts("dm", vp, reports));
      const how = renderedPlaced(
        w,
        scenes,
        vp,
        bars,
        c.store.getState().placed.get("map.scenes:main"),
      );
      return { r: placedRect(w, scenes.minSize, vp, bars), how };
    };
    c.dispatch({ type: "open", kind: "map.scenes" }, all);
    const bar = fogBar(vp);
    reports.set("map.toolbar", bar);
    c.dispatch({ type: "push", rect: bar }, all);
    const preDrag = drawn().r;
    // The DM drags Scenes up under the bar.
    const drop = { x: 120, y: 100, w: preDrag.w, h: preDrag.h };
    c.dispatch({ type: "setRect", kind: "map.scenes", rect: drop }, all);
    expect(overlaps(drawn().r, grownBy12(bar)), label).toBe(false);
    expect(drawn().how, label).toBe("pushed");
    reports.delete("map.toolbar");
    c.dispatch({ type: "return" }, all);
    expect(drawn(), label).toEqual({ r: drop, how: "stored" });
  }
});
