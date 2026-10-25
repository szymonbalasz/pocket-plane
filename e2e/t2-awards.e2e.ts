// e2e-bundle: t2-awards-e2e
// Sprint 10 T2 (BL-111, FR-STATS-12): on `stats`, Mira's late 11 on the hidden Goblin 2 is a
// DM-only line, so the session holds party damage players don't see. The DM's Session tab and
// Recap show 9 awards with "Most damage dealt" (Thorn 73); player 2's show no "Most damage dealt"
// card. Sprint 12 (BL-121): nor any other card a hidden line could change (the hidden Elite's 9 on
// Thorn, the DM's hidden nat 20 as Thorn): player 2 gets Most healing (Brakka 8) only. Rules, MVP
// and leak scans: bun test.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-STATS-12 BL-111 BL-121 players' Session tab and Recap leave out every award a hidden line could change; the DM keeps all", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);

  for (const [page, cards] of [
    [dm, 9],
    [p2, 1],
  ] as const) {
    const stats = await openWindow(page, "stats.board");
    await stats.locator('[data-testid="stats-tab"][data-value="session"]').click();
    await expect(stats.getByTestId("stats-award")).toHaveCount(cards);
    const dealt = stats.locator('[data-testid="stats-award"][data-record-id="most-dealt"]');
    if (page === dm) {
      await expect(dealt.getByTestId("stats-award-value")).toHaveText("73 damage");
      await expect(dealt.getByTestId("stats-award-winner")).toHaveText("Thorn");
    } else {
      await expect(dealt).toHaveCount(0);
      await expect(stats).not.toContainText("Most damage dealt");
      const healing = stats.locator('[data-testid="stats-award"][data-record-id="most-healing"]');
      await expect(healing.getByTestId("stats-award-winner")).toHaveText("Brakka");
    }
    // FR-STATS-79: the Recap's Awards follow the same rule.
    await stats.getByTestId("stats-session-recap").click();
    const recap = shellWindow(page, "recap.session");
    await expect(recap.getByTestId("recap-window")).toHaveAttribute("data-state", "ok");
    await expect(recap.getByTestId("recap-award")).toHaveCount(cards);
    await expect(
      recap.locator('[data-testid="recap-award"][data-record-id="most-dealt"]'),
    ).toHaveCount(page === dm ? 1 : 0);
  }

  for (const page of [p2, dm]) await page.context().close();
});
