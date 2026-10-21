// e2e-bundle: party-cmp
// Thin Add to party flow (CMP §13 sprint 5, P4): the DM opens Potion of Healing in the Compendium,
// Add to party ×2 (qty 0 keeps Add disabled) → "Added: Potion of healing ×2" in the Popover, which
// closes after 1.5 s (FR-CMP-57); the `loot-received` toast "Party inventory: …" (FR-PARTY-49) in
// the DM and player-1 clients, and the party Inventory shows "Potion of healing" ×4 (merged). Player-1's Compendium
// has no Add to party. Merge, log row, forbidden for players, leak scans: bun test
// (add-to-party.test.tsx, party-cmp.fixtures.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function openPotion(win: Locator) {
  await win.getByTestId("cmp-search").fill("potion of healing");
  await win.getByTestId("cmp-result").filter({ hasText: "Potion of Healing" }).first().click();
  await expect(win.getByTestId("cmp-entry-header")).toContainText("Potion of Healing");
}

test("FR-CMP-40 FR-CMP-41 FR-CMP-42 FR-CMP-57 FR-PARTY-49 DM adds Potion of Healing ×2 to the party → toast, Inventory ×4; no Add to party for players", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const potion = recordId("party-items-1", "party-item", 0);

  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const pw = await openWindow(p1, "cmp.compendium");
  await openPotion(pw);
  await expect(pw.getByTestId("cmp-add-to-sheet")).toBeVisible();
  await expect(pw.getByTestId("cmp-add-to-party")).toHaveCount(0);

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");
  await openPotion(win);
  await win.getByTestId("cmp-add-to-party").click();
  const panel = dm.getByTestId("cmp-add-to-party-panel");
  const qty = panel.getByTestId("cmp-add-to-party-qty");
  await expect(qty).toHaveValue("1");
  await qty.fill("0");
  await expect(panel.getByTestId("cmp-add-to-party-submit")).toBeDisabled();
  await qty.fill("2");
  await panel.getByTestId("cmp-add-to-party-submit").click();
  // FR-CMP-57: the DM's confirmation, with the party row's spelling after the merge.
  await expect(panel.getByTestId("cmp-add-to-party-done")).toHaveText(
    "Added: Potion of healing ×2",
  );
  await expect(panel).toHaveCount(0);

  // FR-PARTY-49: the loot-received toast says inventory.
  const toast = "Party inventory: Potion of healing ×2";
  await expect(dm.getByText(toast)).toBeVisible();
  await expect(p1.getByText(toast)).toBeVisible();

  const board = await openWindow(dm, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="inventory"]').click();
  const row = board.locator(`[data-testid="party-item-row"][data-record-id="${potion}"]`);
  await expect(row.getByTestId("party-item-name")).toHaveText("Potion of healing");
  await expect(row.getByTestId("party-item-count")).toHaveText("×4");
});
