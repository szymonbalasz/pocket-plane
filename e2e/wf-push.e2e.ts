// e2e-bundle: wf-frame-e2e
// Sprint 8 WF2 (walkthrough F6, F7, F11 and the push half of F8): tool-bar pushes through the
// placer's ladder (FR-SHELL-104, BL-61), the drag-end and re-select pushes (FR-SHELL-105, BL-52),
// the rail inset and the top bar's ellipsis (FR-SHELL-109, BL-53). Changes no record (the fight,
// fog and scenes stay as loaded). The rules in detail: bun test (`placer.test.ts`, the harness).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { footprintsOf } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** A tool bar grown by 12 px: what a push clears (FR-SHELL-104). */
const grown = (b: Box): Box => ({ x: b.x - 12, y: b.y - 12, w: b.w + 24, h: b.h + 24 });

/** Drags a window by its title bar so its top-left would land at (x, y); no wait for the spot. */
async function drop(page: Page, win: Locator, x: number, y: number) {
  const t = await box(win.getByTestId("ui-window-title"));
  const w = await box(win);
  const grab = { x: t.x + 60, y: t.y + t.h / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (x - w.x), grab.y + (y - w.y), { steps: 6 });
  await page.mouse.up();
}

/** The element at each control's centre sits inside the tool panel (not under a window). */
async function hitTestable(page: Page, controls: Locator) {
  const n = await controls.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i);
    if (!(await c.isVisible())) continue;
    const b = await box(c);
    const inPanel = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x as number, y as number)
          ?.closest('[data-testid="map-tool-panel"]') !== null,
      [b.x + b.w / 2, b.y + b.h / 2],
    );
    expect(inPanel, `control ${i} hit-testable`).toBe(true);
  }
}

test("FR-SHELL-104 FR-SHELL-105 FR-SHELL-150 FR-SHELL-167 tool-bar pushes (DM 1440×900): the Fog bar pushes an untouched Scenes PC-clear (never over Mira) or puts it away (cause toolbar); pressing Fog again keeps the bar; Scenes dragged under the bar (remembered) is drawn aside of it and every Fog control is hit-testable; Fog closed → Scenes back at its drop spot", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const ambush = recordId("battlemap", "scene");
  const scenes = await showToPlayers(dm, "Goblin Ambush");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  const page = dm.getByTestId("ui-play-page");
  const panel = dm.getByTestId("map-tool-panel");

  await test.step("F6: Scenes untouched where the placer put it, Fog tool → Scenes, if under the bar, pushed PC-clear, or put away until the tool closes (BL-61)", async () => {
    await expect(scenes).not.toHaveAttribute("data-remembered", "true");
    await dm.getByTestId("map-tool-fog").click();
    await expect(dm.getByTestId("fog-bar")).toBeVisible();
    await expect(panel).toHaveAttribute("data-spot", "home");
    const bar = await box(panel);
    const log = (await page.getAttribute("data-settle-log")) ?? "";
    if (!/push:map\.scenes>/.test(log)) {
      // Not under the bar: nothing to push.
      expect(overlaps(await box(scenes), grown(bar))).toBe(false);
      return;
    }
    const mira = await footprintsOf(dm, ["Mira"]);
    expect(mira.length).toBeGreaterThan(0);
    if (await scenes.isVisible()) {
      await expect(scenes).toHaveAttribute("data-placed", "pushed");
      await expect(scenes).toHaveAttribute("data-pc-clear", "true");
      const s = await box(scenes);
      expect(overlaps(s, grown(bar))).toBe(false);
      for (const m of mira) expect(overlaps(s, m), "Scenes over Mira").toBe(false);
    } else {
      await expect(scenes).toHaveAttribute("data-auto-minimised-cause", "toolbar:map.toolbar");
    }
  });

  await test.step("F7: Fog pressed again keeps the bar (a re-select push); Scenes dragged under the bar is remembered and drawn aside of it (render-only, FR-SHELL-150); every Fog control hit-testable (BL-52)", async () => {
    await dm.getByTestId("map-tool-fog").click();
    await expect(dm.getByTestId("fog-bar")).toBeVisible();
    await expect(dm.getByTestId("map-tool-fog")).toHaveAttribute("data-state", "on");
    const win = await openWindow(dm, "map.scenes");
    await drop(dm, win, 68, 60);
    await expect(win).toHaveAttribute("data-remembered", "true");
    await expect(win).toHaveAttribute("data-placed", "pushed");
    const bar = await box(panel);
    const w = await box(win);
    expect(overlaps(w, grown(bar)), JSON.stringify({ w, bar })).toBe(false);
    await hitTestable(dm, panel.locator("button"));
  });

  await test.step("F8 (push half), FR-SHELL-167: Fog closed → Scenes at its drop spot (`stored`)", async () => {
    await dm.getByTestId("map-tool-select").click();
    await expect(panel).toHaveCount(0);
    await expect(scenes).toHaveAttribute("data-placed", "stored");
    expect(await box(scenes)).toMatchObject({ x: 68, y: 60 });
  });
  await dm.context().close();
});

