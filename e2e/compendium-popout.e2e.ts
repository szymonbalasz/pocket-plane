// e2e-bundle: compendium
// Thin flow of popped-out entries (FR-CMP-76, FR-SHELL-200): the DM pops out two entries, each in
// its own window titled with its name, while the Compendium goes back to its list; popping one out
// again adds no window; a close removes one; a reload closes the rest and keeps the layout valid.
// A player does the same. Placement, storage rules: bun test (popout.test.tsx).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const popouts = (page: Page) =>
  page.locator('[data-testid="ui-window"][data-record-id^="cmp.entry:"]');
const named = (page: Page, name: string) => popouts(page).filter({ hasText: name });

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** Searches the open Compendium, opens the result and pops it out. */
async function popOut(page: Page, query: string, name: string) {
  const cmp = await openWindow(page, "cmp.compendium");
  await cmp.getByTestId("cmp-search").fill(query);
  await cmp.getByTestId("cmp-result").filter({ hasText: name }).first().click();
  await expect(cmp.getByTestId("cmp-entry")).toBeVisible();
  await cmp.getByTestId("cmp-popout").click();
  await expect(named(page, name).getByTestId("cmp-entry")).toBeVisible();
  await expect(named(page, name).getByTestId("ui-window-title")).toContainText(name);
}

test("FR-CMP-76 the DM pops out two entries, each in its own window; again = same window; a close removes one; a reload closes them", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  // Room for the Compendium beside its pop-outs (a laptop: the next test).
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  await popOut(dm, "goblin", "Goblin");
  // The Compendium stays open, back on its list, ready for the next entry.
  await expect(dm.getByTestId("cmp-search")).toBeVisible();
  await popOut(dm, "fire", "Fireball");
  await expect(popouts(dm)).toHaveCount(2);
  // No launcher to come back from, so no Minimise (FR-SHELL-200).
  await expect(named(dm, "Goblin").getByTestId("ui-window-minimise")).toHaveCount(0);

  // The windows sit side by side, not on top of each other.
  const a = await named(dm, "Goblin").boundingBox();
  const b = await named(dm, "Fireball").boundingBox();
  expect(a && b && (a.x !== b.x || a.y !== b.y)).toBe(true);

  await popOut(dm, "goblin", "Goblin");
  await expect(popouts(dm)).toHaveCount(2);

  await named(dm, "Goblin").getByTestId("ui-window-close").click();
  await expect(popouts(dm)).toHaveCount(1);
  await expect(named(dm, "Fireball")).toHaveCount(1);

  await dm.reload();
  await live(dm);
  await expect(popouts(dm)).toHaveCount(0);
  await expect(dm.getByTestId("ui-launcher")).toBeVisible();
});

test("FR-CMP-76 at 1280×800 the Compendium makes room for the pop-out (minimised, as any window) and its launcher brings it back on the list", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  await popOut(dm, "goblin", "Goblin");
  const cmp = await openWindow(dm, "cmp.compendium");
  await expect(cmp.getByTestId("cmp-search")).toBeVisible();
  await expect(named(dm, "Goblin")).toBeVisible();
});

test("FR-CMP-76 the DM deletes a homebrew entry from its pop-out: the window says it's gone at once", async ({
  browser,
}) => {
  // The bundle's server is shared: a name no other compendium spec searches for, and deleted here.
  const NAME = "Zzyx Draught";
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  const cmp = await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-search").fill("potion of healing");
  await cmp.getByTestId("cmp-result").filter({ hasText: "Potion of Healing" }).first().click();
  await cmp.getByTestId("cmp-clone").click();
  const form = dm.getByTestId("cmp-form");
  await form.getByTestId("cmp-form-name").fill(NAME);
  await form.getByTestId("cmp-form-save").click();
  await expect(form).toHaveCount(0);
  await expect(cmp.getByTestId("cmp-entry-header")).toContainText(NAME);
  await cmp.getByTestId("cmp-popout").click();

  const win = named(dm, NAME);
  await expect(win.getByTestId("ui-window-title")).toContainText(NAME);
  await win.getByTestId("cmp-delete").click();
  await dm.getByTestId("cmp-delete-confirm").click();
  await expect(win.getByTestId("cmp-entry-error")).toBeVisible();
  await expect(win.getByTestId("cmp-entry")).toHaveCount(0);
  await win.getByTestId("ui-window-close").click();
  await expect(popouts(dm)).toHaveCount(0);
});

test("FR-CMP-76 a player pops out an entry too", async ({ browser }) => {
  const { link } = e2eEnv();
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);
  await popOut(player, "fire", "Fireball");
  await expect(popouts(player)).toHaveCount(1);
});
