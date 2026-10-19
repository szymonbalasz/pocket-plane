// FR-SHELL-55 (tool bars push windows right) and the live viewport follow (FR-SHELL-51, -53),
// registry-driven on the DM's windows at the four reference viewports.
import { expect, mock, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect, Viewport } from "@ui/features/play-shell/geometry";
import { hardRects, keepOuts } from "@ui/features/play-shell/keep-outs";
import {
  launcherSequence,
  overlaps,
  REFERENCE_VIEWPORTS,
  rectIn,
  rectOf,
} from "@ui/features/play-shell/layout-checks";
import { defaultLayout, reduce, type Windows } from "@ui/features/play-shell/manager";
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

test("FR-SHELL-55 push right (DM): the Fog tool with Scenes and Compendium open at the four sizes → Scenes right of the wrapped fog bar (same y and size); Compendium, with no room right, below the bar beside Scenes (1440 / 1600 wide) or auto-minimised where no 360-high slot is left (1280 wide); nothing lands on another window", () => {
  // Compendium below the bar: top = bar bottom + 12 (196), left of Scenes, cut 12 above the Game
  // log (584 − 12 − 196 = 376 ≥ min 360). At 1280 wide the log (484 / 564) leaves < 360.
  const compendium: Record<string, Rect | "minimised"> = {
    "1280×720": "minimised",
    "1280×800": "minimised",
    "1440×900": { x: 94, y: 196, w: 440, h: 376 },
    "1600×900": { x: 174, y: 196, w: 440, h: 376 },
  };
  for (const vp of REFERENCE_VIEWPORTS) {
    const bar = fogBar(vp);
    const label = `${vp.w}×${vp.h}`;
    // Scenes, then Compendium opened from the launcher (the bar not shown yet).
    const { windows: start } = launcherSequence(dmWindows, vp, ["map.scenes", "cmp.compendium"]);
    const before = shown(start, vp);
    expect(overlaps(before.get("map.scenes") as Rect, bar), label).toBe(true);
    expect(overlaps(before.get("cmp.compendium") as Rect, grownBy12(bar)), label).toBe(true);
    const ws = reduce(start, { type: "push", rect: bar }, ctxAt(vp));
    const after = shown(ws, vp);
    const scenes = after.get("map.scenes") as Rect;
    const was = before.get("map.scenes") as Rect;
    expect(scenes, label).toEqual({ ...was, x: bar.x + bar.w + 12 });
    const cmp = ws.find((w) => w.kind === "cmp.compendium") as WindowState;
    const want = compendium[label] as Rect | "minimised";
    if (want === "minimised") expect(cmp.state, label).toBe("minimised");
    else expect({ state: cmp.state, ...rectOf(cmp) }, label).toEqual({ state: "open", ...want });
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
    // A second push with the same bar: nothing jumps twice.
    expect(reduce(ws, { type: "push", rect: bar }, ctxAt(vp))).toBe(ws);
  }
});

test("FR-SHELL-55 push right (DM): below the bar the height shrinks to the clear space, down to min, before anything is auto-minimised", () => {
  const vp = { w: 1440, h: 900 };
  const { windows: start } = launcherSequence(dmWindows, vp, ["map.scenes", "cmp.compendium"]);
  // A taller bar: 584 − 12 − (56 + 150 + 12) = 354 < 360 → Compendium auto-minimised; 140 high:
  // 364 → below at 364 high (min 360).
  const tall = { ...fogBar(vp), h: 150 };
  const parked = reduce(start, { type: "push", rect: tall }, ctxAt(vp));
  expect(parked.find((w) => w.kind === "cmp.compendium")?.state).toBe("minimised");
  const fits = { ...fogBar(vp), h: 140 };
  const ws = reduce(start, { type: "push", rect: fits }, ctxAt(vp));
  expect(rectIn(ws, "cmp.compendium")).toEqual({ x: 94, y: 56 + 140 + 12, w: 440, h: 364 });
});

test("FR-SHELL-55 push right (DM): written with area and data-placed pushed; closing the tool moves nothing back; a window off the bar untouched", () => {
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
  expect(rectOf(scenes)).toEqual({ ...scenesBefore, x: bar.x + bar.w + 12 });
  expect(scenes.area).toEqual({ w: 1440, h: 900 - 48 - 64 });
  expect(state.placed.get("map.scenes:main")).toBe("pushed");
  expect(state.windows.find((w) => w.kind === "cbt.initiative")).toBe(initBefore);
  expect(state.placed.get("cbt.initiative:main")).not.toBe("pushed");
  const written = JSON.parse(backend.get("k") ?? "{}") as { windows: WindowState[] };
  expect(rectIn(written.windows, "map.scenes")).toEqual(rectOf(scenes));
  // The tool closes: no action reaches the shell; a later layout change keeps the pushed rect.
  c.dispatch({ type: "focus", kind: "map.scenes" }, all);
  expect(rectIn(c.store.getState().windows, "map.scenes")).toEqual(rectOf(scenes));
});

