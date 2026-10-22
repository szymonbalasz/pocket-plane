// e2e-bundle: windows-s5
// Tool bars at their home spot push windows off them (SHELL §13 W4, W11; FR-MAP-60, FR-FOG-58;
// sprint 8: through the placer's ladder, FR-SHELL-104), and a live viewport resize lets the
// never-resized Game log follow (FR-SHELL-51, -53; W2 walkthrough finding). Closing the tool
// returns the pushed windows to their spot (FR-SHELL-102). Push rules in detail: bun test
// (`FR-SHELL-104 …`, the session-replay harness).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

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
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** A tool bar grown by 12 px: what a push clears (FR-SHELL-104). */
const grown = (b: Box): Box => ({ x: b.x - 12, y: b.y - 12, w: b.w + 24, h: b.h + 24 });

async function resetLayout(page: Page) {
  await page.getByTestId("ui-launcher-menu").click();
  await page.getByTestId("ui-launcher-reset").click();
}

/** Drags a window by its title bar so its top-left lands at (x, y) (a user move: stored). */
async function dragTo(page: Page, win: Locator, x: number, y: number) {
  const t = await box(win.getByTestId("ui-window-title"));
  const w = await box(win);
  const grab = { x: t.x + 60, y: t.y + t.h / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (x - w.x), grab.y + (y - w.y), { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await box(win)).x).toBe(x);
}

/** The home spot (FR-MAP-60): 8 px right of the rail's box, at the rail's top (y 56). */
async function homeSpot(page: Page): Promise<{ x: number; y: number }> {
  const rail = await box(page.getByTestId("map-tool-rail"));
  return { x: Math.round(rail.x + rail.w) + 8, y: Math.round(rail.y) };
}

/** The element at a control's centre sits inside the tool panel (not under a window). */
async function reachable(page: Page, control: Locator) {
  const c = await box(control);
  const inPanel = await page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x as number, y as number)
        ?.closest('[data-testid="map-tool-panel"]') !== null,
    [c.x + c.w / 2, c.y + c.h / 2],
  );
  expect(inPanel).toBe(true);
}

test("W11 FR-SHELL-104 FR-MAP-60 player-1 at 1280×800, then 1440×900: Initiative over the AoE panel's spot is pushed off it (clear of the panel + 12 and the sheet); every panel control reachable; closing the tool returns it (FR-SHELL-102)", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const init = shellWindow(p1, "cbt.initiative");
  await expect(init).toBeVisible();

  for (const size of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await p1.setViewportSize(size);
    // Initiative at its default top-left rect, where the panel goes.
    await dragTo(p1, init, 68, 60);
    const before = await box(init);
    await p1.getByTestId("map-tool-aoe").click();
    const panel = p1.getByTestId("map-tool-panel");
    await expect(panel).toHaveAttribute("data-spot", "home");
    await expect(p1.getByTestId("scn-aoe-panel")).toBeVisible();
    const pb = await box(panel);
    const home = await homeSpot(p1);
    expect(home.y).toBe(56);
    expect({ x: pb.x, y: pb.y }).toEqual(home);
    expect(pb.w).toBeLessThanOrEqual(560);
    await expect(init).toHaveAttribute("data-placed", "pushed");
    const after = await box(init);
    expect(overlaps(after, grown(pb))).toBe(false);
    expect(overlaps(after, await box(shellWindow(p1, "char.sheet")))).toBe(false);
    await expect(p1.getByTestId("ui-play-page")).toHaveAttribute(
      "data-keep-outs",
      new RegExp(`map\\.toolbar:${pb.x},56,${Math.ceil(pb.w)},${Math.ceil(pb.h)}`),
    );
    // Every panel control clickable without moving a window by hand: Cone, size.
    await reachable(p1, p1.getByTestId("scn-aoe-shape-cone"));
    await p1.getByTestId("scn-aoe-shape-cone").click();
    await reachable(p1, p1.getByTestId("scn-aoe-size"));
    // Close the tool: the keep-out goes, Initiative returns to its spot (FR-SHELL-102).
    await p1.getByTestId("map-tool-select").click();
    await expect(panel).toHaveCount(0);
    await expect(p1.getByTestId("ui-play-page")).not.toHaveAttribute(
      "data-keep-outs",
      /map\.toolbar/,
    );
    await expect(init).toHaveAttribute("data-placed", "returned");
    expect(await box(init)).toEqual(before);
  }
  await p1.context().close();
});

