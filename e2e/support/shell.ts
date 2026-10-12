// Play-shell helpers (SHELL §7 test IDs).
import type { Locator, Page } from "@playwright/test";

export const launcherButton = (page: Page, kind: string): Locator =>
  page.locator(`[data-testid="ui-launcher-button"][data-record-id="${kind}"]`);

export const shellWindow = (page: Page, kind: string, instance = "main"): Locator =>
  page.locator(`[data-testid="ui-window"][data-record-id="${kind}:${instance}"]`);

/** Opens a window via its launcher button unless it is already open. */
export async function openWindow(page: Page, kind: string): Promise<Locator> {
  const win = shellWindow(page, kind);
  if (!(await win.isVisible())) await launcherButton(page, kind).click();
  await win.waitFor({ state: "visible" });
  return win;
}
