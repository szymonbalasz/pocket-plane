// e2e-bundle: party-loot
// Thin party-loot flow (LOOT §13 E2E): DM adds 50 gp → player-1 sees the row, the toast and the
// pot +50 gp; player-1 takes 10 gp from the pot → the DM sees Mira +10 gp. Role matrix, window,
// conservation, restart: bun test (party-loot commands.test.ts, sync.test.ts). Loot opens through
// Party → Loot tab (FR-LOOT-21; the `loot.log` window retired).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow } from "./support/shell";

const potCoin = (win: Locator, coin: string) =>
  win.locator(`[data-testid="loot-pot"] [data-testid="loot-pot-coin"][data-value="${coin}"]`);
const walletCoin = (win: Locator, characterId: string, coin: string) =>
  win.locator(
    `[data-testid="loot-wallet"][data-record-id="${characterId}"] [data-testid="loot-wallet-coin"][data-value="${coin}"]`,
  );

/** Party → Loot tab (FR-PARTY-29); the tab's scope stands in for the retired window. */
async function openLoot(page: Page): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="loot"]').click();
  await board.getByTestId("loot-log").waitFor({ state: "visible" });
  return board;
}

async function pick(page: Page, win: Locator, select: string, value: string) {
  await win.getByTestId(select).click();
  await page.locator(`[data-testid="loot-move-option"][data-value="${value}"]`).click();
}

test("FR-LOOT-03 FR-LOOT-13 FR-LOOT-15 FR-LOOT-18 FR-LOOT-21 DM adds 50 gp → player-1 row, toast, pot; player takes 10 gp → DM sees Mira +10 gp", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const miraId = recordId("char-mira", "entity");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // FR-LOOT-21: no `loot.log` launcher entry; the body is the Party window's Loot tab.
  for (const page of [dm, player]) await expect(launcherButton(page, "loot.log")).toHaveCount(0);
  const dmWin = await openLoot(dm);
  const pWin = await openLoot(player);
  await expect(dmWin.getByTestId("ui-window-title")).toHaveText("Party");
  // Bundle state: pot 5 pp, 30 gp; Mira 21 gp (own, first); 9 rows; player has no add form.
  for (const w of [dmWin, pWin]) {
    await expect(potCoin(w, "gp")).toHaveText("30 gp");
    await expect(walletCoin(w, miraId, "gp")).toHaveText("21 gp");
    await expect(w.getByTestId("loot-entry")).toHaveCount(9);
  }
  await expect(pWin.getByTestId("loot-wallet").first()).toHaveAttribute("data-own", "true");
  await expect(pWin.getByTestId("loot-add")).toHaveCount(0);
  await expect(pWin.getByTestId("loot-entry-edit")).toHaveCount(0);
  await expect(player.getByText("SECOND-CAMPAIGN-LOOT")).toHaveCount(0);

  // DM: "Silver dagger" + 50 gp, Enter.
  const add = dmWin.getByTestId("loot-add");
  await add.getByTestId("loot-add-text").fill("Silver dagger");
  await add.locator('[data-testid="loot-add-coin"][data-value="gp"]').fill("50");
  await add.getByTestId("loot-add-text").press("Enter");
  await expect(add.getByTestId("loot-add-text")).toHaveValue("");

  const top = pWin.getByTestId("loot-entry").first();
  await expect(top).toContainText("Silver dagger");
  await expect(top).toHaveAttribute("data-kind", "loot");
  await expect(potCoin(pWin, "gp")).toHaveText("80 gp");
  await expect(
    player.getByTestId("note-toast").filter({ hasText: "Party loot: Silver dagger (50 gp)" }),
  ).toBeVisible();

  // Player-1: Party pot → Mira 10 gp.
  const move = pWin.getByTestId("loot-move");
  await pick(player, move, "loot-move-from", "party");
  await expect(move.getByTestId("loot-move-to")).toContainText("Mira");
  await move.locator('[data-testid="loot-move-coin"][data-value="gp"]').fill("10");
  await move.getByTestId("loot-move-submit").click();
  await expect(move.locator('[data-testid="loot-move-coin"][data-value="gp"]')).toHaveValue("");

  await expect(walletCoin(dmWin, miraId, "gp")).toHaveText("31 gp");
  await expect(potCoin(dmWin, "gp")).toHaveText("70 gp");
  await expect(dmWin.getByTestId("loot-entry").first()).toHaveAttribute("data-kind", "move");
  await expect(dmWin.getByTestId("loot-entry").first()).toContainText("Party pot → Mira");

  await player.context().close();
  await dm.context().close();
});