test("W4 FR-SHELL-104 FR-FOG-58 DM at 1440×900, then 1280×720: the Fog tool's bar wraps by group at its home spot, before the toast box; Scenes pushed off it (or put away, cause toolbar); Party vision and View as reachable; closing the tool returns Scenes (FR-SHELL-102)", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await dm.setViewportSize(size);
    await resetLayout(dm);
    const scenes = await openWindow(dm, "map.scenes");
    await dragTo(dm, scenes, 68, 60);
    const before = await box(scenes);
    await dm.getByTestId("map-tool-fog").click();
    const panel = dm.getByTestId("map-tool-panel");
    await expect(dm.getByTestId("fog-bar")).toBeVisible();
    await expect(panel).toHaveAttribute("data-spot", "home");
    const pb = await box(panel);
    expect({ x: pb.x, y: pb.y }).toEqual(await homeSpot(dm));
    // Ends 8 px before the DM's top-centre toast box (FR-MAP-60; 390 / 470 px from x 64).
    const toastX = (size.width - 356) / 2;
    expect(pb.x + pb.w).toBeLessThanOrEqual(toastX - 8 + 0.5);
    // Wrapped into rows, no group split; Party vision and View as on one row.
    const rows = Number(await panel.getAttribute("data-rows"));
    expect(rows).toBeGreaterThanOrEqual(2);
    const groups = dm.getByTestId("fog-bar-group");
    await expect(groups).toHaveCount(6);
    for (const g of await groups.all()) {
      const gb = await box(g);
      expect(gb.h).toBeLessThan(48); // one row each
    }
    const party = await box(dm.getByTestId("fog-party-vision"));
    const viewAs = await box(dm.getByTestId("fog-view-as"));
    expect(Math.abs(party.y + party.h / 2 - (viewAs.y + viewAs.h / 2))).toBeLessThan(8);
    // Scenes pushed off the wrapped bar (+ 12) through the ladder, clear of Initiative; or, no
    // spot at its useful size, put away until the tool closes (OQ-SHELL-61 A).
    if (await scenes.isVisible()) {
      await expect(scenes).toHaveAttribute("data-placed", "pushed");
      const after = await box(scenes);
      expect(overlaps(after, grown(pb))).toBe(false);
      expect(overlaps(after, await box(shellWindow(dm, "cbt.initiative")))).toBe(false);
    } else {
      await expect(scenes).toHaveAttribute("data-auto-minimised-cause", "toolbar:map.toolbar");
    }
    await reachable(dm, dm.getByTestId("fog-party-vision"));
    await reachable(dm, dm.getByTestId("fog-view-as"));
    await dm.getByTestId("fog-view-as").click();
    await expect(dm.getByTestId("fog-view-as-option").first()).toBeVisible();
    await dm.keyboard.press("Escape");
    // Close the tool: Scenes returns to its spot (FR-SHELL-102).
    await dm.getByTestId("map-tool-select").click();
    await expect(panel).toHaveCount(0);
    await expect(scenes).toHaveAttribute("data-placed", "returned");
    expect(await box(scenes)).toEqual(before);
  }
  await dm.context().close();
});

test("FR-SHELL-53 FR-SHELL-51 live resize: the DM's never-resized Game log follows 1440×900 → 1280×720 → 1440×900 without a reload", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await resetLayout(dm);
  const log = shellWindow(dm, "dice.log");
  await expect.poll(() => box(log)).toEqual({ x: 68, y: 584, w: 1150, h: 240 });
  await dm.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => box(log)).toEqual({ x: 68, y: 484, w: 690, h: 160 });
  expect(overlaps(await box(log), await box(shellWindow(dm, "cbt.initiative")))).toBe(false);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => box(log)).toEqual({ x: 68, y: 584, w: 1150, h: 240 });
  await dm.context().close();
});
