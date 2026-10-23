// e2e-bundle: party-s5
// Thin Loot tab flow (PARTY §13.1 S5-8, LOOT §13 sprint 5): Party tabs Handouts, Inventory, Loot
// with party-loot's body in the Loot tab and no "Coin: open Party loot" button; no `loot.log`
// window or launcher entry; a `loot-received` "Open" and the sheet's wallet link open Party on
// Loot (closed, minimised, on Handouts). Read only: player-1 is never opened here (their
// `handout-present-1` popup belongs to party-present.e2e.ts). Tab memory, registries, stored
// layouts: bun test (party-board board.test.tsx, windows.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const tab = (win: Locator, value: string) =>
  win.locator(`[data-testid="party-tab"][data-value="${value}"]`);
const potCoin = (win: Locator, coin: string) =>
  win.locator(`[data-testid="loot-pot"] [data-testid="loot-pot-coin"][data-value="${coin}"]`);

async function expectOnLoot(page: Page) {
  const board = shellWindow(page, "party.board");
  await expect(board).toBeVisible();
  await expect(tab(board, "loot")).toHaveAttribute("aria-selected", "true");
  await expect(board.getByTestId("loot-log")).toBeVisible();
  return board;
}

test("FR-PARTY-29 FR-LOOT-21 Loot tab right of Inventory, no Coin button, no loot.log window or launcher entry (DM, player-2)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  for (const page of [dm, p2]) {
    // Asserted by kind, not by label (review #21).
    await expect(launcherButton(page, "loot.log")).toHaveCount(0);
    await expect(
      page.locator('[data-testid="ui-window"][data-record-id^="loot.log:"]'),
    ).toHaveCount(0);
    const board = await openWindow(page, "party.board");
    const tabs = board.getByTestId("party-tab");
    // Sprint 9: Party status first, Companions gone (FR-PARTY-60).
    await expect(tabs).toHaveCount(4);
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("data-value")))).toEqual([
      "status",
      "handouts",
      "inventory",
      "loot",
    ]);
    await expect(tabs.nth(3)).toHaveText("Loot");
    await expect(page.getByTestId("party-loot-link")).toHaveCount(0);
    await expect(page.getByText("Coin: open Party loot")).toHaveCount(0);

    await tab(board, "loot").click();
    await expect(tab(board, "loot")).toHaveAttribute("aria-selected", "true");
    await expect(potCoin(board, "pp")).toHaveText("5 pp");
    await expect(potCoin(board, "gp")).toHaveText("30 gp");
    await expect(board.getByTestId("loot-wallet").first()).toBeVisible();
    await expect(board.getByTestId("loot-move")).toBeVisible();
    // DM-only parts by role, as in the retired window (FR-LOOT-19).
    await expect(board.getByTestId("loot-add")).toHaveCount(page === dm ? 1 : 0);
    await expect(board.getByTestId("loot-split-open")).toHaveCount(page === dm ? 1 : 0);
  }

  // The tab is remembered per browser (FR-PARTY-11): a reload reopens Party on Loot.
  await p2.reload();
  await live(p2);
  await expectOnLoot(p2);

  await p2.context().close();
  await dm.context().close();
});

test("FR-LOOT-22 FR-PARTY-30 Open goes to the Loot tab (Party closed, minimised, on Handouts)", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  const history = await openWindow(p2, "note.history");
  // Bring the history to front first: Party may open over it.
  const open = async () => {
    await history.getByTestId("ui-window-title").click();
    await history.getByTestId("loot-note-open").first().click();
  };

  // Closed → opens on Loot.
  await expect(shellWindow(p2, "party.board")).toBeHidden();
  await open();
  const board = await expectOnLoot(p2);

  // Minimised → restored on Loot.
  await tab(board, "handouts").click();
  await board.getByTestId("ui-window-minimise").click();
  await expect(board).toBeHidden();
  await open();
  await expectOnLoot(p2);

  // Open on Handouts → switches to Loot.
  await tab(board, "handouts").click();
  // FR-PARTY-50: a visited tab stays mounted, hidden.
  await expect(board.getByTestId("loot-log")).toBeHidden();
  await open();
  await expectOnLoot(p2);

  await p2.context().close();
});

test("FR-LOOT-23 sheet wallet link opens Party on the Loot tab", async ({ browser }) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const board = await openWindow(dm, "party.board");
  await tab(board, "inventory").click();
  const sheet = await openWindow(dm, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="inventory"]').click();
  await sheet.getByTestId("charx-wallet-open").click();
  await expectOnLoot(dm);
  await dm.context().close();
});
