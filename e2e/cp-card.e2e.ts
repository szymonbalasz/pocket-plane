// e2e-bundle: companions-ally
// Sprint 6 CP4 (CBT §13.3 S5 card part, thin): DM, player-1 (Mira) and player-2 (Thorn) at
// 1440×900. Goblin 2 is Mira's companion in the running fight (`cp-ally`). Player-1's launcher
// has "Companions"; the card reads "Goblin 2 · Mira's summon · Acts after Mira", In combat, its
// Scimitar row with Attack / Damage (FR-CHARX-59, -62, -64, -131). Attack (Alt+click: at once)
// sends `cbt.attack` as the companion: the DM's Initiative gets a "Goblin 2" card; the roll line
// is in player-1's log, not player-2's (FR-CBT-114, ADR-0056). Player-2 has no Companions entry
// (FR-CHARX-67). The DM opens the card from Goblin 2's card icon (FR-CHARX-59, walkthrough 9);
// Turn hostile → player-1's card says "No longer your companion" and then closes (FR-CHARX-68,
// walkthrough 19). Picker, edits, HP states, leaks: bun test (companion tests).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { rollNow } from "./support/rolls";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const row = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Log entries whose actor is `name`. */
const entriesBy = (page: Page, name: string) =>
  page.getByTestId("dice-log-entry").filter({
    has: page.getByTestId("dice-log-entry-actor").getByText(name, { exact: true }),
  });

test("FR-CHARX-59 FR-CHARX-64 FR-CHARX-67 FR-CHARX-68 companions-ally: the owner's card rolls as Goblin 2; the DM gets the card and opens it from the row; player-2 has no card and no roll line; turned hostile, the card says so and closes", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const goblin2 = recordId("combat-1", "combatant", 3);
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

  // Player-2 owns no companion: no launcher entry (FR-CHARX-59, -67).
  await expect(launcherButton(p2, "charx.companion")).toHaveCount(0);

  // Player-1: Companions → the card on Goblin 2.
  const card = await openWindow(p1, "charx.companion");
  const root = card.getByTestId("charx-companion");
  await expect(root.getByTestId("charx-companion-name")).toHaveText("Goblin 2");
  await expect(root.getByTestId("charx-companion-owner")).toHaveText("Mira's summon");
  await expect(root.getByTestId("charx-companion-mode")).toHaveText("Acts after Mira");
  await expect(root.getByTestId("charx-companion-in-combat")).toBeVisible();
  await expect(root.getByTestId("charx-companion-edit")).toHaveCount(0); // a summon
  const scimitar = root.getByTestId("charx-companion-attack").filter({ hasText: "Scimitar" });
  await expect(scimitar).toContainText("Scimitar · +4 · 1d6+2 slashing");
  await expect(scimitar.getByTestId("charx-companion-roll")).toHaveCount(2);

  // The DM's Initiative and both players' logs before the roll.
  const init = shellWindow(dm, "cbt.initiative");
  await expect(init).toBeVisible();
  const goblinCards = init.getByTestId("cbt-init-card").filter({ hasText: "Goblin 2" });
  const cardsBefore = await goblinCards.count();
  await openWindow(p1, "dice.log");
  await openWindow(p2, "dice.log");
  const p1Before = await entriesBy(p1, "Goblin 2").count();
  const p2Before = await entriesBy(p2, "Goblin 2").count();

  // Attack → cbt.attack as the companion (FR-CHARX-64, -131, FR-CBT-114).
  await rollNow(scimitar.locator('[data-testid="charx-companion-roll"][data-value="toHit"]'));
  await expect(goblinCards).toHaveCount(cardsBefore + 1);
  await expect(entriesBy(p1, "Goblin 2")).toHaveCount(p1Before + 1);
  // The roll line is DM + owner only: player-2's log is unchanged once player-1 has it.
  await expect(entriesBy(p2, "Goblin 2")).toHaveCount(p2Before);

  // The DM opens Goblin 2's card from its row's card icon (walkthrough 9).
  await row(init, goblin2).getByTestId("cbt-init-row-card").click();
  const dmCard = shellWindow(dm, "charx.companion");
  await expect(dmCard.getByTestId("charx-companion-name")).toHaveText("Goblin 2");
  await expect(dmCard.getByTestId("charx-companion")).toHaveAttribute("data-record-id", goblin2);

  // Turn hostile: player-1's last companion leaves → the message for 3 s, then the window
  // closes with its launcher entry (walkthrough 19).
  await row(init, goblin2).getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-companion").click();
  await dm.getByTestId("cbt-companion-hostile").click();
  await expect(card.getByTestId("charx-companion-gone")).toContainText("No longer your companion");
  await expect(card).toHaveCount(0, { timeout: 6000 });
  await expect(launcherButton(p1, "charx.companion")).toHaveCount(0);
});
