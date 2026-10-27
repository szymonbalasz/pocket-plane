// Initiative helpers (CBT §7 test IDs; kit-parity FR-KIT-20: Add…, Summon… and End encounter…
// live in the window menu ⋯).
import type { Locator, Page } from "@playwright/test";

/** Opens the DM Initiative's window menu and picks one of its items (the menu is portalled). */
export async function initMenu(
  page: Page,
  init: Locator,
  item: "cbtx-init-add" | "cbt-init-summon" | "cbt-init-end",
): Promise<void> {
  await init.getByTestId("cbt-init-menu").click();
  await page.getByTestId(item).click();
}
