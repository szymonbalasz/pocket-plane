// e2e-bundle: sheet-links
// Thin flow of sheet names linking to compendium entries (FR-CMP-77): a name with one entry opens
// it in its own window; a name two entries share opens the Compendium on that search; a name without
// an entry, or one the viewer can't read, stays plain. Matching and visibility: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const nameLink = (win: Locator, name: string) =>
  win.getByTestId("charx-compendium-link").and(win.getByRole("button", { name, exact: true }));
const popout = (page: Page, name: string) =>
  page.locator('[data-testid="ui-window"][data-record-id^="cmp.entry:"]').filter({ hasText: name });

async function sheetTab(win: Locator, tab: string) {
  await win.locator(`[data-testid="charx-tab"][data-value="${tab}"]`).click();
}

for (const role of ["DM", "Player 1"] as const) {
  test(`FR-CMP-77 ${role}: sheet names open their compendium entries`, async ({ browser }) => {
    const { secret, link, recordId } = e2eEnv();
    const page = await rolePage(browser);
    await page.setViewportSize({ width: 1600, height: 900 });
    if (role === "DM") await loginDm(page, secret);
    else await page.goto(link(role));
    await live(page);
    const sheet = await openWindow(page, "char.sheet");
    await expect(sheet.getByTestId("char-sheet")).toHaveAttribute(
      "data-record-id",
      recordId("char-mira", "entity"),
    );

    await sheetTab(sheet, "actions");
    await expect(nameLink(sheet, "Longsword")).toBeVisible();
    await expect(nameLink(sheet, "Fireball")).toBeVisible();
    // No entry has this name: plain text, in a row that is there.
    await expect(sheet.getByText("Hedge Whisper")).toBeVisible();
    await expect(nameLink(sheet, "Hedge Whisper")).toHaveCount(0);
    // Homebrew the DM hasn't shared: a link for them only, plain for the player.
    await expect(sheet.getByText("Fireball (house)")).toBeVisible();
    await expect(nameLink(sheet, "Fireball (house)")).toHaveCount(role === "DM" ? 1 : 0);

    // One entry: its own window, titled with its name.
    await nameLink(sheet, "Fireball").click();
    await expect(popout(page, "Fireball").getByTestId("cmp-entry")).toBeVisible();
    await expect(popout(page, "Fireball").getByTestId("ui-window-title")).toHaveText("Fireball");

    // Two entries share the name: the Compendium on that search, both listed.
    await nameLink(sheet, "Bless").click();
    const cmp = shellWindow(page, "cmp.compendium");
    await expect(cmp.getByTestId("cmp-search")).toHaveValue("Bless");
    await expect(cmp.getByTestId("cmp-result").filter({ hasText: "Bless" })).toHaveCount(2);

    await sheetTab(sheet, "features");
    await expect(nameLink(sheet, "Sneak Attack")).toBeVisible();
    await sheetTab(sheet, "inventory");
    await expect(nameLink(sheet, "Moonblade Shard")).toBeVisible();
  });
}
