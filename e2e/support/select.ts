// Shared Select helpers (kit parity K8 / K10, K6 gap 8): a former native `<select>` is the shared
// Select. Its trigger keeps the test ID and carries the value in `data-value`; its items (portalled
// to the page) are `<id>-option` + `data-value`, their text the old option's label.
import { expect, type Locator } from "@playwright/test";

/** Picks the item of Select `id` (inside `scope`) whose value or label is given. */
export async function pickSelect(
  scope: Locator,
  id: string,
  pick: { value: string } | { label: string },
): Promise<void> {
  const trigger = scope.getByTestId(id);
  await trigger.click();
  const items = scope.page().locator(`[data-testid="${id}-option"]`);
  const item =
    "value" in pick
      ? items.and(scope.page().locator(`[data-value="${pick.value}"]`))
      : items.filter({
          hasText: new RegExp(`^${pick.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        });
  const value = await item.getAttribute("data-value");
  await item.click();
  await expect(trigger).toHaveAttribute("data-value", value ?? "");
}
