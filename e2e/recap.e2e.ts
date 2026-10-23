// e2e-bundle: sp-s9-e2e
// Thin SP3 flow (session-recap §13, FR-RECAP-10, -21, -24, -28): the DM's Ctrl+K "recap" Enter
// opens the Recap on the fixture session; Share with a note and Notable rolls unticked → player-1's
// Recap opens by itself ≤ 2 s with the note and no Notable rolls. Numbers, visibility and the
// memo: bun test.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";

const NOTE = "Cleared the Bandit Camp";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const section = (page: Page, key: string) =>
  page.locator(`[data-testid="recap-section"][data-record-id="${key}"]`);

test("FR-RECAP-28 FR-RECAP-24 FR-RECAP-21 DM opens Recap from the palette and shares it with a note; player-1's Recap opens with the note ≤ 2 s", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await expect(p1.getByTestId("recap-window")).toHaveCount(0);

  // Ctrl+K "recap" Enter → the Recap on the newest (fixture) session.
  await dm.getByTestId("map-canvas").focus();
  await dm.keyboard.press("Control+k");
  await expect(dm.getByTestId("ui-palette")).toBeVisible();
  await dm.keyboard.type("recap");
  await expect(
    dm.locator('[data-testid="ui-palette-item"][data-record-id="recap.open"]'),
  ).toBeVisible();
  await dm.keyboard.press("Enter");
  const recap = dm.getByTestId("recap-window");
  await expect(recap).toHaveAttribute("data-state", "ok");
  await expect(dm.locator('[data-testid="recap-fight"]').first()).toBeVisible();
  await expect(section(dm, "rolls")).toHaveAttribute("data-state", "shown");

  // Share: a note, Notable rolls unticked.
  await dm.getByTestId("recap-share").click();
  const dialog = dm.getByTestId("recap-share-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("recap-share-note").fill(NOTE);
  await dialog.locator('[data-testid="recap-share-omit"][data-value="rolls"]').click();
  await dialog.getByTestId("recap-share-send").click();
  await expect(dialog).toHaveCount(0);
  // The DM's own client keeps every section; the one players don't see is marked.
  await expect(section(dm, "rolls")).toHaveAttribute("data-state", "hidden-from-players");

  // Player 1: the Recap opens by itself on that session with the note, no Notable rolls.
  const theirs = p1.getByTestId("recap-window");
  await expect(theirs).toBeVisible({ timeout: 2_000 });
  await expect(p1.getByTestId("recap-note")).toHaveText(NOTE);
  await expect(section(p1, "rolls")).toHaveCount(0);
  await expect(p1.getByTestId("recap-share")).toHaveCount(0);
  await expect(p1.locator('[data-testid="recap-fight"]').first()).toContainText("Fight 1 · ");
});
