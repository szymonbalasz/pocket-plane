// e2e-bundle: stats-window-e2e
// Thin Stats window flow (ST2: FR-STATS-17, -18, -19, -20, -22; FR-SHELL-93, -94; FR-NOTE-48):
// DM, player-1 and player-2 on the `stats` bundle's Goblin Ambush. The DM and player-2 open Stats
// (Fight tab); the DM's 40 From Thorn on the 7 HP Goblin Scout 2 updates both tables within 2 s
// and toasts "Overkill!" (the DM's with the amount, player-2's without). Then the DM's Show awards
// on today's session opens player-1's Stats on the Session tab: Biggest hit = Thorn's 40.
// Numbers and visibility rules: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const initRow = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);
const statsRow = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="stats-fight-row"][data-record-id="${id}"]`);
const dealt = async (scope: Locator, id: string) =>
  Number(await statsRow(scope, id).getByTestId("stats-fight-dealt").innerText());

/** The DM's Damage / heal dialog on a row: amount, From, then Damage. */
async function damageFrom(dm: Page, init: Locator, target: string, amount: number, from: string) {
  await initRow(init, target).scrollIntoViewIfNeeded();
  await initRow(init, target).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbt-init-row-hp-adjust").click();
  const dialog = dm.getByTestId("cbt-hp");
  await dialog.getByTestId("cbt-hp-amount").fill(String(amount));
  await dialog.getByTestId("cbt-hp-from").click();
  await dm.locator(`[data-testid="cbt-hp-from-option"][data-record-id="${from}"]`).click();
  await dialog.getByTestId("cbt-hp-damage").click();
  await expect(dialog).toHaveCount(0);
}

test("FR-STATS-18 FR-STATS-17 FR-STATS-22 FR-STATS-20 FR-SHELL-94 an overkill updates both Fight tabs ≤ 2 s and toasts player-2; Show awards opens player-1's Stats", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const thorn = recordId("combat-1", "combatant", 1);
  const scout2 = recordId("st-ambush-facts", "combatant", 1);

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);

  // FR-SHELL-93 / FR-STATS-18: the launcher opens Stats on the Fight tab, the running Ambush.
  const dmStats = await openWindow(dm, "stats.board");
  const p2Stats = await openWindow(p2, "stats.board");
  await expect(statsRow(dmStats, thorn)).toHaveCount(1);
  await expect(statsRow(p2Stats, thorn)).toHaveCount(1);
  // DM-only parts: monster rows, the Effective column; players get party rows only.
  await expect(statsRow(dmStats, scout2)).toHaveCount(1);
  await expect(statsRow(p2Stats, scout2)).toHaveCount(0);
  await expect(dmStats.getByTestId("stats-fight-effective").first()).toBeVisible();
  await expect(p2Stats.getByTestId("stats-fight-effective")).toHaveCount(0);
  const dmBefore = await dealt(dmStats, thorn);
  const p2Before = await dealt(p2Stats, thorn);

  // FR-STATS-17 / -22: 40 on the 7 HP Goblin Scout 2 → overkill 33; both tables within 2 s.
  const init = await openWindow(dm, "cbt.initiative");
  await damageFrom(dm, init, scout2, 40, thorn);
  await expect(statsRow(dmStats, thorn).getByTestId("stats-fight-dealt")).toHaveText(
    String(dmBefore + 40),
    { timeout: 2000 },
  );
  await expect(statsRow(p2Stats, thorn).getByTestId("stats-fight-dealt")).toHaveText(
    String(p2Before + 40),
    { timeout: 2000 },
  );
  // Sprint 8 (FR-STATS-28): the kill feed took the overkill toast's place (FR-NOTE-69).
  const p2Toast = p2.getByTestId("stats-feed-toast");
  await expect(p2Toast).toHaveText("Overkill! Thorn finished Goblin Scout 2");
  await expect(dm.getByTestId("stats-feed-toast")).toHaveText(
    "Overkill! Thorn finished Goblin Scout 2, overkill 33",
  );
  // Player-1 hasn't opened Stats: the toast still comes (the window's companion).
  await expect(p1.getByTestId("stats-feed-toast")).toHaveCount(1);
  await expect(shellWindow(p1, "stats.board")).toBeHidden();

  // FR-STATS-19 / -20: the DM's Session tab defaults to today's session; Show awards.
  await dmStats.locator('[data-testid="stats-tab"][data-value="session"]').click();
  await expect(dmStats.getByTestId("stats-award")).toHaveCount(9);
  await dmStats.getByTestId("stats-show-awards").click();

  // FR-SHELL-94 / FR-NOTE-48: player-1's Stats opens on the Session tab, with a toast too.
  const p1Stats = shellWindow(p1, "stats.board");
  await expect(p1Stats).toBeVisible();
  await expect(p1Stats.getByTestId("stats-session")).toBeVisible();
  await expect(p1.getByTestId("note-toast").filter({ hasText: "Session awards:" })).toHaveCount(1);
  const hit = p1Stats.locator('[data-testid="stats-award"][data-record-id="biggest-hit"]');
  await expect(hit.getByTestId("stats-award-value")).toHaveText("40 damage");
  await expect(hit.getByTestId("stats-award-winner")).toHaveText("Thorn");
  await expect(p1Stats.getByTestId("stats-show-awards")).toHaveCount(0);

  for (const page of [p2, p1, dm]) await page.context().close();
});
