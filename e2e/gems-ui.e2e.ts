// e2e-bundle: gems-ui-e2e
// Gems UI (GM3; GEM §13 walkthrough 2, 3, 9, 10, 12): DM, player-1 (Mira, Brakka), player-2
// (Thorn). Gems start off with counts kept: no block, summary counts or party counts anywhere.
// The DM turns gems on in Campaign options → blocks, counts and the "max 5" label everywhere
// (Brakka's Fortune 6 plain). DM + Inspiration on Mira; player-1 spends Fortune (confirm), cancels
// a recall, spends Brakka's Action (2); player-2 sees counts only. Off asks once (Cancel keeps it
// on); Turn off → every gem surface goes without a reload. Rules, leaks: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const by = (scope: Page | Locator, testId: string, value: string) =>
  scope.locator(`[data-testid="${testId}"][data-value="${value}"]`);
const chip = (scope: Locator, gem: string) => by(scope, "gem-count", gem);
const summary = (scope: Locator, gem: string) => by(scope, "gem-summary-count", gem);
const line = (log: Locator, text: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });

async function sheetOn(page: Page, characterId: string): Promise<Locator> {
  const sheet = await openWindow(page, "char.sheet");
  await pickSheet(sheet, characterId);
  return sheet;
}

/** Picks a Spend menu item and confirms (FR-GEM-17). */
async function spend(page: Page, block: Locator, value: string, confirm = true) {
  await block.getByTestId("gem-spend-menu").click();
  await by(page, "gem-spend", value).click();
  await expect(block.getByTestId("gem-spend-ask")).toHaveAttribute("data-value", value);
  await block.getByTestId(confirm ? "gem-spend-confirm" : "gem-spend-cancel").click();
  await expect(block.getByTestId("gem-spend-menu")).toBeVisible();
}

