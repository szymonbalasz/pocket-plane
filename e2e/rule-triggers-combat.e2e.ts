// e2e-bundle: rule-triggers
// Thin Divine Fury flow in combat (MOD §13 E2E, R7): DM Next → Brakka's turn; player-1 turns
// Rage on and rolls Greataxe Attack + damage → the card shows the offer ("+ N radiant Divine Fury
// on a hit") for both; the DM's popup has the chip ticked on Goblin → Apply → the line "+ N
// radiant (Divine Fury)" for both; a second attack the same turn → no offer. Settle rules,
// charges, undo, leaks: bun test (effect-modifiers).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

test("FR-MOD-48 FR-MOD-39 FR-MOD-38 Divine Fury: offered on the card, chip on Goblin, line for both; once per turn", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // DM: Initiative → Next (Wolf → Brakka, round 1).
  const init = await openWindow(dm, "cbt.initiative");
  const brakka = await idByName(init, "Brakka");
  await init.getByTestId("cbt-init-next").click();
  await expect(
    init.locator(`[data-testid="cbt-init-row"][data-record-id="${brakka}"]`),
  ).toHaveAttribute("data-turn", "true");

  // Player 1: Brakka's sheet → Active effects → Rage on.
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const rage = sheet.getByTestId("mod-toggle").first();
  await rage.getByRole("switch").click();
  await expect(rage).toHaveAttribute("data-state", "on");

  // Greataxe Attack + damage → the card with the offer, for the player and the DM.
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const greataxe = sheet.getByTestId("charx-attack").filter({ hasText: "Greataxe" });
  await greataxe.getByTestId("charx-roll-attack-damage").click();
  // The player's own card (no toast for their own roll): Notifications history.
  const history = await openWindow(p1, "note.history");
  const offer = history.getByTestId("mod-card-offer");
  await expect(offer).toHaveCount(1);
  const text = (await offer.textContent()) ?? "";
  const n = Number(/^\+ (\d+) radiant Divine Fury$/.exec(text)?.[1]);
  expect(n).toBeGreaterThan(0);
  // FR-SHELL-40 ruling: at 1280×800 Notifications auto-places over the sheet; park it.
  await history.getByTestId("ui-window-minimise").click();

  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  const goblin = await idByName(init, "Goblin");
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  const chip = trow.getByTestId("mod-popup-part");
  await expect(chip).toHaveAttribute("data-state", "on");
  await expect(chip).toContainText(`+ ${n} radiant Divine Fury`);
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);

  // The outcome line for both: "… slashing damage + N radiant (Divine Fury)".
  for (const page of [dm, p1]) {
    const log = await openWindow(page, "dice.log");
    await expect(
      log.getByTestId("dice-log-entry").filter({ hasText: `+ ${n} radiant (Divine Fury)` }),
    ).toHaveCount(1);
  }

  // Second attack, same turn: no offer.
  await shellWindow(p1, "char.sheet")
    .getByTestId("charx-attack")
    .filter({ hasText: "Greataxe" })
    .getByTestId("charx-roll-attack-damage")
    .click();
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(popup).toBeVisible();
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  await expect(trow).toHaveCount(1);
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await expect(popup.getByTestId("mod-popup-part")).toHaveCount(0);
  // The player's history: still the first card's offer only.
  await expect(history.getByTestId("mod-card-offer")).toHaveCount(1);
  await popup.getByTestId("cbt-popup-dismiss").click();
  await expect(popup).toHaveCount(0);
});
