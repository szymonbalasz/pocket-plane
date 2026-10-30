// What the screenshot specs share (#368): viewport, themes, and "nothing is still moving".
import { expect, type Locator, type Page } from "@playwright/test";

export const THEMES = ["default", "gilt"] as const;
export const SIZE = { width: 1440, height: 900 };

/** Live, fonts loaded, and no layout change for a few frames (refits, toast settle). */
export async function settled(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(
      async () => {
        const a = await page.evaluate(() => document.body.innerHTML.length);
        await page.waitForTimeout(400);
        return a === (await page.evaluate(() => document.body.innerHTML.length));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** Relative times and clocks change with the run's wall clock. */
export const moving = (page: Page): Locator[] => [page.locator("time")];
