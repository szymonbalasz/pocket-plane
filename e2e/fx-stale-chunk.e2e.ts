// e2e-bundle: fx-stale-chunk-e2e
// Sprint 9 FX3 (BL-91; SHELL FR-SHELL-175 / -176, thin): the DM page is loaded, then the Dice
// tray's chunk answers 404 (as after a rebuild deleted it). Opening the tray shows the window
// reload panel (`ui-window-reload`, "Rebuild finished — reload"), not "This window failed to
// render."; the socket, the Game log (a roll) and other windows still work. Unrouted, Reload →
// the tray opens. Copy per client, the retry, the guard and the scan: bun test.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const TRAY_CHUNK = /\/assets\/TrayWindow-[^/]+\.js(\?.*)?$/;

test("FR-SHELL-175 FR-SHELL-176 stale Dice tray chunk → reload panel; the page stays live; Reload → the tray opens", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  let blocked = 0;
  await dm.route(TRAY_CHUNK, (route) => {
    blocked += 1;
    return route.fulfill({ status: 404, body: "gone" });
  });
  await loginDm(dm, secret);
  await live(dm);

  // The tray's body chunk is gone: the window shows the reload panel with the DM copy.
  await launcherButton(dm, "dicex.tray").click();
  const tray = shellWindow(dm, "dicex.tray");
  await expect(tray.getByTestId("ui-window-reload")).toBeVisible();
  await expect(tray).toContainText("Rebuild finished — reload");
  await expect(tray).not.toContainText("This window failed to render.");
  expect(blocked).toBeGreaterThanOrEqual(2); // the first try + FR-SHELL-176's one retry

  // The rest of the page stays live: the socket, a Game log roll, another window.
  await live(dm);
  const log = await openWindow(dm, "dice.log");
  await log.getByTestId("dice-roll-expression").fill("1d20+3");
  await log.getByTestId("dice-roll-expression").press("Enter");
  await expect(log.getByTestId("dice-log-entry").filter({ hasText: "1d20+3" })).toHaveCount(1);
  const scenes = await openWindow(dm, "map.scenes");
  await expect(scenes).not.toContainText("This window failed to render.");
  await expect(tray.getByTestId("ui-window-reload")).toBeVisible();

  // The chunk is back (the new build): Reload → the page reloads and the tray opens.
  await dm.unroute(TRAY_CHUNK);
  await Promise.all([dm.waitForEvent("load"), tray.getByTestId("ui-window-reload").click()]);
  await live(dm);
  const reopened = await openWindow(dm, "dicex.tray");
  await expect(reopened.getByTestId("dicex-tray-state")).toBeVisible();
  await expect(reopened.getByTestId("ui-window-reload")).toHaveCount(0);
});
