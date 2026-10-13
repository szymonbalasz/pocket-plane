// e2e-bundle: mid-combat
// Playtest polish (CBT §13 E2E, mid-combat: round 1, Wolf's turn). DM Initiative row menu: the
// Save ▸ submenu stays open while the mouse crosses to an ability (FR-CBT-44).
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

test("FR-CBT-44 Save ▸ submenu: a mouse move from Save to Dexterity picks it", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const goblin = recordId("combat-1", "combatant", 2);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const init = await openWindow(dm, "cbt.initiative");
  const log = await openWindow(dm, "dice.log");
  const before = await log.getByTestId("dice-log-entry").count();
  await init.locator(`[data-testid="cbt-init-row-menu"][data-record-id="${goblin}"]`).click();
  const save = dm.locator(`[data-testid="cbt-init-row-save"][data-record-id="${goblin}"]`);
  await save.hover();
  const dex = dm.locator(
    `[data-testid="cbt-init-row-save-option"][data-record-id="${goblin}"][data-value="dex"]`,
  );
  await expect(dex).toBeVisible();
  // At the right edge the submenu opens on the left: a direct move (no steps) from "Save" to
  // "Dexterity" used to close it (playtest regression).
  await dex.click();
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(before + 1);
  await expect(log.getByTestId("dice-log-entry").last()).toContainText("Goblin");
  await expect(log.getByTestId("dice-log-entry").last()).toContainText("Dexterity save");
  await dm.context().close();
});

test("FR-CBT-44 Check ▸ submenu: stepped move from Check to Wisdom picks it; the menu then closes", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const goblin2 = recordId("combat-1", "combatant", 3);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const init = await openWindow(dm, "cbt.initiative");
  const log = await openWindow(dm, "dice.log");
  const before = await log.getByTestId("dice-log-entry").count();
  await init.locator(`[data-testid="cbt-init-row-menu"][data-record-id="${goblin2}"]`).click();
  const check = dm.locator(`[data-testid="cbt-init-row-check"][data-record-id="${goblin2}"]`);
  await check.hover();
  const wis = dm.locator(
    `[data-testid="cbt-init-row-check-option"][data-record-id="${goblin2}"][data-value="wis"]`,
  );
  await expect(wis).toBeVisible();
  const from = await check.boundingBox();
  const to = await wis.boundingBox();
  if (!from || !to) throw new Error("no boxes");
  await dm.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await dm.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await dm.mouse.down();
  await dm.mouse.up();
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(before + 1);
  await expect(log.getByTestId("dice-log-entry").last()).toContainText("Wisdom check");
  await expect(dm.getByRole("menu")).toHaveCount(0);
  await dm.context().close();
});
