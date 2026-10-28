// Character sheet name picker (BL-139, K11 follow-up): the shared Select over the sheet's name.
// Its trigger `char-sheet-picker` carries the shown sheet's id in `data-value`; its items (portalled
// to the page) are `char-sheet-picker-option` + `data-value` (record id, or "__new") + `data-group`,
// their text the option's label ("Mira · Locked", "Brin (Player 1)", "New character…").
import { expect, type Locator } from "@playwright/test";

/** The picker's "New character…" item value. */
export const NEW_SHEET = "__new";

/**
 * Picks a sheet in the `char.sheet` window `win` by record id (or `{ label }`), and waits until
 * the picker shows it. "New character…" opens the create dialog instead (no wait).
 */
export async function pickSheet(win: Locator, pick: string | { label: string }): Promise<void> {
  const trigger = win.getByTestId("char-sheet-picker");
  await trigger.click();
  const items = win.page().locator('[data-testid="char-sheet-picker-option"]');
  const item =
    typeof pick === "string"
      ? items.and(win.page().locator(`[data-value="${pick}"]`))
      : items.filter({
          hasText: new RegExp(`^${pick.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        });
  const value = await item.getAttribute("data-value");
  await item.click();
  if (value !== NEW_SHEET) await expect(trigger).toHaveAttribute("data-value", value ?? "");
}
