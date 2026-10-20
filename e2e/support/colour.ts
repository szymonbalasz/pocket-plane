// Colour picker helpers (CAMP §7 FR-CAMP-35 test IDs): the own picker in Preferences "Your
// colour", the DM's Players panel Popover, palette swatches by hex, and a whole pick + Apply.
import { expect, type Locator, type Page } from "@playwright/test";
import { shellWindow } from "./shell";

/** Opens Preferences from the identity chip (unless open) → its "Your colour" picker. */
export async function ownPicker(page: Page): Promise<Locator> {
  const prefs = shellWindow(page, "shell.prefs");
  if (!(await prefs.isVisible())) await page.getByTestId("ui-prefs-open").click();
  await prefs.waitFor({ state: "visible" });
  return prefs
    .locator('[data-testid="ui-prefs-section"][data-record-id="camp.color"]')
    .getByTestId("camp-color-picker");
}

/** Closes Preferences via the chip (it is on top after `ownPicker`). */
export async function closePrefs(page: Page): Promise<void> {
  const chip = page.getByTestId("ui-prefs-open");
  if ((await chip.getAttribute("data-state")) !== "closed") await chip.click();
  await expect(chip).toHaveAttribute("data-state", "closed");
}

/** The Players panel Popover's picker (the DM's), after its trigger was clicked. */
export const popoverPicker = (page: Page): Locator =>
  page.getByTestId("camp-color-popover").getByTestId("camp-color-picker");

export const swatch = (picker: Locator, hex: string): Locator =>
  picker.locator(`[data-testid="camp-color-swatch"][data-value="${hex}"]`);

/** Types `hex` into the picker's hex field and presses Apply (it must be enabled). */
export async function applyHex(picker: Locator, hex: string): Promise<void> {
  await picker.getByTestId("camp-color-hex").fill(hex);
  await expect(picker.getByTestId("camp-color-apply")).toBeEnabled();
  await picker.getByTestId("camp-color-apply").click();
}

/** The viewer picks their own colour in Preferences, Applies, and closes Preferences again. */
export async function pickOwnColour(page: Page, hex: string): Promise<void> {
  const picker = await ownPicker(page);
  await applyHex(picker, hex);
  await expect(page.getByTestId("ui-prefs-chip-dot")).toHaveAttribute("data-color", hex);
  await closePrefs(page);
}
