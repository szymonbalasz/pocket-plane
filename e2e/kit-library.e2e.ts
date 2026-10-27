// e2e-bundle: kit-library
// Thin kit-parity K4 flow (§6.8–6.9): the DM's compendium is a table (sticky Name · Details ·
// Source head, 40-px rows) and the Goblin opens as the kit card (one ruled AC · HP · Speed row, a
// six-column ability grid); Party status shows kit cards (medallion, level line, AC shield, HP
// bar) with the pet under Mira; player-1's sheet header has the square 56-px portrait. Markup,
// visibility and every FR detail: bun test (compendium, party-board, entities, character-sheet).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-KIT-76 FR-KIT-77 FR-KIT-82 FR-KIT-83 FR-KIT-85 kit library: compendium table + stat block card, party cards, sheet header", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  // FR-KIT-76: the table head over one-line rows; the Goblin row's details beside its name.
  const cmp = await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-search").fill("goblin");
  await expect(cmp.getByTestId("cmp-table-head")).toHaveText("NameDetailsSource");
  const goblin = cmp
    .getByTestId("cmp-result")
    .filter({ has: dm.getByTestId("cmp-result-name").getByText("Goblin", { exact: true }) })
    .first();
  await expect(goblin).toContainText("CR 1/4");
  const h = Math.round((await goblin.boundingBox())?.height ?? 0);
  expect(h).toBeGreaterThanOrEqual(40);
  expect(h).toBeLessThanOrEqual(44);

  // FR-KIT-77: the card's ruled core row and the ability grid.
  await goblin.click();
  const core = cmp.getByTestId("cmp-statblock-core");
  await expect(core).toContainText("AC 15");
  await expect(core).toContainText("HP 7 (2d6)");
  await expect(core).toContainText("Speed");
  await expect(cmp.getByTestId("cmp-statblock-score")).toHaveCount(6);
  await expect(cmp.locator('[data-testid="cmp-statblock-score"][data-value="dex"]')).toHaveText(
    "DEX14+2",
  );
  // Evidence for the walkthrough (a fresh browser is Gilt & Stone, DM #355).
  await cmp.screenshot({ path: test.info().outputPath("app-statblock-gilt.png") });
  await cmp.getByTestId("cmp-back").click();
  await expect(cmp.getByTestId("cmp-table-head")).toBeVisible();
  await cmp.screenshot({ path: test.info().outputPath("app-compendium-gilt.png") });
  await cmp.getByTestId("ui-window-close").click();

  // FR-KIT-82 / -83: Mira's card and her pet's small medallion.
  const board = await openWindow(dm, "party.board");
  const mira = board.getByTestId("party-summary-row").filter({ hasText: "Mira" });
  await expect(mira.getByTestId("party-summary-medallion")).toHaveText("M");
  await expect(mira.getByTestId("party-summary-line")).toHaveText(/^Level \d+/);
  await expect(mira.getByTestId("party-summary-ac")).toHaveAttribute("aria-label", /^Armor Class/);
  await expect(mira.getByTestId("party-summary-hp").getByTestId("kit-hpbar")).toBeVisible();
  const owl = board.getByTestId("party-companion-row").filter({ hasText: "Owlbear" });
  await expect(owl.getByTestId("party-companion-medallion")).toHaveText("O");
  await board.screenshot({ path: test.info().outputPath("app-party-gilt.png") });

  // FR-KIT-85: player-1's sheet header, the square framed portrait at 56 px.
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const sheet = await openWindow(p1, "char.sheet");
  await expect(sheet.getByTestId("char-sheet-name")).toHaveText("Mira");
  const box = await sheet.getByTestId("char-sheet-portrait").boundingBox();
  expect([Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)]).toEqual([56, 56]);
  await expect(sheet.getByTestId("charx-edit-toggle")).toBeVisible();
  await sheet.screenshot({ path: test.info().outputPath("app-sheet-gilt.png") });

  for (const page of [p1, dm]) await page.context().close();
});