test("FR-SHELL-55 push right (DM): no room right at min width nor below → a launcher window auto-minimised, protected Initiative at the right edge at min width", () => {
  for (const vp of REFERENCE_VIEWPORTS) {
    const label = `${vp.w}×${vp.h}`;
    const start = defaultLayout(dmWindows, vp);
    let ws = reduce(start, { type: "open", kind: "map.scenes" }, ctxAt(vp));
    // Initiative moved by the user over the top-left too.
    ws = reduce(
      ws,
      { type: "setRect", kind: "cbt.initiative", rect: { x: 68, y: 60, w: 400, h: 500 } },
      ctxAt(vp),
    );
    const scenesMin = dmWindows.get("map.scenes")?.minSize.w ?? 0;
    const initMin = dmWindows.get("cbt.initiative")?.minSize.w ?? 0;
    // A bar so wide that neither fits right of it (≥ min width left: < Scenes' min), and so tall
    // that no min-height slot is left below it.
    const bar = { x: 64, y: 56, w: vp.w - 64 - 12 - 12 - scenesMin + 20, h: vp.h - 200 };
    const next = reduce(ws, { type: "push", rect: bar }, ctxAt(vp));
    const scenes = next.find((w) => w.kind === "map.scenes") as WindowState;
    expect(scenes.state, label).toBe("minimised");
    const init = next.find((w) => w.kind === "cbt.initiative") as WindowState;
    expect(init.state, label).toBe("open");
    expect({ x: init.x, w: init.w }, label).toEqual({ x: vp.w - 12 - initMin, w: initMin });
  }
});

test("FR-SHELL-55 push right (DM): a window shrinks toward its min width when its size doesn't fit before vw − 12", () => {
  const vp = { w: 1280, h: 720 };
  let ws = reduce(defaultLayout(dmWindows, vp), { type: "open", kind: "map.scenes" }, ctxAt(vp));
  ws = reduce(ws, { type: "minimise", kind: "cbt.initiative" }, ctxAt(vp));
  const min = dmWindows.get("map.scenes")?.minSize.w ?? 0;
  const bar = { x: 64, y: 56, w: vp.w - 64 - 12 - 12 - min - 10, h: 100 };
  const next = reduce(ws, { type: "push", rect: bar }, ctxAt(vp));
  const scenes = next.find((w) => w.kind === "map.scenes") as WindowState;
  expect(scenes.state).toBe("open");
  expect(scenes.x).toBe(bar.x + bar.w + 12);
  expect(scenes.w).toBe(min + 10);
});

test("FR-SHELL-53 live viewport change (DM, W2 finding): the never-resized Game log follows 1440×900 → 1280×720 → back without a reload; a user-resized one keeps its size", () => {
  const vp = { current: { w: 1440, h: 900 } };
  const { c, backend } = controller(vp);
  c.restore("k");
  const log = () => rectIn(c.store.getState().windows, "dice.log");
  expect(log()).toEqual({ x: 68, y: 584, w: 1150, h: 240 });
  vp.current = { w: 1280, h: 720 };
  c.dispatch({ type: "viewport" }, all);
  expect(log()).toEqual({ x: 68, y: 484, w: 690, h: 160 });
  const stored = JSON.parse(backend.get("k") ?? "{}") as { windows: WindowState[] };
  expect(rectIn(stored.windows, "dice.log")).toEqual(log());
  // Same viewport again: nothing changes (same array, no write).
  const same = c.store.getState().windows;
  c.dispatch({ type: "viewport" }, all);
  expect(c.store.getState().windows).toBe(same);
  vp.current = { w: 1440, h: 900 };
  c.dispatch({ type: "viewport" }, all);
  expect(log()).toEqual({ x: 68, y: 584, w: 1150, h: 240 });
  // Resized by the user: kept at its size on the next live change (render-only fit / clamp).
  c.dispatch(
    {
      type: "setRect",
      kind: "dice.log",
      rect: { x: 68, y: 584, w: 900, h: 240 },
      resized: true,
    },
    all,
  );
  vp.current = { w: 1280, h: 720 };
  c.dispatch({ type: "viewport" }, all);
  expect(log()).toEqual({ x: 68, y: 584, w: 900, h: 240 });
  const rendered = shown(c.store.getState().windows, vp.current).get("dice.log") as Rect;
  expect(rendered.y + rendered.h).toBeLessThanOrEqual(720 - 64);
  expect(rendered.x + rendered.w).toBeLessThanOrEqual(1280);
});
