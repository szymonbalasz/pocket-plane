// Scenes window helpers (MAP §7 test IDs).
import { expect, type Locator, type Page } from "@playwright/test";
import { openWindow, shellWindow } from "./shell";

/** The DM's Scenes row named exactly `sceneName`. */
export const sceneRow = (page: Page, sceneName: string): Locator =>
  shellWindow(page, "map.scenes")
    .getByTestId("map-scene-row")
    .filter({ has: page.getByTestId("map-scene-row-name").getByText(sceneName, { exact: true }) });

/**
 * FR-MAP-51: shows `sceneName` to players from the Scenes window (opened if needed and left
 * open): hover its row, click the row's Show button, wait for "Live". Already live → no click.
 * Doesn't change the DM's viewed scene.
 */
export async function showToPlayers(page: Page, sceneName: string): Promise<Locator> {
  const win = await openWindow(page, "map.scenes");
  const row = sceneRow(page, sceneName);
  if ((await row.getByTestId("map-scene-live").count()) === 0) {
    await row.hover();
    await row.getByTestId("map-scene-show").click();
  }
  await expect(row.getByTestId("map-scene-live")).toBeVisible();
  return win;
}
