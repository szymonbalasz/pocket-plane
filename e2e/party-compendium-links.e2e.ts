// e2e-bundle: party-cmp
// Thin flow of party item names linking to compendium entries (FR-CMP-84), DM and player-1: the
// Inventory's "Potion of healing" opens the SRD Potion of Healing in its own window, Torch (no
// entry) stays plain; the Loot log's item line names link the same way. Matching, batching and
// visibility: bun test (name-links.test.tsx, FR-CMP-77's server tests).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const tab = (board: Locator, value: string) =>
  board.locator(`[data-testid="party-tab"][data-value="${value}"]`);
const popout = (page: Page) =>
  page
    .locator('[data-testid="ui-window"][data-record-id^="cmp.entry:"]')
    .filter({ hasText: "Potion of Healing" });

for (const role of ["DM", "Player 1"] as const) {
  test(`FR-CMP-84 ${role}: party inventory and Loot log item names open their compendium entries`, async ({
    browser,
  }) => {
    const { secret, link, recordId } = e2eEnv();
    const page = await rolePage(browser);
    await page.setViewportSize({ width: 1600, height: 900 });
    if (role === "DM") await loginDm(page, secret);
    else await page.goto(link(role));
    await live(page);

    const board = await openWindow(page, "party.board");
    await tab(board, "inventory").click();
    const rows = board.getByTestId("party-item-row");
    const potion = rows.and(
      board.locator(`[data-record-id="${recordId("party-items-1", "party-item", 0)}"]`),
    );
    const potionLink = potion.getByTestId("party-item-link");
    await expect(potionLink).toHaveText("Potion of healing");
    // No entry has this name: plain text in a row that is there.
    const torch = rows.filter({ hasText: "Torch" });
    await expect(torch).toHaveCount(1);
    await expect(torch.getByTestId("party-item-link")).toHaveCount(0);

    await potionLink.click();
    await expect(popout(page).getByTestId("cmp-entry")).toBeVisible();
    await expect(popout(page).getByTestId("ui-window-title")).toHaveText("Potion of Healing");
    await popout(page).getByTestId("ui-window-close").click();
    await expect(popout(page)).toHaveCount(0);

    await tab(board, "loot").click();
    const lines = board.getByTestId("loot-entry-item-link");
    await expect(lines.filter({ hasText: "Potion of healing" })).toHaveCount(1);
    await expect(lines.filter({ hasText: "Torch" })).toHaveCount(0);
    await lines.filter({ hasText: "Potion of healing" }).click();
    await expect(popout(page).getByTestId("cmp-entry")).toBeVisible();
  });
}
