// e2e-bundle: f3-skip-e2e
// Sprint 11 F3 (BL-113, FR-CBTX-44): "Add hidden" ticked when Add… first opens is the spec's
// default (both tickboxes ticked, OQ-CBTX-22, #190), not a remembered choice: unticked and
// closed, the next open is ticked again. Create tokens off → Add hidden reads unticked and is
// disabled (OQ-CBTX-22). Nothing is added (the dialog only opens and closes).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { initMenu } from "./support/initiative";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-CBTX-44 BL-113 Add… opens with Create tokens and Add hidden ticked, every time (by design, not remembered)", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  const dialog = dm.getByTestId("cbtx-add");
  const create = dialog.getByTestId("cbtx-add-create-tokens");
  const hidden = dialog.getByTestId("cbtx-add-hidden");

  await initMenu(dm, init, "cbtx-init-add");
  await expect(dialog).toBeVisible();
  await expect(create).toHaveAttribute("data-state", "checked");
  await expect(hidden).toHaveAttribute("data-state", "checked");
  await expect(hidden).toBeEnabled();

  // The DM's choice holds while the dialog is open …
  await hidden.click();
  await expect(hidden).toHaveAttribute("data-state", "unchecked");
  await create.click();
  await expect(hidden).toBeDisabled();
  await expect(hidden).toHaveAttribute("data-state", "unchecked");
  await create.click();
  await expect(hidden).toHaveAttribute("data-state", "unchecked");
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // … and the next open starts from the defaults again.
  await initMenu(dm, init, "cbtx-init-add");
  await expect(dialog).toBeVisible();
  await expect(create).toHaveAttribute("data-state", "checked");
  await expect(hidden).toHaveAttribute("data-state", "checked");
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await dm.context().close();
});