// After the first test: pot 5 pp, 70 gp; Mira 31 gp; Thorn 8 gp 30 sp.
test("FR-PARTY-26 FR-PARTY-27 DM Split… Mira + Thorn, prefilled from the pot → preview, pot keeps the remainder, player sees the wallets", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const miraId = recordId("char-mira", "entity");
  const thornId = recordId("char-thorn", "entity");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  await player.goto(link("Player 2"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const dmWin = await openLoot(dm);
  const pWin = await openLoot(player);
  await expect(pWin.getByTestId("loot-split-open")).toHaveCount(0);

  await dmWin.getByTestId("loot-split-open").click();
  const dialog = dm.getByTestId("loot-split-dialog");
  const coin = (k: string) => dialog.locator(`[data-testid="loot-split-coin"][data-value="${k}"]`);
  await expect(coin("pp")).toHaveValue("5");
  await expect(coin("gp")).toHaveValue("70");
  await expect(coin("sp")).toHaveValue("");
  for (const id of [miraId, thornId]) {
    await expect(
      dialog.locator(`[data-testid="loot-split-character"][data-record-id="${id}"]`),
    ).toHaveAttribute("data-state", "checked");
  }
  const preview = dialog.getByTestId("loot-split-preview");
  await expect(preview).toHaveText("Each gets 2 pp, 35 gp; 1 pp stays in the pot");
  // Too little for two → Nothing to split, Split disabled.
  await coin("pp").fill("1");
  await coin("gp").fill("1");
  await expect(preview).toHaveText("Nothing to split");
  await expect(dialog.getByTestId("loot-split-submit")).toBeDisabled();
  await coin("pp").fill("5");
  await coin("gp").fill("70");
  await dialog.getByTestId("loot-split-submit").click();
  await expect(dialog).toHaveCount(0);

  await expect(potCoin(pWin, "pp")).toHaveText("1 pp");
  await expect(potCoin(pWin, "gp")).toHaveCount(0);
  await expect(walletCoin(pWin, miraId, "gp")).toHaveText("66 gp");
  await expect(walletCoin(pWin, miraId, "pp")).toHaveText("2 pp");
  await expect(walletCoin(pWin, thornId, "gp")).toHaveText("43 gp");
  const top = pWin.getByTestId("loot-entry").first();
  await expect(top).toHaveAttribute("data-kind", "move");
  await expect(top).toContainText("Party pot → Thorn");
  await expect(top).toContainText("Split");

  await player.context().close();
  await dm.context().close();
});

// Runs last: switches the active campaign and back.
test("FR-LOOT-18 DM Move form in a campaign without characters: empty state, Move disabled", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const switchTo = async (name: string) => {
    await dm.getByTestId("camp-campaign-switcher").click();
    await dm.getByTestId("camp-campaign-option").filter({ hasText: name }).click();
    await expect(dm.getByTestId("camp-campaign-name")).toHaveText(name);
  };
  await switchTo("Second Campaign");
  const move = (await openLoot(dm)).getByTestId("loot-move");
  await expect(move.getByTestId("loot-move-empty")).toHaveText(
    "No characters to move coin to/from",
  );
  await expect(move.getByTestId("loot-move-from")).toHaveCount(0);
  await expect(move.getByTestId("loot-move-submit")).toBeDisabled();
  await switchTo("Fixture Campaign");
  await dm.context().close();
});
