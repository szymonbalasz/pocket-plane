// e2e-bundle: item-present
// Thin entry present flow (CMP §13, #457): player-1 connects to the waiting Moonlit Lantern
// (`entry-present-1`) → popup over the map with its 2 images (Prev / Next), Close → gone, also
// after a reload; the DM awards Potion of Healing with Add to party (Show it on players' screens
// ticked by default) → player-1's popup "The party receives" shows it, Open in Compendium → the
// entry window; the unshared CMP-IMG-SECRET's tick is off and disabled. Present / close / unshare
// rules and the record's visibility: bun test (compendium present.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function openEntry(win: Locator, q: string, name: string) {
  await win.getByTestId("cmp-search").fill(q);
  await win.getByTestId("cmp-result").filter({ hasText: name }).first().click();
  await expect(win.getByTestId("cmp-entry-header")).toContainText(name);
}

test("FR-CMP-80 FR-CMP-81 entry popup on connect: Moonlit Lantern with its images, Close → gone after a reload", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const popup = p1.getByTestId("cmp-present-popup");
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("cmp-present-title")).toHaveText("The party receives");
  await expect(popup.getByTestId("cmp-entry-header")).toContainText("Moonlit Lantern");
  // The images large, one at a time; the entry view's own gallery is off inside the popup.
  await expect(popup.getByTestId("cmp-present-page")).toHaveText("1 / 2");
  await popup.getByTestId("cmp-present-next").click();
  await expect(popup.getByTestId("cmp-present-page")).toHaveText("2 / 2");
  await expect(popup.getByTestId("cmp-entry-images")).toHaveCount(0);
  await expect(popup.getByTestId("cmp-entry-actions")).toHaveCount(0);
  await popup.getByTestId("cmp-present-close").click();
  await expect(popup).toHaveCount(0);
  await p1.reload();
  await live(p1);
  await expect(p1.getByTestId("cmp-present-popup")).toHaveCount(0);
});

test("FR-CMP-80 award with Show it on players' screens → player-1's popup; Open in Compendium; unshared homebrew can't be shown", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  // The fixture's Lantern may still wait for player-1 (test order): close it first.
  const popup = p1.getByTestId("cmp-present-popup");
  if (await popup.isVisible().catch(() => false)) {
    await popup.getByTestId("cmp-present-close").click();
    await expect(popup).toHaveCount(0);
  }

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");

  // Unshared homebrew: the tick is off, disabled, with why.
  await openEntry(win, "CMP-IMG-SECRET", "CMP-IMG-SECRET");
  await win.getByTestId("cmp-add-to-party").click();
  let panel = dm.getByTestId("cmp-add-to-party-panel");
  await expect(panel.getByTestId("cmp-add-to-party-show")).toBeDisabled();
  await expect(panel.getByTestId("cmp-add-to-party-show")).toHaveAttribute(
    "data-state",
    "unchecked",
  );
  await expect(panel.getByTestId("cmp-add-to-party-show-hint")).toHaveText(
    "Share it to show it on players' screens",
  );
  await dm.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await win.getByTestId("cmp-back").click();

  // Imported item: ticked by default → Add → the popup on player-1's screen.
  await openEntry(win, "potion of healing", "Potion of Healing");
  await win.getByTestId("cmp-add-to-party").click();
  panel = dm.getByTestId("cmp-add-to-party-panel");
  await expect(panel.getByTestId("cmp-add-to-party-show")).toHaveAttribute("data-state", "checked");
  await panel.getByTestId("cmp-add-to-party-submit").click();
  await expect(panel.getByTestId("cmp-add-to-party-done")).toBeVisible();

  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("cmp-present-title")).toHaveText("The party receives");
  await expect(popup.getByTestId("cmp-entry-header")).toContainText("Potion of Healing");
  await expect(dm.getByTestId("cmp-present-popup")).toHaveCount(0); // never on the DM
  await popup.getByTestId("cmp-present-open").click();
  await expect(popup).toHaveCount(0);
  const entryWin = p1.locator('[data-testid="ui-window"][data-record-id^="cmp.entry:"]');
  await expect(entryWin.getByTestId("cmp-entry-header")).toContainText("Potion of Healing");
});
