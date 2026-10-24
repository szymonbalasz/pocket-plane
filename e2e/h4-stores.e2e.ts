// e2e-bundle: h4-stores-e2e
// Sprint 10 H4 (BL-96, FR-LOOT-33 / -34, OQ-LOOT-21 A): player-1 moves Torch ×3 from the party
// inventory into Greystone Keep's Stores with the Inventory tab's Move…; the Stores and the party
// row update for both. Player-1's targets never offer the DM-only tower; the DM's do (eye-off).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const partyTab = (win: Locator, id: string) =>
  win.locator(`[data-testid="party-tab"][data-value="${id}"]`);

async function boardOn(page: Page, tab: string): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await partyTab(board, tab).click();
  await expect(partyTab(board, tab)).toHaveAttribute("aria-selected", "true");
  return board;
}

const itemRow = (scope: Locator, name: string) =>
  scope.getByTestId("party-item-row").filter({ hasText: name });

async function openStores(page: Page, name: string): Promise<Locator> {
  const board = await boardOn(page, "strongholds");
  await board
    .getByTestId("hold-row")
    .filter({ hasText: name })
    .getByTestId("hold-row-open")
    .click();
  const win = shellWindow(page, "hold.stronghold");
  await expect(win.getByTestId("hold-name")).toHaveText(name);
  await win.locator('[data-testid="hold-tab"][data-value="stores"]').click();
  await expect(win.getByTestId("hold-stores")).toBeVisible();
  return win;
}

test("FR-LOOT-33 FR-LOOT-34 BL-96 player-1 moves Torch ×3 from the party inventory into Greystone Keep's Stores; the DM's targets add the hidden tower, player-1's never do", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1600, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);

  // The DM's party row: Move… offers both Stores, the tower marked DM only.
  const dmInv = await boardOn(dm, "inventory");
  await itemRow(dmInv, "Torch").getByTestId("party-item-take").click();
  await dmInv.getByTestId("party-item-target").click();
  const dmOptions = dm.getByTestId("party-item-target-option");
  await expect(dmOptions.filter({ hasText: "Greystone Keep Stores" })).toHaveCount(1);
  await expect(dmOptions.filter({ hasText: "HOLD-SECRET-TOWER Stores" })).toHaveAttribute(
    "data-dm-only",
    "true",
  );
  await dm.keyboard.press("Escape");
  await dmInv.getByTestId("party-item-cancel").click();

  // Player-1: Move… → Greystone Keep Stores, 3.
  const inv = await boardOn(p1, "inventory");
  const torch = itemRow(inv, "Torch");
  const held = Number((await torch.getByTestId("party-item-count").innerText()).slice(1));
  expect(held).toBeGreaterThan(3);
  await expect(torch.getByTestId("party-item-take")).toHaveText("Move…");
  await torch.getByTestId("party-item-take").click();
  const form = inv.getByTestId("party-item-take-form");
  await form.getByTestId("party-item-target").click();
  const options = p1.getByTestId("party-item-target-option");
  await expect(options.filter({ hasText: "HOLD-SECRET" })).toHaveCount(0);
  await options.filter({ hasText: "Greystone Keep Stores" }).click();
  await form.getByTestId("party-item-qty").fill("3");
  await expect(form.getByTestId("party-item-submit")).toHaveText("Move");
  await form.getByTestId("party-item-submit").click();
  await expect(form).toHaveCount(0);
  await expect(torch.getByTestId("party-item-count")).toHaveText(`×${held - 3}`);

  // Both see Torch ×3 in Greystone Keep's Stores.
  for (const page of [p1, dm]) {
    const win = await openStores(page, "Greystone Keep");
    await expect(itemRow(win, "Torch").getByTestId("party-item-count")).toHaveText("×3");
  }
});
