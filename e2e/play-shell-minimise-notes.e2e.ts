// e2e-bundle: notifications
// FR-SHELL-36 × FR-NOTE-18: a minimised Notifications window stays mounted but is not open to
// the user, so it never marks notifications seen: the DM's bell counts a new one while it is
// minimised; shown again → seen, the bell clears.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

test("FR-SHELL-36 FR-NOTE-18 minimised Notifications doesn't clear the bell; shown again → seen", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const win = await openWindow(dm, "note.history"); // marks everything seen
  const badge = dm.getByTestId("note-launcher-badge");
  await expect(badge).toHaveCount(0);
  await win.getByTestId("ui-window-minimise").click();
  await expect(launcherButton(dm, "note.history")).toHaveAttribute("data-state", "minimised");
  await expect(win).toHaveAttribute("data-state", "minimised"); // parked, still mounted

  // B sends a notification with an action; its owner is the DM.
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const pwin = await openWindow(player, "note.history");
  await pwin.getByTestId("note-test-text").fill("Apply 3 damage?");
  await pwin.getByTestId("note-test-label").fill("Apply");
  await pwin.getByTestId("note-test-send").click();

  await expect(badge).toHaveAttribute("data-count", "1");
  await dm.waitForTimeout(300); // a mounted, minimised body must not mark it seen meanwhile
  await expect(badge).toHaveAttribute("data-count", "1");

  await launcherButton(dm, "note.history").click(); // restore
  await expect(shellWindow(dm, "note.history")).toBeVisible();
  await expect(badge).toHaveCount(0);

  await player.context().close();
  await dm.context().close();
});
