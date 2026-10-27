// Game log helpers (kit parity K1, FR-KIT-45): a row shows "Name · action" and its result boxes;
// the full line with its die chips (`dice-log-entry-line`) is in the row's Tooltip, opened by
// hovering the row text.
import { expect, type Locator } from "@playwright/test";

/** The open Tooltip (Radix keeps a closing one in the DOM with `data-state="closed"`). */
const openTip = (entry: Locator) =>
  entry
    .page()
    .locator('[data-testid="ui-tooltip"]:not([data-state="closed"])')
    .filter({ has: entry.page().getByTestId("dice-log-entry-details") });

/**
 * Hovers `entry`'s text and returns its Tooltip's full line (chips, totals, markers). Waits for
 * the row to land first (FR-DICE-40): the roller's own roll popup opens while the line is held
 * and closes a Tooltip opened before it (FR-SHELL-31), which left the helper reading no chips.
 */
export async function entryLine(entry: Locator): Promise<Locator> {
  await expect(entry).toHaveAttribute("data-landed", "true", { timeout: 15_000 });
  await entry.getByTestId("dice-log-entry-text").hover();
  const tip = openTip(entry);
  await expect(tip).toBeVisible();
  return tip.getByTestId("dice-log-entry-line");
}

/** The die chips of `entry`'s full line (FR-DICE-35), from its Tooltip. */
export async function entryDice(entry: Locator): Promise<Locator> {
  return (await entryLine(entry)).getByTestId("dice-log-die");
}

/**
 * Kit parity K8: picks `value` in one of the roll bar's shared Selects (`dice-roll-category`,
 * `dice-roll-actor`): the trigger carries the value in `data-value`, the items (portalled to the
 * page) are `<id>-option` + `data-value`.
 */
export async function pickRollOption(scope: Locator, id: string, value: string): Promise<void> {
  const trigger = scope.getByTestId(id);
  await trigger.click();
  await scope.page().locator(`[data-testid="${id}-option"][data-value="${value}"]`).click();
  await expect(trigger).toHaveAttribute("data-value", value);
}
