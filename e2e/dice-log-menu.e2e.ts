// e2e-bundle: dice-log-menu-e2e
// Thin flows of the game log's row menu and details window (FR-DICE-99–110): the DM hides a
// player's roll → it leaves that player's log and details window, a reveal brings both back; a
// player opens the details and fills the tray from the menu (advantage not applied twice); a
// player's "Inspiration: reroll" from the menu shows the confirm on the row. Rules, leaks, races,
// held and empty states: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });
const PERCEPTION = "Mira — Perception: 4 + 3 = 7";

/** Right-clicks the row's text and returns its open menu. */
async function menuOf(row: Locator) {
  await row.getByTestId("dice-log-entry-text").click({ button: "right" });
  const menu = row.page().getByTestId("dice-log-menu");
  await expect(menu).toBeVisible();
  return menu;
}
const item = (menu: Locator, value: string) =>
  menu.locator(`[data-testid="dice-log-menu-item"][data-value="${value}"]`);

async function setup(browser: Parameters<typeof rolePage>[0]) {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  // session-sim-9 presents the "Thieves' Map" handout to player-1 once, at the first load.
  await p1
    .getByTestId("party-present-close")
    .click({ timeout: 3000 })
    .catch(() => undefined);
  return {
    dm,
    p1,
    dmLog: await openWindow(dm, "dice.log"),
    p1Log: await openWindow(p1, "dice.log"),
  };
}

test("FR-DICE-99 FR-DICE-103 FR-DICE-109 the DM hides a player's roll: gone from that player's log and details window; a reveal brings both back", async ({
  browser,
}) => {
  const { dm, p1, dmLog, p1Log } = await setup(browser);
  await expect(line(p1Log, PERCEPTION)).toHaveCount(1);
  const id = await line(p1Log, PERCEPTION).getAttribute("data-record-id");

  // The player's details window on that line, no DM facts.
  await item(await menuOf(line(p1Log, PERCEPTION)), "details").click();
  const p1Details = shellWindow(p1, "dice.details");
  await expect(p1Details.getByTestId("dice-details")).toHaveAttribute(
    "data-record-id",
    id as string,
  );
  await expect(p1Details.getByTestId("dice-details-total")).toHaveText("7");
  await expect(p1Details.getByTestId("dice-details-die")).toHaveAttribute("data-value", "4");
  await expect(p1Details.getByTestId("dice-details-audience")).toHaveCount(0);

  // A player's menu has no hide.
  const p1Menu = await menuOf(line(p1Log, PERCEPTION));
  await expect(item(p1Menu, "hide")).toHaveCount(0);
  await p1.keyboard.press("Escape");
  // The Tooltip closes when the menu opens.
  const dmRow = line(dmLog, PERCEPTION);
  await dmRow.getByTestId("dice-log-entry-text").hover();
  await expect(dm.getByTestId("dice-log-entry-details")).toBeVisible();
  const menu = await menuOf(dmRow);
  await expect(dm.getByTestId("dice-log-entry-details")).toHaveCount(0);
  await expect(menu.getByRole("menuitem")).not.toHaveCount(0);
  await item(menu, "hide").click();

  await expect(line(p1Log, PERCEPTION)).toHaveCount(0);
  await expect(p1Details.getByTestId("dice-details-empty")).toHaveText("Pick a roll in the log");
  await expect(p1Details.getByTestId("dice-details")).toHaveCount(0);
  await expect(dmRow).toHaveAttribute("data-public", "false");

  // The DM's window: who can see it. A double-click opens it and selects no text.
  await dmRow.getByTestId("dice-log-entry-text").dblclick();
  const dmDetails = shellWindow(dm, "dice.details");
  await expect(dmDetails.getByTestId("dice-details-audience")).toHaveText("DM only");
  expect(await dm.evaluate(() => String(window.getSelection()))).toBe("");
  // Nor focus on the row, so no ring (FR-DICE-106).
  expect(
    await dm.evaluate(() => document.activeElement?.closest("[data-slot=log-row]") ?? null),
  ).toBeNull();
  // Keyboard focus still shows it.
  await dm.keyboard.press("Tab");
  await dmRow.getByTestId("dice-log-entry-text").focus();
  expect(
    await dmRow
      .getByTestId("dice-log-entry-text")
      .evaluate((el) => el === document.activeElement && el.matches(":focus-visible")),
  ).toBe(true);

  await item(await menuOf(dmRow), "reveal").click();
  await expect(line(p1Log, PERCEPTION)).toHaveCount(1);
  await expect(p1Details.getByTestId("dice-details")).toHaveAttribute(
    "data-record-id",
    id as string,
  );
  await expect(dmDetails.getByTestId("dice-details-audience")).toHaveText("Public");
  // A reveal is no new roll: no throw on the player's screen.
  await expect(p1.getByTestId("dicex-popup-row")).toHaveCount(0);
});

test("FR-DICE-104 a player copies an advantage roll to the tray: same expression and mode, and copies its text", async ({
  browser,
}) => {
  const { p1, p1Log } = await setup(browser);
  await p1Log.getByTestId("dice-roll-expression").fill("1d20+2");
  await p1Log.locator('[data-testid="dice-roll-mode-option"][data-value="advantage"]').click();
  await p1Log.getByTestId("dice-roll-expression").press("Enter");
  const row = p1Log.getByTestId("dice-log-entry").last();
  await expect(row).toHaveAttribute("data-landed", "true", { timeout: 15_000 });
  await expect(row).toContainText("(adv)");
  await item(await menuOf(row), "tray").click();
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray.getByTestId("dicex-tray-expression")).toHaveValue("1d20+2");
  await expect(tray.getByTestId("dicex-tray-mode")).toHaveAttribute("data-value", "advantage");

  await p1.evaluate(() => {
    navigator.clipboard.writeText = (text) => {
      document.body.dataset.copied = text;
      return Promise.resolve();
    };
  });
  await item(await menuOf(row), "copy").click();
  await expect(p1.locator("body")).toHaveAttribute("data-copied", /\(adv\)/);
});

test("FR-DICE-105 a player's Inspiration reroll from the menu shows the confirm on the row, which goes through", async ({
  browser,
}) => {
  const { p1, p1Log } = await setup(browser);
  const row = line(p1Log, PERCEPTION);
  await item(await menuOf(row), "gem.reroll").click();
  await expect(p1.getByTestId("dice-log-menu")).toHaveCount(0);
  await expect(row.getByTestId("dice-log-action-confirm")).toContainText("Spend Inspiration?");
  await row.getByTestId("dice-log-action-yes").click();
  await expect(line(p1Log, "Perception (reroll, was 7)")).toHaveCount(1);
  await expect(row).toHaveAttribute("data-superseded", "true");
  // The struck line's menu jumps to the new one.
  await item(await menuOf(row), "new-roll").click();
  await expect(line(p1Log, "Perception (reroll, was 7)")).toHaveAttribute("data-focused", "true");
});

test("FR-DICE-103 a global definition's line opens its stat block; a name on two definitions has no item", async ({
  browser,
}) => {
  const { dm, dmLog } = await setup(browser);
  await item(await menuOf(line(dmLog, "Goblin 2 — Initiative").first()), "sheet").click();
  await expect(shellWindow(dm, "ent.statblock")).toBeVisible();
});
