// e2e-bundle: dice-log
// N1 minimise = parked (SHELL §13 steps 17-18, FR-SHELL-36–38, FR-DICE-33), player-1 (B) and
// player-2 (C): a minimised Game log keeps its scroll position and roll-bar draft; its launcher
// button shows a hollow ring and, after C's roll, the "new" dot; restore clears the dot; close →
// reopen is a fresh mount at the same geometry, and a closed window never shows the dot.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { launcherButton, shellWindow } from "./support/shell";

async function roll(log: Locator, expr: string) {
  const entries = log.getByTestId("dice-log-entry");
  const before = await entries.count();
  await log.getByTestId("dice-roll-expression").fill(expr);
  await log.getByTestId("dice-roll-expression").press("Enter");
  await expect(entries).toHaveCount(before + 1);
}

const list = (log: Locator) => log.getByTestId("dice-log-list");
const scrollTopOf = (log: Locator) => list(log).evaluate((el) => Math.round(el.scrollTop));

async function box(log: Locator) {
  const b = await log.boundingBox();
  if (!b) throw new Error("window not visible");
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

async function joined(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

test("FR-SHELL-36/37/38 minimised Game log: state kept, ring, activity dot; close = fresh", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const b = await rolePage(browser);
  const c = await rolePage(browser);
  await joined(b, link("Player 1"));
  await joined(c, link("Player 2"));
  const log = shellWindow(b, "dice.log");
  const btn = launcherButton(b, "dice.log");
  const dot = btn.getByTestId("ui-launcher-activity");
  await expect(log).toBeVisible();
  await expect(btn).toHaveAttribute("data-state", "open");
  await expect(btn.locator('[data-marker="open"]')).toHaveCount(1);
  const geometry = await box(log);

  // Step 17: enough history to scroll; scroll up to the middle; a draft in the roll bar.
  for (let i = 0; i < 10; i++) await roll(log, "1d4");
  const middle = await list(log).evaluate((el) => {
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    el.dispatchEvent(new Event("scroll"));
    return Math.round(el.scrollTop);
  });
  expect(middle).toBeGreaterThan(0);
  await log.getByTestId("dice-roll-expression").fill("1d6");

  await log.getByTestId("ui-window-minimise").click();
  await expect(btn).toHaveAttribute("data-state", "minimised");
  await expect(log).toHaveAttribute("data-state", "minimised");
  await expect(log).toBeHidden(); // parked: mounted, not shown
  await expect(btn.locator('[data-marker="minimised"]')).toHaveCount(1);
  await expect(btn.locator('[data-marker="open"]')).toHaveCount(0);
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.hover();
  await expect(b.getByTestId("ui-tooltip")).toContainText("Log (minimised — click to restore)");
  await expect(dot).toHaveCount(0);

  await btn.click(); // restore
  await expect(log).toBeVisible();
  await expect(btn).toHaveAttribute("data-state", "open");
  expect(await scrollTopOf(log)).toBe(middle);
  await expect(log.getByTestId("dice-roll-expression")).toHaveValue("1d6");

  // Step 18: minimised + a roll B can see → dot; restore clears it.
  await log.getByTestId("ui-window-minimise").click();
  await expect(btn).toHaveAttribute("data-state", "minimised");
  await roll(shellWindow(c, "dice.log"), "1d4"); // player rolls are always public
  await expect(dot).toBeVisible();
  await btn.click();
  await expect(log).toBeVisible();
  await expect(dot).toHaveCount(0);

  // Close → reopen: fresh mount (no draft, list at the bottom), geometry kept.
  await log.getByTestId("ui-window-close").click();
  await expect(btn).toHaveAttribute("data-state", "closed");
  await expect(log).toHaveCount(0);
  await roll(shellWindow(c, "dice.log"), "1d4");
  await expect(dot).toHaveCount(0); // a closed window never shows the dot
  await btn.click();
  await expect(log).toBeVisible();
  await expect(log.getByTestId("dice-roll-expression")).toHaveValue("");
  await expect
    .poll(() =>
      list(log).evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)),
    )
    .toBeLessThanOrEqual(1);
  expect(await box(log)).toEqual(geometry);

  await b.context().close();
  await c.context().close();
});
