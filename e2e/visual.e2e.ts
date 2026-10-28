// e2e-bundle: visual-kit
// Screenshot baselines (#368): the DM and player screens and the kit's main windows in both
// themes, compared with committed renders (e2e/__screenshots__/). Simple Dark must not change and
// Gilt & Stone must not regress without someone deciding so. Baselines are Linux (CI) renders, so
// the spec runs only on Linux; refresh them on purpose with the `screenshots` workflow
// (`gh workflow run screenshots.yml --ref <branch>`), which commits the new renders to the branch.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";
import { storedTheme } from "./support/theme";

test.skip(process.platform !== "linux", "baselines are Linux renders (CI)");

const THEMES = ["default", "gilt"] as const;
const SIZE = { width: 1440, height: 900 };

/** Live, fonts loaded, and no layout change for a few frames (refits, toast settle). */
async function settled(page: Page) {
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
const moving = (page: Page): Locator[] => [page.locator("time")];

for (const theme of THEMES) {
  test(`visual: DM screen, stat block and Party status in ${theme}`, async ({ browser }) => {
    const { secret } = e2eEnv();
    const dm = await rolePage(browser);
    await dm.setViewportSize(SIZE);
    await storedTheme(dm, theme);
    await loginDm(dm, secret);
    await settled(dm);
    await expect(dm).toHaveScreenshot(`dm-${theme}.png`, { mask: moving(dm) });

    const cmp = await openWindow(dm, "cmp.compendium");
    await cmp.getByTestId("cmp-search").fill("goblin");
    await cmp
      .getByTestId("cmp-result")
      .filter({ has: dm.getByTestId("cmp-result-name").getByText("Goblin", { exact: true }) })
      .first()
      .click();
    await expect(cmp.getByTestId("cmp-statblock-core")).toContainText("AC 15");
    await settled(dm);
    await expect(cmp).toHaveScreenshot(`dm-statblock-${theme}.png`);
    await cmp.getByTestId("ui-window-close").click();

    const board = await openWindow(dm, "party.board");
    await expect(board.getByTestId("party-summary-row").first()).toBeVisible();
    await settled(dm);
    await expect(board).toHaveScreenshot(`dm-party-${theme}.png`, { mask: moving(dm) });
    await dm.context().close();
  });

  test(`visual: player screen and sheet in ${theme}`, async ({ browser }) => {
    const { link } = e2eEnv();
    const p1 = await rolePage(browser);
    await p1.setViewportSize(SIZE);
    await storedTheme(p1, theme);
    await p1.goto(link("Player 1"));
    await settled(p1);
    await expect(p1).toHaveScreenshot(`player-${theme}.png`, { mask: moving(p1) });

    const sheet = await openWindow(p1, "char.sheet");
    await expect(sheet.getByTestId("char-sheet-name")).toHaveText("Mira");
    await settled(p1);
    await expect(sheet).toHaveScreenshot(`player-sheet-${theme}.png`);
    await p1.context().close();
  });
}
