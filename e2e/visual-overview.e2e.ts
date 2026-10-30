// e2e-bundle: overview-visual
// Screenshot baselines for overview scenes (OVW §13): the Sword Coast with its map, labels, dots and
// miniatures, as the DM (hidden items in hidden styling) and as a player, in both themes. Apart from
// `visual.e2e.ts`: bundle `visual-kit` has a battle scene shown, and showing an overview there would
// shift its baselines. Its own bundle, not `overview-scenes`: a server per bundle, so that spec's
// edits never reach these. Linux (CI) renders; refresh with the `screenshots` workflow.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { storedTheme } from "./support/theme";
import { moving, SIZE, settled, THEMES } from "./support/visual";

test.skip(process.platform !== "linux", "baselines are Linux renders (CI)");

/** The first Fit done, the images drawn and the label fonts in: the canvas gets no more redraws. */
async function overviewDrawn(page: Page, items: number) {
  await settled(page);
  await expect(page.getByTestId("ovw-canvas")).toHaveAttribute("data-camera", "fitted");
  await expect.poll(async () => (await konvaNodes(page, "ovw-item")).length).toBe(items);
  await expect.poll(async () => (await konvaNodes(page, "ovw-image")).length).toBeGreaterThan(0);
  await expect.poll(async () => (await konvaNodes(page, "ovw-image-loading")).length).toBe(0);
  await page.evaluate(() =>
    Promise.all(
      ["EB Garamond", "IM Fell English SC", "Alegreya Sans"].map((f) =>
        document.fonts.load(`16px "${f}"`),
      ),
    ).then(() => undefined),
  );
  await settled(page);
}

for (const theme of THEMES) {
  test(`visual: Sword Coast as the DM and as a player in ${theme}`, async ({ browser }) => {
    const { secret, link } = e2eEnv();
    const dm = await rolePage(browser);
    await dm.setViewportSize(SIZE);
    await storedTheme(dm, theme);
    await loginDm(dm, secret);
    await overviewDrawn(dm, 7);
    await expect(dm).toHaveScreenshot(`ovw-dm-${theme}.png`, { mask: moving(dm) });

    const player = await rolePage(browser);
    await player.setViewportSize(SIZE);
    await storedTheme(player, theme);
    await player.goto(link("Player 1"));
    await overviewDrawn(player, 5);
    await expect(player).toHaveScreenshot(`ovw-player-${theme}.png`, { mask: moving(player) });

    await player.context().close();
    await dm.context().close();
  });
}
