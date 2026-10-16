// e2e-bundle: compendium
// Thin compendium homebrew flow (CMP §13 C4): the DM clones Potion of Healing into a shared
// homebrew entry; player-2 opens Sneak Attack ("Preset: Sneak Attack") and adds it to Thorn
// (Features and Triggers); player-1 finds the shared clone; the DM derives a creature from Wolf
// with its text copied, then deletes the clone (player-1's search no longer finds it). The
// bundle's server is shared with the other compendium specs: names here never match their
// searches ("gob", "og", "fire") and the clone is deleted. Transactions, refusals, leak scans:
// bun test (compendium homebrew.test.ts, add-to-sheet.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const CLONE = "Potion of Greater Healing (house)";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** Opens the first result named `name` (`badge`: "SRD" skips the entryless fixture monsters). */
async function open(win: Locator, q: string, name: string, badge?: string) {
  await win.getByTestId("cmp-search").fill(q);
  let row = win.getByTestId("cmp-result").filter({ hasText: name });
  if (badge) row = row.filter({ hasText: badge });
  await row.first().click();
  await expect(win.getByTestId("cmp-entry")).toContainText(name);
}

test("FR-CMP-24 FR-CMP-25 FR-CMP-27 FR-CMP-28 FR-CMP-29 DM clones a shared potion; player-2 adds Sneak Attack to Thorn; DM derives from Wolf and deletes the clone", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");

  // Clone → the homebrew form prefilled; rename, share, save → the new entry opens.
  await open(win, "potion of healing", "Potion of Healing");
  await win.getByTestId("cmp-clone").click();
  const form = dm.getByTestId("cmp-form");
  await expect(form.getByTestId("cmp-form-name")).toHaveValue("Potion of Healing");
  await expect(form.getByTestId("cmp-form-preview")).not.toBeEmpty();
  await form.getByTestId("cmp-form-name").fill(CLONE);
  await form.getByTestId("cmp-form-shared").click();
  await form.getByTestId("cmp-form-save").click();
  await expect(form).toHaveCount(0);
  const clone = win.getByTestId("cmp-entry");
  await expect(clone.getByTestId("cmp-entry-header")).toContainText(CLONE);
  await expect(clone.getByTestId("cmp-attribution")).toHaveText("Homebrew · Shared");
  await expect(clone.getByTestId("cmp-edit")).toBeVisible();

  // Player-2: Sneak Attack shows its preset; Add to sheet (own character only: Thorn).
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  const pw2 = await openWindow(p2, "cmp.compendium");
  await open(pw2, "sneak", "Sneak Attack");
  await expect(pw2.getByTestId("cmp-preset")).toHaveText("Preset: Sneak Attack");
  await pw2.getByTestId("cmp-add-to-sheet").click();
  await expect(p2.getByTestId("cmp-add-to-sheet-character")).toContainText("Thorn");
  await p2.getByTestId("cmp-add-to-sheet-confirm").click();
  await expect(p2.getByText("Added to Thorn's Features and Triggers")).toBeVisible();

  // Player-1 finds the shared clone after a search.
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const pw1 = await openWindow(p1, "cmp.compendium");
  await pw1.getByTestId("cmp-search").fill("greater");
  await expect(pw1.getByTestId("cmp-result").filter({ hasText: CLONE })).toHaveCount(1);

  // DM: Derive… from Wolf, copy text on.
  await win.getByTestId("cmp-back").click();
  await open(win, "wolf", "Wolf", "SRD");
  await win.getByTestId("cmp-derive").click();
  const derive = dm.getByTestId("cmp-derive-dialog");
  await expect(derive.getByTestId("cmp-derive-name")).toHaveValue("Wolf");
  await expect(derive.getByTestId("cmp-derive-copy-text")).toHaveAttribute("data-state", "checked");
  await derive.getByTestId("cmp-derive-name").fill("Pack Scout");
  await derive.getByTestId("cmp-derive-save").click();
  await expect(derive).toHaveCount(0);
  await expect(dm.getByText("Derived Pack Scout")).toBeVisible();

  // DM deletes the clone (confirm); player-1's next search no longer finds it.
  await win.getByTestId("cmp-back").click();
  await open(win, "greater", CLONE);
  await win.getByTestId("cmp-delete").click();
  await dm.getByTestId("cmp-delete-confirm").click();
  await expect(win.getByTestId("cmp-window")).toHaveAttribute("data-view", "list");
  await pw1.getByTestId("cmp-search").fill("(house)");
  await expect(pw1.getByTestId("cmp-empty")).toBeVisible();
});
