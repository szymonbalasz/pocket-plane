// FR-SHELL-55 (tool bars push windows right) and the live viewport follow (FR-SHELL-51, -53),
// registry-driven on the players' windows at the four reference viewports.
import { expect, test } from "bun:test";
import type { WindowState } from "@shared/play-shell/layout";
import { renderedWindowRects } from "@ui/features/play-shell/free-area";
import type { Rect, Viewport } from "@ui/features/play-shell/geometry";
import { hardRects, keepOuts } from "@ui/features/play-shell/keep-outs";
import {
  overlaps,
  REFERENCE_VIEWPORTS,
  rectIn,
  rectOf,
} from "@ui/features/play-shell/layout-checks";
import { defaultLayout, reduce } from "@ui/features/play-shell/manager";
import { TOOL_BAR_MAX_W, toolBarMaxWidth } from "@ui/features/scenes-map/tool-bar-spot";
import { playerWindows } from "../../windows";

const all = new Set(playerWindows.defs.map((d) => d.kind));
const ctxAt = (viewport: Viewport) => ({ registry: playerWindows, viewport, available: all });

/** The AoE panel at its home spot (scene-tools' `w-64` panel with its border, ~330 high). */
const AOE_PANEL: Rect = { x: 64, y: 56, w: 258, h: 330 };

const shownRects = (ws: readonly WindowState[], vp: Viewport) => {
  const open = ws.filter((w) => w.state === "open");
  const rects = renderedWindowRects(
    open,
    playerWindows,
    all,
    vp,
    new Map(),
    hardRects(keepOuts("player", vp)),
  );
  return new Map(open.map((w, i) => [w.kind, rects[i] as Rect]));
};

test("FR-SHELL-55 push right (player): the AoE panel opened with Initiative at its default top-left rect → Initiative pushed to the panel's right + 12, same y and size, clear of the panel and the sheet", () => {
  for (const vp of REFERENCE_VIEWPORTS) {
    const label = `${vp.w}×${vp.h}`;
    // Players' bars end only at 560 px: no keep-out in their top strip (FR-MAP-60).
    expect(toolBarMaxWidth("player", { top: 56, left: 64 }, vp), label).toBe(TOOL_BAR_MAX_W);
    const start = defaultLayout(playerWindows, vp);
    const init = rectIn(start, "cbt.initiative");
    expect({ x: init.x, y: init.y }, label).toEqual({ x: 68, y: 60 });
    const ws = reduce(start, { type: "push", rect: AOE_PANEL }, ctxAt(vp));
    const pushed = rectIn(ws, "cbt.initiative");
    expect(pushed, label).toEqual({ ...init, x: AOE_PANEL.x + AOE_PANEL.w + 12 });
    const after = shownRects(ws, vp);
    const i = after.get("cbt.initiative") as Rect;
    expect(overlaps(i, AOE_PANEL), label).toBe(false);
    expect(overlaps(i, after.get("char.sheet") as Rect), label).toBe(false);
    expect(overlaps(i, after.get("dice.log") as Rect), label).toBe(false);
    // The sheet and the Game log are off the panel: untouched.
    for (const kind of ["char.sheet", "dice.log"]) {
      expect(
        ws.find((w) => w.kind === kind),
        `${label} ${kind}`,
      ).toBe(start.find((w) => w.kind === kind));
    }
  }
});

test("FR-SHELL-55 push right (player): a window not overlapping the bar grown by 12 is untouched; one 11 px off it is pushed", () => {
  const vp = { w: 1280, h: 800 };
  const start = defaultLayout(playerWindows, vp);
  const init = rectIn(start, "cbt.initiative");
  const away = { ...AOE_PANEL, w: init.x - 12 - AOE_PANEL.x }; // ends 12 px before Initiative
  expect(reduce(start, { type: "push", rect: away }, ctxAt(vp))).toBe(start);
  const near = { ...away, w: away.w + 1 };
  const ws = reduce(start, { type: "push", rect: near }, ctxAt(vp));
  expect(rectIn(ws, "cbt.initiative")).toEqual({ ...init, x: near.x + near.w + 12 });
});

test("FR-SHELL-53 FR-SHELL-99 live viewport change (player): the Game log takes its 1280×720 zone after 1440×900 (850×280 → 510×160)", () => {
  const wide = { w: 1440, h: 900 };
  const small = { w: 1280, h: 720 };
  const start = defaultLayout(playerWindows, wide);
  expect(rectOf(start.find((w) => w.kind === "dice.log") as WindowState)).toMatchObject({
    w: 850,
    h: 280,
  });
  const ws = reduce(start, { type: "viewport" }, { ...ctxAt(small), settledViewport: wide });
  const log = rectIn(ws, "dice.log");
  expect({ w: log.w, h: log.h }).toEqual({ w: 510, h: 160 });
  expect(log.y + log.h).toBeLessThanOrEqual(small.h - 64 - 12);
  // Unchanged viewport: same array.
  expect(reduce(ws, { type: "viewport" }, { ...ctxAt(small), settledViewport: small })).toBe(ws);
});
