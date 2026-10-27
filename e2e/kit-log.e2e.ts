// e2e-bundle: kit-log
// Thin kit-parity K1 flow (§6.4, FR-KIT-40–45): the DM's Game log rows at 1440×900 are one
// 40-px line each: medallion, "Name · action", time, a result box by outcome, the physical chip.
// A roll from the bar lands as such a row; hovering a row's text opens the full line with its
// dice. Player-1 sees Mira's rows, never the DM's hidden roll. Pure parts, copy, re-pin: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { entryDice, entryLine } from "./support/log";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const row = (log: Locator, text: string) =>
  log.getByTestId("dice-log-entry").filter({ hasText: text }).last();

test("FR-KIT-40 FR-KIT-41 FR-KIT-43 FR-KIT-44 FR-KIT-45 kit log rows: medallion, time, boxed result; hover shows the dice", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const log = await openWindow(dm, "dice.log");

  // Mira's Longbow attack (player-1, physical natural 20): a crit box of 29.
  const attack = row(log, "Longbow attack");
  await expect(attack.getByTestId("dice-log-entry-text")).toHaveText("Mira · Longbow attack");
  await expect(attack.getByTestId("kit-medallion")).toHaveText("M");
  await expect(attack.getByTestId("kit-medallion")).toHaveAttribute("style", /background-color/);
  const crit = attack.getByTestId("dice-log-entry-total");
  await expect(crit).toHaveText("29");
  await expect(crit).toHaveAttribute("data-outcome", "crit");
  await expect(attack.getByTestId("dice-log-entry-time")).toBeVisible();
  await expect(attack.getByTestId("dice-log-entry-time")).toHaveText(/^\d\d:\d\d$/);
  await expect(attack.getByTestId("dice-log-entry-manual")).toBeVisible();
  expect(Math.round((await attack.boundingBox())?.height ?? 0)).toBe(40);
  await expect(row(log, "Longbow damage").getByTestId("dice-log-entry-total")).toHaveAttribute(
    "data-outcome",
    "damage",
  );
  await expect(row(log, "Healing Word").getByTestId("dice-log-entry-total")).toHaveAttribute(
    "data-outcome",
    "heal",
  );

  // FR-KIT-45: the full line with its dice is the row's Tooltip.
  const line = await entryLine(attack);
  await expect(line).toContainText("Mira — Longbow attack: 20 + 9 = 29 — natural 20!");
  await expect(line.getByTestId("dice-log-die")).toHaveAttribute("data-value", "20");

  // A roll from the bar lands as a row: the DM's medallion, the expression, a plain box.
  await log.getByTestId("dice-roll-expression").fill("2d6+3");
  await log.getByTestId("dice-roll-expression").press("Enter");
  const mine = row(log, "2d6+3");
  await expect(mine).toHaveAttribute("data-landed", "true", { timeout: 10_000 });
  await expect(mine.getByTestId("dice-log-entry-text")).toHaveText("DM · 2d6+3");
  await expect(mine.getByTestId("kit-medallion")).toHaveText("D");
  const box = mine.getByTestId("dice-log-entry-total");
  await expect(box).toHaveAttribute("data-outcome", "plain");
  const total = Number(await box.textContent());
  expect(total).toBeGreaterThanOrEqual(5);
  expect(total).toBeLessThanOrEqual(15);
  await expect(await entryDice(mine)).toHaveCount(2);

  // K12 (round-2 gap 1): the time and the boxes keep one column down the list, rows with and
  // without the "physical" chip alike (the bar's roll has none; Mira's attack has one).
  expect(await mine.getByTestId("dice-log-entry-manual").count()).toBe(0);
  const edges = async (r: Locator) => ({
    time: Math.round((await r.getByTestId("dice-log-entry-time").boundingBox())?.x ?? -1),
    box: Math.round((await r.getByTestId("dice-log-entry-total").last().boundingBox())?.x ?? -1),
  });
  expect(await edges(mine)).toEqual(await edges(attack));

  // Player-1: Mira's rows, the DM's hidden roll never.
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p1Log = await openWindow(p1, "dice.log");
  await expect(row(p1Log, "Longbow attack").getByTestId("dice-log-entry-total")).toHaveText("29");
  await expect(p1Log).not.toContainText("DM-SECRET-ROLL");
  await expect(p1Log.getByTestId("dice-log-entry-hidden")).toHaveCount(0);

  for (const page of [p1, dm]) await page.context().close();
});
