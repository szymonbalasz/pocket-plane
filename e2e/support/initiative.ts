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

/**
 * FR-KIT-28: an effect in a row's status cell: its icon chip while shown, else the "+N" button
 * naming it (folded chips are only in "+N"'s list). Exactly one of the two matches.
 */
export const statusEffect = (row: Locator, value: string, label: string): Locator =>
  row.locator(
    `[data-testid="cbtx-init-row-effect"][data-value="${value}"], button[aria-label^="More effects:"][aria-label*="${label}"]`,
  );
