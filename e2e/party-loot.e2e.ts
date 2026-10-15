// e2e-bundle: party-loot
// Thin party-loot flow (LOOT §13 E2E): DM adds 50 gp → player-1 sees the row, the toast and the
// pot +50 gp; player-1 takes 10 gp from the pot → the DM sees Mira +10 gp. Role matrix, window,
// conservation, restart: bun test (party-loot commands.test.ts, sync.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow } from "./support/shell";

const potCoin = (win: Locator, coin: string) =>
  win.locator(`[data-testid="loot-pot"] [data-testid="loot-pot-coin"][data-value="${coin}"]`);
const walletCoin = (win: Locator, characterId: string, coin: string) =>
  win.locator(
    `[data-testid="loot-wallet"][data-record-id="${characterId}"] [data-testid="loot-wallet-coin"][data-value="${coin}"]`,
  );

async function pick(page: Page, win: Locator, select: string, value: string) {
  await win.getByTestId(select).click();
  await page.locator(`[data-testid="loot-move-option"][data-value="${value}"]`).click();
}

test("FR-LOOT-03 FR-LOOT-13 FR-LOOT-15 FR-LOOT-18 DM adds 50 gp → player-1 row, toast, pot; player takes 10 gp → DM sees Mira +10 gp", async ({
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

  // P3 glitch 12: one name: the launcher says what the window says.
  for (const page of [dm, player]) {
    await expect(launcherButton(page, "loot.log")).toHaveAttribute("aria-label", "Party loot");
  }
  const dmWin = await openWindow(dm, "loot.log");
  const pWin = await openWindow(player, "loot.log");
  await expect(dmWin.getByTestId("ui-window-title")).toHaveText("Party loot");
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
  const move = (await openWindow(dm, "loot.log")).getByTestId("loot-move");
  await expect(move.getByTestId("loot-move-empty")).toHaveText(
    "No characters to move coin to/from",
  );
  await expect(move.getByTestId("loot-move-from")).toHaveCount(0);
  await expect(move.getByTestId("loot-move-submit")).toBeDisabled();
  await switchTo("Fixture Campaign");
  await dm.context().close();
});