test("FR-SHELL-109 rail inset (player-1 1280×800, BL-53): Party at its min width dragged to x 0 renders at x ≥ 68, clear of the tool rail, its tabs whole; the top bar's text ellipsises before the right cluster", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await p1.goto(link("Player 1"));
  await live(p1);
  // sim-11 presents an image to the party: close the popup first (it sits over the left column).
  const popup = p1.getByTestId("party-present-popup");
  const shown = await popup
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) {
    await p1.getByTestId("party-present-close").click();
    await expect(popup).toHaveCount(0);
  }

  await test.step("F11: Party at min width, dragged to x 0 → x ≥ 68, tabs whole", async () => {
    const party = await openWindow(p1, "party.board");
    // Its min width (340): the corner handle dragged far left.
    const handle = await box(party.getByTestId("ui-window-resize"));
    await p1.mouse.move(handle.x + handle.w / 2, handle.y + handle.h / 2);
    await p1.mouse.down();
    await p1.mouse.move(handle.x - 600, handle.y + handle.h / 2, { steps: 6 });
    await p1.mouse.up();
    await expect.poll(async () => (await box(party)).w).toBe(340);
    await drop(p1, party, 0, 120);
    await expect.poll(async () => (await box(party)).x).toBe(68);
    const rail = await box(p1.getByTestId("map-tool-rail"));
    const r = await box(party);
    expect(r.x).toBeGreaterThanOrEqual(rail.x + rail.w);
    const tabs = party.getByTestId("party-tab");
    expect(await tabs.count()).toBeGreaterThan(0);
    for (const t of await tabs.all()) {
      // Five tabs at 340 px: the strip scrolls, never cutting a label (FR-PARTY-46, -76).
      await t.scrollIntoViewIfNeeded();
      const b = await box(t);
      expect(b.x, "tab right of the rail").toBeGreaterThanOrEqual(rail.x + rail.w);
      expect(b.x + b.w, "tab inside the window").toBeLessThanOrEqual(r.x + r.w);
      // The label is whole: not cut by the tab's own box.
      expect(await t.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
  });

  await test.step("Top bar: at 520 px the 'Playing as …' line ellipsises; the right cluster stays whole, nothing under it", async () => {
    await p1.setViewportSize({ width: 520, height: 800 });
    const left = p1.getByTestId("ui-topbar-left");
    const right = p1.getByTestId("ui-topbar-right");
    const line = p1.getByTestId("camp-player-joined");
    await expect(line).toBeVisible();
    await expect.poll(() => line.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    expect(await line.evaluate((e) => getComputedStyle(e).textOverflow)).toBe("ellipsis");
    const l = await box(left);
    const rr = await box(right);
    expect(l.x + l.w).toBeLessThanOrEqual(rr.x);
    expect(await right.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  });
  await p1.context().close();
});
