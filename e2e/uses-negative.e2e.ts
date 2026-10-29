// e2e-bundle: uses-negative
// Thin negative-uses flow (S4-2; MOD §13.1 steps 2, 6a, 6b, 13; FR-CHARX-58, FR-MOD-59):
// player-1's Brakka (Rage 0 / 3 left) → Rage switch asks "Rage anyway?" → −1 / 3 in red with the
// "−1" Badge, in the Toggles block and on the Features row; a pip past zero asks too (Cancel keeps
// −1, Use anyway → −2); Reset → 3 / 3. Mira's Searing Strike (1 / 2 left): two crossbow attacks
// before the DM applies either; card 1 with the chip → 0 / 2; card 2 → "no use left" → Force →
// −1 / 2; Undo → 0 / 2 (exact refund). Floors, conflicts, visibility and leaks: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { rollNow } from "./support/rolls";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

const tab = (sheet: Locator, value: string) =>
  sheet.locator(`[data-testid="charx-tab"][data-value="${value}"]`).click();
const feature = (sheet: Locator, name: string) =>
  sheet.getByTestId("charx-feature").filter({ hasText: name });

test("FR-CHARX-58 FR-MOD-59 uses below zero: Rage anyway → −1 / 3, a pip past zero asks, Reset; a forced Searing Strike → −1 / 2, undo → 0 / 2", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // Brakka's Features: Rage 0 / 3 left.
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, recordId("char-brakka", "entity"));
  await tab(sheet, "features");
  const rageLeft = feature(sheet, "Rage").getByTestId("charx-feature-left");
  await expect(rageLeft).toHaveAttribute("data-value", "0");
  await expect(rageLeft).toContainText("0 / 3 left");

  // Rage switch at 0 left: asks first, then −1 / 3 in red, the minus once (FR-MOD-68: no Badge).
  await tab(sheet, "section:mod.effects");
  const rage = sheet.getByTestId("mod-toggle").first();
  await rage.getByRole("switch").click();
  const ask = p1.getByTestId("mod-toggle-overspend");
  await expect(ask).toHaveText(/No Rage uses left \(0 \/ 3\)\. Rage anyway\? → −1 \/ 3/);
  await expect(rage).toHaveAttribute("data-state", "off");
  await p1.getByTestId("mod-toggle-overspend-confirm").click();
  await expect(rage).toHaveAttribute("data-state", "on");
  await expect(sheet.getByTestId("mod-toggle-uses").first()).toHaveAttribute("data-value", "-1/3");
  await expect(sheet.getByTestId("mod-toggle-overspent")).toHaveCount(0);

  // Features: −1 / 3 left, every pip filled, the minus once (FR-MOD-68: no Badge); a pip past
  // zero asks.
  await tab(sheet, "features");
  await expect(rageLeft).toContainText("−1 / 3 left");
  await expect(feature(sheet, "Rage").getByTestId("charx-feature-overspent")).toHaveCount(0);
  const pip = feature(sheet, "Rage").getByTestId("charx-feature-use").first();
  await expect(pip).toHaveAttribute("data-left", "-1");
  await pip.click();
  const pipAsk = p1.getByTestId("charx-feature-overspend");
  await expect(pipAsk).toHaveText(/No Rage uses left \(−1 \/ 3\)\. Use anyway\? → −2 \/ 3/);
  await p1.getByTestId("charx-feature-overspend-cancel").click();
  await expect(pipAsk).toHaveCount(0);
  await expect(rageLeft).toHaveAttribute("data-value", "-1");
  await pip.click();
  await p1.getByTestId("charx-feature-overspend-confirm").click();
  await expect(rageLeft).toHaveAttribute("data-value", "-2");
  await expect(rageLeft).toContainText("−2 / 3 left");
  // Reset → full.
  await feature(sheet, "Rage").getByTestId("charx-resource-reset").click();
  await expect(rageLeft).toContainText("3 / 3 left");
  await expect(feature(sheet, "Rage").getByTestId("charx-feature-overspent")).toHaveCount(0);

  // Mira's turn (Wolf → Brakka → Mira); Searing Strike 1 / 2 left.
  const init = await openWindow(dm, "cbt.initiative");
  const mira = await idByName(init, "Mira");
  await init.getByTestId("cbt-init-next").click();
  await init.getByTestId("cbt-init-next").click();
  await expect(
    init.locator(`[data-testid="cbt-init-row"][data-record-id="${mira}"]`),
  ).toHaveAttribute("data-turn", "true");
  await pickSheet(sheet, recordId("char-mira", "entity"));
  await tab(sheet, "features");
  const strikeLeft = feature(sheet, "Searing Strike").getByTestId("charx-feature-left");
  await expect(strikeLeft).toContainText("1 / 2 left");

  // Two Light crossbow Attacks, each completed by its Damage (Alt+click: at once, #385), before
  // the DM applies either: both cards offer it.
  await tab(sheet, "actions");
  const crossbow = sheet.getByTestId("charx-attack").filter({ hasText: "Light crossbow" });
  const cards = init.getByTestId("cbt-init-card");
  for (const n of [1, 2]) {
    await rollNow(crossbow.getByTestId("charx-roll-attack"));
    await expect(cards).toHaveCount(n);
    await rollNow(crossbow.getByTestId("charx-roll-damage"));
    await expect(cards.filter({ hasText: /to hit.*, \d+ / })).toHaveCount(n);
  }

  const popup = dm.getByTestId("cbt-popup");
  /** Opens the first pending card, targets `name` as a Hit with the chip on; returns the row. */
  const openOn = async (name: string) => {
    await cards.first().click();
    await expect(popup).toBeVisible();
    const id = await idByName(init, name);
    await popup.getByTestId("cbt-popup-target-add").click();
    await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${id}"]`).click();
    const row = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${id}"]`);
    const hit = row.getByTestId("cbt-popup-target-hit");
    if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
    await expect(row.getByTestId("mod-popup-part")).toHaveAttribute("data-state", "on");
    return row;
  };

  // Card 1 → Goblin with the chip: 0 / 2 left.
  await openOn("Goblin");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await tab(sheet, "features");
  await expect(strikeLeft).toContainText("0 / 2 left");

  // Card 2 → Wolf: "no use left" → Force → −1 / 2 left in red.
  const wolf = await openOn("Wolf");
  await popup.getByTestId("cbt-popup-apply").click();
  const hint = wolf.getByTestId("mod-popup-part-hint");
  await expect(hint).toHaveAttribute("data-value", "used");
  await expect(hint).toContainText("no Searing Strike uses left");
  await wolf.getByTestId("mod-popup-part-force").click();
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(strikeLeft).toContainText("−1 / 2 left");
  await expect(strikeLeft).toHaveAttribute("data-value", "-1");

  // Undo card 2 → exactly that use back: 0 / 2 left.
  await init.getByTestId("cbt-init-undo").click();
  await expect(strikeLeft).toContainText("0 / 2 left");
  await expect(cards).toHaveCount(1);
});