test("FR-CAMP-42 FR-CAMP-43 FR-CHARX-71 FR-CHARX-72 FR-CHARX-73 FR-GEM-08 FR-GEM-17 FR-GEM-36 Campaign options on → blocks and counts everywhere; award, spends with confirm; off asks once and hides every gem surface live", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("char-mira", "entity");
  const brakka = recordId("char-brakka", "entity");

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1600, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  // session-sim-9 presents the "Thieves' Map" handout to player-1 at load.
  await p1.getByTestId("party-present-close").click();
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  // Off: nothing of gems anywhere (counts kept on the server).
  const panel = await openWindow(dm, "camp.players");
  await expect(panel.getByTestId("camp-player-char").first()).toBeVisible();
  await expect(panel.getByTestId("camp-player-char-gems")).toHaveCount(0);
  const p1Sheet = await sheetOn(p1, mira);
  const p2Sheet = await sheetOn(p2, mira);
  await expect(p2Sheet.getByTestId("charx-summary")).toBeVisible();
  for (const s of [p1Sheet, p2Sheet]) {
    await expect(s.getByTestId("gem-block")).toHaveCount(0);
    await expect(s.getByTestId("gem-summary-count")).toHaveCount(0);
  }

  // DM: Options → gems on (no confirm on the way on).
  await panel.getByTestId("camp-options-open").click();
  const options = dm.getByTestId("camp-options");
  const row = by(options, "camp-feature", "gems");
  await expect(row).toHaveAttribute("data-state", "off");
  await expect(row).toContainText("Gems (homebrew)");
  await row.getByTestId("camp-feature-switch").click();
  await expect(row).toHaveAttribute("data-state", "on");
  // The switch's resync keeps the open Dialog (FR-CAMP-40).
  await expect(options).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(options).toHaveCount(0);

  // Party lines: the kept counts; Brakka's Fortune 6 shown plainly.
  const brakkaLine = panel.locator(
    `[data-testid="camp-player-char-gems"][data-record-id="${brakka}"]`,
  );
  await expect(summary(brakkaLine, "fortune")).toHaveAttribute("data-count", "6");
  await expect(summary(brakkaLine, "action")).toHaveAttribute("data-count", "3");

  // Player-1's own sheet: five chips, "max 5", Spend; player-2: summary counts, no controls.
  const block1 = p1Sheet.getByTestId("gem-block");
  await expect(block1.getByTestId("gem-count")).toHaveCount(5);
  await expect(chip(block1, "inspiration")).toHaveAttribute("data-count", "2");
  await expect(block1.getByTestId("gem-max-label")).toHaveText("max 5");
  await expect(block1.getByTestId("gem-spend-menu")).toBeEnabled();
  await expect(summary(p2Sheet, "inspiration")).toHaveAttribute("data-count", "2");
  await expect(p2Sheet.getByTestId("gem-spend-menu")).toHaveCount(0);
  await expect(p2Sheet.getByTestId("gem-block")).toHaveCount(0);

  // DM: Mira's chip Popover → + Inspiration; counts follow everywhere.
  const dmSheet = await sheetOn(dm, mira);
  const dmBlock = dmSheet.getByTestId("gem-block");
  await chip(dmBlock, "inspiration").click();
  await by(dm, "gem-award", "inspiration").click();
  await expect(chip(dmBlock, "inspiration")).toHaveAttribute("data-count", "3");
  await dm.keyboard.press("Escape");
  await expect(chip(block1, "inspiration")).toHaveAttribute("data-count", "3");
  await expect(summary(p2Sheet, "inspiration")).toHaveAttribute("data-count", "3");

  // Player-1 spends Mira's Fortune (confirm) → 0, the line for everyone; a cancelled recall
  // changes nothing.
  const p1Log = await openWindow(p1, "dice.log");
  await spend(p1, block1, "fortune");
  await expect(chip(block1, "fortune")).toHaveAttribute("data-count", "0");
  await expect(summary(p2Sheet, "fortune")).toHaveAttribute("data-count", "0");
  await expect(line(p1Log, "Mira spends a Fortune gem — searching for treasure")).toHaveCount(1);
  await spend(p1, block1, "inspiration", false);
  await expect(chip(block1, "inspiration")).toHaveAttribute("data-count", "3");
  // No Fortune left → the menu item is disabled.
  await block1.getByTestId("gem-spend-menu").click();
  await expect(by(p1, "gem-spend", "fortune")).toHaveAttribute("data-disabled", "");
  await p1.keyboard.press("Escape");

  // Brakka: Action (2) → 3 → 1.
  const brakkaSheet = await sheetOn(p1, brakka);
  const blockB = brakkaSheet.getByTestId("gem-block");
  await expect(chip(blockB, "fortune")).toHaveAttribute("data-count", "6");
  await spend(p1, blockB, "action:action");
  await expect(chip(blockB, "action")).toHaveAttribute("data-count", "1");
  await expect(line(p1Log, "Brakka spends 2 Action gems — a full action")).toHaveCount(1);
  await expect(summary(brakkaLine, "action")).toHaveAttribute("data-count", "1");

  // DM: off asks once; Cancel keeps gems on; Turn off hides every gem surface live.
  await panel.getByTestId("camp-options-open").click();
  await row.getByTestId("camp-feature-switch").click();
  await expect(row).toContainText("Hide gems? Counts are kept");
  await row.getByTestId("camp-feature-cancel").click();
  await expect(row).toHaveAttribute("data-state", "on");
  await row.getByTestId("camp-feature-switch").click();
  await row.getByTestId("camp-feature-confirm").click();
  await expect(row).toHaveAttribute("data-state", "off");
  await dm.keyboard.press("Escape");
  await expect(panel.getByTestId("camp-player-char-gems")).toHaveCount(0);
  await expect(dmSheet.getByTestId("gem-block")).toHaveCount(0);
  await expect(brakkaSheet.getByTestId("gem-block")).toHaveCount(0);
  await expect(p2Sheet.getByTestId("gem-summary-count")).toHaveCount(0);
  await expect(line(p1Log, "spends")).toHaveCount(0);
});
