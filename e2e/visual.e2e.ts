// e2e-bundle: visual-kit
// Screenshot baselines (#368): the DM and player screens and the kit's main windows in both
// themes, compared with committed renders (e2e/__screenshots__/). Simple Dark must not change and
// Gilt & Stone must not regress without someone deciding so. Baselines are Linux (CI) renders, so
// the spec runs only on Linux; refresh them on purpose with the `screenshots` workflow
// (`gh workflow run screenshots.yml --ref <branch>`), which commits the new renders to the branch.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";
import { storedTheme } from "./support/theme";
import { moving, SIZE, settled, THEMES } from "./support/visual";

test.skip(process.platform !== "linux", "baselines are Linux renders (CI)");

/**
 * Spell FX (FR-VFX-25, -14): map effects drawn at Still, whose frame is the same pixels on every
 * load; at Full the auras move between frames.
 */
async function stillEffects(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("pp.vfx", JSON.stringify({ level: "still" })),
  );
}

/** Preset attrs of the `vfx-aura` nodes on the page's map. */
const auraPresets = (page: Page) =>
  page.evaluate(() => {
    type KStage = { find(s: string): { attrs: { preset?: string } }[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages ?? [])
      .flatMap((s) => s.find(".vfx-aura").map((n) => n.attrs.preset ?? ""))
      .sort();
  });

for (const theme of THEMES) {
  test(`visual: DM screen, stat block and Party status in ${theme}`, async ({ browser }) => {
    const { secret } = e2eEnv();
    const dm = await rolePage(browser);
    await dm.setViewportSize(SIZE);
    await storedTheme(dm, theme);
    await stillEffects(dm);
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
    await stillEffects(p1);
    await p1.goto(link("Player 1"));
    await settled(p1);
    await expect(p1).toHaveScreenshot(`player-${theme}.png`, { mask: moving(p1) });

    const sheet = await openWindow(p1, "char.sheet");
    await expect(sheet.getByTestId("char-sheet-name")).toHaveText("Mira");
    await settled(p1);
    await expect(sheet).toHaveScreenshot(`player-sheet-${theme}.png`);
    await p1.context().close();
  });

  test(`visual: both auras at Still (Spirit Guardians, Shadow of Moil) in ${theme}`, async ({
    browser,
  }) => {
    const { secret, link } = e2eEnv();
    const dm = await rolePage(browser);
    await dm.setViewportSize(SIZE);
    await storedTheme(dm, theme);
    await stillEffects(dm);
    await loginDm(dm, secret);
    await settled(dm);
    await expect.poll(() => auraPresets(dm)).toEqual(["shadow-of-moil", "spirit-guardians"]);
    // The DM: Moil half covers Thorn (FR-VFX-17).
    await expect(dm.getByTestId("map-canvas")).toHaveScreenshot(`dm-auras-${theme}.png`);
    const p1 = await rolePage(browser);
    await p1.setViewportSize(SIZE);
    await storedTheme(p1, theme);
    await stillEffects(p1);
    await p1.goto(link("Player 1"));
    await settled(p1);
    await expect.poll(() => auraPresets(p1)).toEqual(["shadow-of-moil", "spirit-guardians"]);
    // Player 1 doesn't own Thorn: eyes only.
    await expect(p1.getByTestId("map-canvas")).toHaveScreenshot(`player-auras-${theme}.png`);
    await dm.context().close();
    await p1.context().close();
  });
}
