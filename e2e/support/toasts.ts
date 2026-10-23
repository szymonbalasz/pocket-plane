// Toast stack helpers (NOTE §7 test IDs).
import type { Page } from "@playwright/test";

/**
 * Closes the toasts and the callout this page shows (closing ≠ dismissing: pending rows stay in
 * Notifications). Sprint 9 (FR-NOTE-70, -71): with a window in the DM's home column and no spot
 * clear of every body, the stack sits on that window's first row (its tabs) by design; a spec
 * that clicks there closes the stack first. A hovered info toast never times out (FR-NOTE-14).
 */
export async function closeToasts(page: Page): Promise<void> {
  const close = page
    .getByTestId("note-toasts")
    .locator('[data-testid="note-toast-close"], [data-testid="note-callout-close"]');
  // Folded toasts ("+N more") show as the visible ones close.
  for (let i = 0; i < 20 && (await close.count()) > 0; i++) await close.first().click();
}
