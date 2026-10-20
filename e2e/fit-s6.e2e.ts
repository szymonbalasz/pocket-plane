// e2e-bundle: session-sim-9
// Thin sprint-6 Fit (MAP FR-MAP-80, -82; SHELL §13 F0 / F6 / F9, track WF slice WF3). Read-only on
// server state (the bundle is shared): Fit and camera gestures only, no intent. DM: Fit keeps the
// summary strip and every window clear without the empty top-centre box (`all`, cells ≥ 36 px at
// 1440×900, the map not confined left of the box). Player: a pan or zoom gesture marks the camera
// `moved` at its start (FR-MAP-82: a pending reveal refit is cancelled then). The method in detail
// (pcs pan, reveal trigger and timing): bun test (`camera.test.ts`, both `fit-visible.test.ts`).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { openWindow, shellWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TOP_BAR_H = 48;
const RAIL_CLEAR = 68;
/** The DM stack's home strip (FR-NOTE-42, FR-SHELL-59): 320 × 57 at ((vw − 320) / 2, 100). */
const strip = (vw: number): Box => ({ x: Math.round((vw - 320) / 2), y: 100, w: 320, h: 57 });

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** Every shown `ui-window`'s rect (minimised ones are hidden). */
const shownWindows = (page: Page) =>
  page.locator('[data-testid="ui-window"][data-state="open"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      const kind = e.getAttribute("data-record-id") ?? "";
      return { kind, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );

/** Token footprints (screen px): the body's centre ± its cells (`data-cell-px` each). */
async function footprints(page: Page) {
  const cell = Number(await page.getByTestId("map-canvas").getAttribute("data-cell-px"));
  return (await konvaNodes(page, "map-token")).map((t) => {
    const side = Math.max(1, Math.round(t.width / cell)) * cell;
    return { id: t.id, x: t.x - side / 2, y: t.y - side / 2, w: side, h: side };
  });
}

/** Fit from the rail, then wait until the drawn tokens stop moving. */
async function fit(page: Page) {
  await page.getByTestId("map-tool-fit").click();
  const canvas = page.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  await expect(canvas).toHaveAttribute("data-fit-reason", "fit");
  const at = async () =>
    JSON.stringify((await konvaNodes(page, "map-token")).map((t) => [t.x, t.y]));
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await at();
        const stable = now === last && now !== "[]";
        last = now;
        return stable;
      },
      { intervals: [300] },
    )
    .toBe(true);
}

test("FR-MAP-80 fit without the empty box: DM Fit at 1440×900 and 1280×720 with Initiative + Game log → all, every footprint clear of the windows and the summary strip, none under the top bar; at 1440×900 ≥ 36 px and some footprint right of the box's left edge (F0, F6)", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await expect(shellWindow(dm, "cbt.initiative")).toBeVisible();
  await expect(shellWindow(dm, "dice.log")).toBeVisible();
  // View Goblin Ambush (the DM's own view, nothing sent), then close Scenes again.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  const canvas = dm.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", ambush);
  await expect(canvas).toHaveAttribute("data-loading", "false");
  await scenes.getByTestId("ui-window-close").click();
  await expect(scenes).toHaveCount(0);
  await expect.poll(async () => (await konvaNodes(dm, "map-token")).length).toBeGreaterThan(0);

  const cells: string[] = [];
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    const before = dm.viewportSize();
    await dm.setViewportSize(size);
    // A resize refits while fitted (FR-MAP-47, 200 ms later): let it land before the Fit.
    if (before?.width !== size.width || before?.height !== size.height) {
      await expect(canvas).toHaveAttribute("data-fit-reason", "resize");
    }
    await fit(dm);
    await expect(canvas).toHaveAttribute("data-fit-visible", "all");
    const cell = Number(await canvas.getAttribute("data-cell-px"));
    cells.push(`${size.width}×${size.height}: ${cell} px`);
    const launcher = await dm.getByTestId("ui-launcher").boundingBox();
    const area = {
      x: RAIL_CLEAR,
      y: TOP_BAR_H,
      w: size.width - RAIL_CLEAR,
      h: (launcher?.y ?? size.height) - TOP_BAR_H,
    };
    const windows = await shownWindows(dm);
    const home = strip(size.width);
    const tokens = await footprints(dm);
    const blocked = tokens.flatMap((t) => {
      const out: string[] = [];
      const inside =
        t.x >= area.x - 0.5 &&
        t.y >= area.y - 0.5 &&
        t.x + t.w <= area.x + area.w + 0.5 &&
        t.y + t.h <= area.y + area.h + 0.5;
      if (!inside) out.push(`${t.id} outside the work area`);
      for (const w of windows) if (overlaps(t, w)) out.push(`${t.id} under ${w.kind}`);
      if (overlaps(t, home)) out.push(`${t.id} under the summary strip`);
      return out;
    });
    expect(blocked, JSON.stringify({ cell, windows, home })).toEqual([]);
    expect(cell).toBeGreaterThanOrEqual(24);
    if (size.width === 1440) {
      // a00: 28 px, the map confined to x 54–570 left of the box (x 542).
      expect(cell).toBeGreaterThanOrEqual(36);
      expect(tokens.some((t) => t.x + t.w > 542)).toBe(true);
    }
  }
  console.info(`FR-MAP-80 DM Fit cells: ${cells.join("; ")}`);
  await dm.context().close();
});

test("FR-MAP-82 reveal refit: a player's pan (empty-canvas press) and wheel zoom mark the camera moved at the gesture's start; Fit makes it fitted again (F9)", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p = await rolePage(browser);
  await p.setViewportSize({ width: 1280, height: 800 });
  // Player 2: Player 1 opens with the presented handout (sim-9 `handout-present-1`) over the map.
  await p.goto(link("Player 2"));
  await live(p);
  // The shown scene, whichever it is (this spec sends nothing).
  const canvas = p.getByTestId("map-canvas");
  await expect.poll(async () => (await konvaNodes(p, "map-token")).length).toBeGreaterThan(0);
  await fit(p);
  // An empty-canvas spot: the canvas on top (no window, launcher or toast) and no token there.
  const tokens = await footprints(p);
  const spot = await p.evaluate((boxes) => {
    for (let y = 120; y < window.innerHeight - 120; y += 16) {
      for (let x = 80; x < window.innerWidth - 80; x += 16) {
        const el = document.elementFromPoint(x, y);
        if (el?.tagName !== "CANVAS" || !el.closest('[data-testid="map-canvas"]')) continue;
        const near = boxes.some(
          (t) => x >= t.x - 8 && x <= t.x + t.w + 8 && y >= t.y - 24 && y <= t.y + t.h + 24,
        );
        if (!near) return { x, y };
      }
    }
    return null;
  }, tokens);
  expect(spot).not.toBeNull();
  if (!spot) return;
  // Pan: `moved` while the button is still down (the gesture's start), before any drag.
  await p.mouse.move(spot.x, spot.y);
  await p.mouse.down();
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  await p.mouse.move(spot.x + 40, spot.y + 20, { steps: 4 });
  await p.mouse.up();
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  await fit(p);
  // Wheel zoom: `moved` at once.
  await p.mouse.move(640, 400);
  await p.mouse.wheel(0, -120);
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  await fit(p);
  await p.context().close();
});
