// Play-shell helpers (SHELL §7 test IDs).
import type { Locator, Page } from "@playwright/test";

export const launcherButton = (page: Page, kind: string): Locator =>
  page.locator(`[data-testid="ui-launcher-button"][data-record-id="${kind}"]`);

export const shellWindow = (page: Page, kind: string, instance = "main"): Locator =>
  page.locator(`[data-testid="ui-window"][data-record-id="${kind}:${instance}"]`);

/**
 * Opens a window via its launcher button unless it is already open; a button the bar moved into
 * the "⋯" menu (FR-SHELL-43: narrow viewports, more launcher entries) is picked there. The
 * launcher toggles (FR-SHELL-09), so after an action that opens the window itself (e.g. Start,
 * FR-CBT-60) wait for that first: a click landing just after it would minimise the window again.
 */
export async function openWindow(page: Page, kind: string): Promise<Locator> {
  const win = shellWindow(page, kind);
  if (!(await win.isVisible())) {
    // The bar may still be rendering (a test-mode window appears with the snapshot): wait for the
    // button a while before looking in the menu.
    const clicked = await launcherButton(page, kind)
      .click({ timeout: 5_000 })
      .then(
        () => true,
        () => false,
      );
    if (!clicked) {
      await page.getByTestId("ui-launcher-menu").click();
      await page
        .locator(`[data-testid="ui-launcher-overflow-item"][data-record-id="${kind}"]`)
        .click();
    }
  }
  await win.waitFor({ state: "visible" });
  return win;
}
