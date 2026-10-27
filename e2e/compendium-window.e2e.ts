// e2e-bundle: compendium
// Thin compendium window flow (CMP §13 E2E): the DM opens Compendium (import panel: SRD 5.1 · 55
// entries, Update), searches "goblin", opens Goblin's stat block; player-1 searches "fire", opens
// Fireball and has no Monsters tab; the DM's Update opens the confirm (cancelled: the bundle's
// server is shared). Visibility per player, ranking, import counts, leak scans: bun test (compendium
// rest.test.ts, import-route.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

test("FR-CMP-18 FR-CMP-19 FR-CMP-20 DM opens Goblin's stat block; player-1 opens Fireball with no Monsters tab; DM's Update asks first", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.compendium");
  await expect(win.getByTestId("cmp-import-status")).toHaveText(
    /^SRD 5\.1 · 55 entries · imported/,
  );
  await expect(win.getByTestId("cmp-update")).toBeVisible();
  await expect(win.getByTestId("cmp-tab")).toHaveCount(6);

  await win.getByTestId("cmp-search").fill("goblin");
  const first = win.getByTestId("cmp-result").first();
  await expect(first.getByTestId("cmp-result-name")).toHaveText("Goblin");
  await expect(first).toHaveAttribute("data-value", "monster");
  await expect(win.getByTestId("cmp-result").filter({ hasText: "Hobgoblin" })).toBeVisible();
  await win
    .getByTestId("cmp-result")
    .filter({ hasText: "SRD" })
    .filter({ hasText: /^Goblin/ })
    .first()
    .click();
  const entry = win.getByTestId("cmp-entry");
  await expect(entry).toHaveAttribute("data-value", "monster");
  await expect(entry.getByTestId("cmp-statblock-header")).toContainText("Goblin");
  await expect(entry).toContainText("AC 15"); // FR-KIT-77 core row
  await expect(entry).toContainText("HP 7 (2d6)");
  await expect(entry).toContainText("darkvision 60 ft.");
  await expect(entry.getByTestId("cmp-statblock-traits")).toContainText("Nimble Escape");
  await expect(entry.getByTestId("cmp-statblock-actions")).toContainText("Scimitar");
  await expect(entry.getByTestId("cmp-statblock-actions")).toContainText("Shortbow");
  await expect(entry.getByTestId("cmp-attribution")).toHaveText("SRD 5.1 · CC BY 4.0");
  await entry.getByTestId("cmp-about").click();
  await expect(dm.getByTestId("cmp-about-text")).toContainText("System Reference Document 5.1");
  await dm.keyboard.press("Escape");
  await win.getByTestId("cmp-back").click();
  await expect(win.getByTestId("cmp-search")).toHaveValue("goblin");
  await expect(win.getByTestId("cmp-result").first()).toBeVisible();

  // Player-1: no Monsters tab; "fire" → Fireball (not the DM-only "Fireball (house)").
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const pw = await openWindow(p1, "cmp.compendium");
  await expect(pw.getByTestId("cmp-tab")).toHaveCount(5);
  await expect(pw.locator('[data-testid="cmp-tab"][data-value="monster"]')).toHaveCount(0);
  await expect(pw.getByTestId("cmp-import-panel")).toHaveCount(0);
  await pw.getByTestId("cmp-search").fill("fire");
  await expect(pw.getByTestId("cmp-result").filter({ hasText: "Fireball" })).toHaveCount(1);
  await expect(pw.locator('[data-testid="cmp-result"][data-value="monster"]')).toHaveCount(0);
  await pw.getByTestId("cmp-result").filter({ hasText: "Fireball" }).click();
  const spell = pw.getByTestId("cmp-entry");
  await expect(spell).toHaveAttribute("data-value", "spell");
  await expect(spell).toContainText("Level 3 evocation");
  await expect(spell.locator('[data-testid="dicex-notation"]').first()).toBeVisible();
  await expect(spell.getByTestId("cmp-attribution")).toHaveText("SRD 5.1 · CC BY 4.0");

  // DM: Update asks first ("Players will pause for ~2 s"); Cancel imports nothing. The import
  // itself runs in bun test (import-route.test.ts): this bundle's server is shared with the other
  // compendium specs, which expect the mini set.
  await win.getByTestId("cmp-update").click();
  const dialog = dm.getByTestId("cmp-import-dialog");
  await expect(dialog).toContainText("Players will pause for ~2 s");
  await expect(dm.getByTestId("cmp-import-confirm")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(win.getByTestId("cmp-import-status")).toHaveText(/55 entries/);
});
