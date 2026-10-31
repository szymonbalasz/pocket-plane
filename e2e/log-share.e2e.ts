// e2e-bundle: log-share
// Thin flows of Send to game log (FR-SHARE-01, -02, -05, -07, -11): a player sends a sheet spell →
// the DM and the other player read its full text in their logs; the DM hides it → it leaves
// theirs; the DM sends an unshared homebrew entry only after the confirm. Rules, leaks and limits:
// bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const share = (log: Locator, title: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: `shares ${title}` });

async function setup(browser: Parameters<typeof rolePage>[0]) {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  return { dm, p1, p2 };
}

test("FR-SHARE-02 FR-SHARE-05 FR-SHARE-07 a player sends a sheet spell: everyone reads the full text; the DM's Hide takes it back", async ({
  browser,
}) => {
  const { dm, p1, p2 } = await setup(browser);
  const dmLog = await openWindow(dm, "dice.log");
  const p2Log = await openWindow(p2, "dice.log");
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const row = sheet.locator('[data-testid="charx-spell"]').filter({ hasText: "Fireball" }).first();
  await row.getByTestId("share-send").click();

  for (const log of [dmLog, p2Log]) {
    const line = share(log, "Fireball");
    await expect(line.getByTestId("share-entry-line")).toHaveText("Level 3 evocation");
    await expect(line.getByTestId("share-entry-body")).toContainText("Casting Time:");
    await expect(line.getByTestId("share-entry-body")).toContainText("bright streak");
    await expect(line.getByTestId("share-entry-body")).toContainText("Aim away from the party.");
    // FR-SHARE-12: the reader starts at the head, whatever the list's height.
    await expect(line.getByTestId("dice-log-entry-actor")).toBeInViewport({ ratio: 0.9 });
  }

  await share(dmLog, "Fireball").getByTestId("dice-log-entry-text").click({ button: "right" });
  await dm.locator('[data-testid="dice-log-menu-item"][data-value="hide"]').click();
  await expect(share(p2Log, "Fireball")).toHaveCount(0);
  await expect(share(dmLog, "Fireball")).toHaveCount(1);
});

test("FR-SHARE-01 FR-SHARE-11 the DM sends unshared homebrew only after the confirm; a shared entry goes at once", async ({
  browser,
}) => {
  const { dm, p2 } = await setup(browser);
  const p2Log = await openWindow(p2, "dice.log");
  const cmp = await openWindow(dm, "cmp.compendium");
  const search = cmp.getByTestId("cmp-search");

  const result = (name: string) => cmp.getByTestId("cmp-result").filter({ hasText: name }).first();
  await search.fill("CMP-SECRET-ITEM");
  await result("CMP-SECRET-ITEM").click();
  await cmp.getByTestId("share-send").click();
  const dialog = dm.getByTestId("share-confirm-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("share-confirm-cancel").click();
  await expect(share(p2Log, "CMP-SECRET-ITEM")).toHaveCount(0);

  await cmp.getByTestId("share-send").click();
  await dialog.getByTestId("share-confirm-send").click();
  await expect(share(p2Log, "CMP-SECRET-ITEM").getByTestId("share-entry-body")).toContainText(
    "the key to the vault",
  );

  await cmp.getByTestId("cmp-back").click();
  await search.fill("Moonblade Shard");
  await result("Moonblade Shard").click();
  await cmp.getByTestId("share-send").click();
  await expect(dialog).toBeHidden();
  await expect(share(p2Log, "Moonblade Shard")).toHaveCount(1);
});
