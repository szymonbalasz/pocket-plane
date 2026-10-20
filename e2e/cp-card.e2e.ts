// e2e-bundle: companions-ally
// Sprint 6 CP4 (CBT §13.3 S5 card part, thin): DM, player-1 (Mira) and player-2 (Thorn) at
// 1440×900. Goblin 2 is Mira's companion in the running fight (`cp-ally`). Player-1's launcher
// has "Companions"; the card reads "Goblin 2 · Mira's summon · Acts after Mira", In combat, its
// Scimitar row with Attack / Damage / Attack + damage (FR-CHARX-59, -62, -64). Attack + damage
// sends `cbt.attack` as the companion: the DM's Initiative gets a "Goblin 2" card; the roll line
// is in player-1's log, not player-2's (FR-CBT-114, ADR-0056). Player-2 has no Companions entry
// (FR-CHARX-67). Picker, edits, HP states, leaks: bun test (companion tests).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Log entries whose actor is `name`. */
const entriesBy = (page: Page, name: string) =>
  page.getByTestId("dice-log-entry").filter({
    has: page.getByTestId("dice-log-entry-actor").getByText(name, { exact: true }),
  });

test("FR-CHARX-59 FR-CHARX-64 FR-CHARX-67 companions-ally: the owner's card rolls as Goblin 2; the DM gets the card; player-2 has no card and no roll line", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
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
  await expect(scimitar.getByTestId("charx-companion-roll")).toHaveCount(3);

  // The DM's Initiative and both players' logs before the roll.
  const init = shellWindow(dm, "cbt.initiative");
  await expect(init).toBeVisible();
  const goblinCards = init.getByTestId("cbt-init-card").filter({ hasText: "Goblin 2" });
  const cardsBefore = await goblinCards.count();
  await openWindow(p1, "dice.log");
  await openWindow(p2, "dice.log");
  const p1Before = await entriesBy(p1, "Goblin 2").count();
  const p2Before = await entriesBy(p2, "Goblin 2").count();

  // Attack + damage → cbt.attack as the companion (FR-CHARX-64, FR-CBT-114).
  await scimitar.locator('[data-testid="charx-companion-roll"][data-value="attack"]').click();
  await expect(goblinCards).toHaveCount(cardsBefore + 1);
  await expect(entriesBy(p1, "Goblin 2")).toHaveCount(p1Before + 1);
  // The roll line is DM + owner only: player-2's log is unchanged once player-1 has it.
  await expect(entriesBy(p2, "Goblin 2")).toHaveCount(p2Before);
});
