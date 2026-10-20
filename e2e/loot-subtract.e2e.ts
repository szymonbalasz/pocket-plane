// e2e-bundle: loot-subtract-e2e
// Thin Subtract flow (LOOT FR-LOOT-25–27; play-shell §13 PF P13): the DM types −5 in gp → the
// add form reads "Subtract" / "Subtract from the pot"; 0, empty, "-" and text alone → disabled;
// submit → the pot −5 gp and no loot toast for player-1; 3 gp → "Add" again.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function openLoot(page: Page): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="loot"]').click();
  await board.getByTestId("loot-log").waitFor({ state: "visible" });
  return board;
}

const potGp = async (win: Locator) =>
  Number.parseInt(
    (await win
      .locator('[data-testid="loot-pot"] [data-testid="loot-pot-coin"][data-value="gp"]')
      .innerText()) || "0",
    10,
  );

test("FR-LOOT-25/26/27 negative gp reads Subtract; 0 / empty / '-' / text alone disabled; submit spends from the pot with no player toast", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  const dmWin = await openLoot(dm);
  await openLoot(player);

  const add = dmWin.getByTestId("loot-add");
  const text = add.getByTestId("loot-add-text");
  const gp = add.locator('[data-testid="loot-add-coin"][data-value="gp"]');
  const submit = add.getByTestId("loot-add-submit");
  const title = add.getByTestId("loot-add-title");
  await expect(add.getByTestId("loot-add-hint")).toHaveText("Enter a negative amount to subtract.");
  await expect(submit).toBeDisabled(); // empty

  await gp.fill("-5");
  await expect(submit).toHaveText("Subtract");
  await expect(submit).toHaveAttribute("data-mode", "subtract");
  await expect(title).toHaveText("Subtract from the pot");
  await expect(submit).toBeEnabled();
  for (const v of ["0", "", "-"]) {
    await gp.fill(v);
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("data-mode", "add");
  }
  await text.fill("Rope");
  await expect(submit).toBeDisabled(); // text alone: coins decide (OQ-LOOT-19 A)
  await gp.fill("3");
  await expect(submit).toHaveText("Add");
  await expect(title).toHaveText("Add loot");
  await expect(submit).toBeEnabled();

  // Spend 5 gp: the pot drops by 5; players get no loot toast (FR-LOOT-13).
  const before = await potGp(dmWin);
  await text.fill("");
  await gp.fill("-5");
  await submit.click();
  await expect(gp).toHaveValue("");
  await expect.poll(() => potGp(dmWin)).toBe(before - 5);
  await expect(player.getByTestId("note-toast")).toHaveCount(0);
});
