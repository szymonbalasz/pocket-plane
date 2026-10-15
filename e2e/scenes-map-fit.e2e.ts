// e2e-bundle: session-sim
// R1 map fit (MAP §13 step 12, FR-MAP-44/45, FR-SHELL-34), DM + player-1: Goblin Ambush opens
// with no token centre under a window at 1440×900 and 1280×720 (DM incl. hidden Wolf / Elite);
// a pan marks the camera moved, Fit refits; the player's Initiative appearing on Start refits.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const WIDE = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 720 };

/** Tokens drawn (count) and those whose centre lies inside a rendered window. */
async function coverage(page: Page) {
  const tokens = await konvaNodes(page, "map-token");
  const shown = page.locator('[data-testid="ui-window"]:not([data-state="minimised"])');
  const wins = await shown.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
  const covered = tokens
    .filter((t) => wins.some((r) => t.x > r.x && t.x < r.x + r.w && t.y > r.y && t.y < r.y + r.h))
    .map((t) => t.id);
  return { count: tokens.length, covered };
}

async function expectUncovered(page: Page, count: number) {
  await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-camera", "fitted");
  await expect.poll(() => coverage(page)).toEqual({ count, covered: [] });
}

/** Pan by dragging empty canvas just below the top bar (above the fitted content box). */
async function pan(page: Page) {
  const vp = page.viewportSize() ?? WIDE;
  const at = { x: vp.width / 2, y: 56 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 200, at.y + 150, { steps: 8 });
  await page.mouse.up();
}

test("FR-MAP-44 / -45 FR-SHELL-34 fit to the free area: open, reload, pan + Fit, Initiative appears (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const encounterId = recordId("encounter-1", "encounter");

  const dm = await rolePage(browser);
  await dm.setViewportSize(WIDE);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("map-tool-fit")).toBeVisible();
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await dm.getByTestId("map-show-to-players").click();
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  await expect(shellWindow(dm, "cbt.initiative")).toBeVisible(); // default layout
  // Six tokens, the hidden Wolf and Elite included.
  await expectUncovered(dm, 6);

  const player = await rolePage(browser);
  await player.setViewportSize(WIDE);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expectUncovered(player, 4);

  // Pan away → moved; Fit → fitted, tokens uncovered again.
  await pan(player);
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");
  await player.getByTestId("map-tool-fit").click();
  await expectUncovered(player, 4);

  // The same at 1280×720 after a reload (a resize alone never refits).
  for (const page of [dm, player]) {
    await page.setViewportSize(LAPTOP);
    await page.reload();
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }
  await expectUncovered(dm, 6);
  await expectUncovered(player, 4);
  await pan(dm);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");
  await dm.getByTestId("map-tool-fit").click();
  await expectUncovered(dm, 6);

  // Start: the player's Initiative appears (FR-SHELL-18) and, the camera still fitted, the map
  // refits around it (FR-MAP-44 (b)).
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${encounterId}"]`).click();
  await enc.getByTestId("cbt-enc-start").click();
  await dm.getByTestId("cbt-enc-start-confirm").click();
  // FR-CBT-60: the DM's own Start minimises Encounters once acked.
  await expect(launcherButton(dm, "cbt.encounters")).toHaveAttribute("data-state", "minimised");
  await expect(shellWindow(player, "cbt.initiative")).toBeVisible();
  await expectUncovered(player, 4);
});
