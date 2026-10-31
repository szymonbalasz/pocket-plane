// e2e-bundle: compendium
// FR-SHELL-200 (SHELL §13 step 17a): minimising the Compendium keeps what it shows; closing it
// resets that, at the same geometry. Reads only: the bundle's server is shared.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

test("FR-SHELL-200 Compendium: minimise keeps the open entry and search, close resets them", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  const win = await openWindow(dm, "cmp.compendium");
  await win.getByTestId("cmp-search").fill("goblin");
  await win.getByTestId("cmp-result").filter({ hasText: "Goblin" }).first().click();
  await expect(win.getByTestId("cmp-entry")).toContainText("Goblin");

  // Minimise, restore: still on Goblin.
  await win.getByTestId("ui-window-minimise").click();
  await expect(win).not.toBeVisible();
  const restored = await openWindow(dm, "cmp.compendium");
  await expect(restored.getByTestId("cmp-entry")).toContainText("Goblin");
  await restored.getByTestId("cmp-back").click();
  await expect(restored.getByTestId("cmp-search")).toHaveValue("goblin");
  await restored.getByTestId("cmp-result").filter({ hasText: "Goblin" }).first().click();
  await expect(restored.getByTestId("cmp-entry")).toBeVisible();
  const box = await restored.boundingBox();

  // Close, reopen: the list, search empty, the All tab, same spot.
  await restored.getByTestId("ui-window-close").click();
  await expect(shellWindow(dm, "cmp.compendium")).toHaveCount(0);
  const again = await openWindow(dm, "cmp.compendium");
  await expect(again.getByTestId("cmp-search")).toHaveValue("");
  await expect(again.getByTestId("cmp-entry")).toHaveCount(0);
  await expect(again.locator('[data-testid="cmp-tab"][data-value="all"]')).toHaveAttribute(
    "data-state",
    "active",
  );
  expect(await again.boundingBox()).toEqual(box);

  await dm.context().close();
});
