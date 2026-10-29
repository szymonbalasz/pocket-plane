// e2e-bundle: tray-attacks
// Thin tray attacks S3 flow (CBT §13.8 T5–T8; FR-CHARX-126, -127, FR-CBT-169): Player 1's Brakka
// sheet shows Attack and Damage only; Flame Tongue Attack → the Dice tray pre-filled (adjust,
// purpose Attack) → Roll → a to-hit card of the row; Damage → the tray "2d6+5 slashing · 2d6 fire",
// + a d6 (joins fire) → Roll → that card completed "… slashing + … fire", the line marked
// "edited". Then Mira's Light crossbow Alt+click Attack, Alt+click Damage → no tray, a card at once
// completed by the Damage. Staging, parts, routing and limits: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { rollNow } from "./support/rolls";
import { pickSheet } from "./support/sheet";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** A character's attack row on its sheet's Actions tab. */
async function attackRow(sheet: Locator, characterId: string, name: string) {
  await pickSheet(sheet, characterId);
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  return sheet.getByTestId("charx-attack").filter({ hasText: name });
}

test("FR-CHARX-126 FR-CHARX-127 FR-CBT-169 sheet Attack / Damage stage the tray (+ d6 → the card's fire part); Alt+click rolls at once", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const init = await openWindow(dm, "cbt.initiative");
  const p1Log = await openWindow(p1, "dice.log");
  // A retry reuses the bundle's server: count only what this attempt adds.
  const cards = init.getByTestId("cbt-init-card");
  const cardIds = () =>
    cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));
  const before = new Set(await cardIds());
  const fresh = async () => (await cardIds()).filter((id) => id !== null && !before.has(id));
  const damageLine = p1Log
    .getByTestId("dice-log-entry")
    .filter({ hasText: "Flame Tongue greatsword damage" });
  const damages = await damageLine.count();

  // T5: Flame Tongue shows Attack and Damage only.
  const sheet = await openWindow(p1, "char.sheet");
  const flame = await attackRow(sheet, recordId("char-brakka", "entity"), "Flame Tongue");
  await expect(flame.locator('[data-testid^="charx-roll-"]')).toHaveCount(2);
  await expect(flame.getByTestId("charx-roll-attack-damage")).toHaveCount(0);

  // T6: Attack → the tray pre-filled (adjust, purpose Attack, the d20 locked) → Roll → a card.
  await flame.getByTestId("charx-roll-attack").click();
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "adjust");
  await expect(tray.getByTestId("dicex-tray-state")).toContainText(
    "Brakka — Flame Tongue greatsword attack",
  );
  await expect(tray.getByTestId("dicex-tray-purpose")).toHaveAttribute("data-value", "attack");
  await expect(tray.locator('[data-testid="dicex-tray-die"][data-faces="20"]')).toHaveCount(1);
  expect(await fresh()).toEqual([]);
  await tray.getByTestId("dicex-tray-roll").click();
  await expect.poll(fresh).toHaveLength(1);
  const [id] = await fresh();
  const card = init.locator(`[data-testid="cbt-init-card"][data-record-id="${id}"]`);
  await expect(card).toContainText(/Brakka: \d+ to hit .*\(Flame Tongue greatsword\)/);

  // T7: Damage → "2d6 slashing · 2d6 fire"; a d6 joins the last d6 group (fire: 3d6) → Roll.
  await flame.getByTestId("charx-roll-damage").click();
  await expect(tray.getByTestId("dicex-tray-purpose")).toHaveAttribute("data-value", "damage");
  for (const group of ["6:slashing", "6:fire"]) {
    await expect(
      tray.locator(`[data-testid="dicex-tray-group-type"][data-record-id="${group}"]`),
    ).toHaveCount(1);
  }
  const d6 = tray.locator('[data-testid="dicex-tray-die"][data-faces="6"]');
  await expect(d6).toHaveCount(4);
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="6"]').click();
  await expect(d6).toHaveCount(5);
  await tray.getByTestId("dicex-tray-roll").click();
  await expect(card).toContainText(/to hit.*, \d+ slashing \+ \d+ fire/);
  expect(await fresh()).toEqual([id]);
  await expect(damageLine).toHaveCount(damages + 1);
  await expect(damageLine.last()).toContainText("edited");

  // T8: Mira's Light crossbow, Alt+click Attack then Damage: no tray, a card at once, completed.
  const crossbow = await attackRow(sheet, recordId("char-mira", "entity"), "Light crossbow");
  await tray.getByTestId("ui-window-close").click();
  await expect(tray).toHaveCount(0);
  await rollNow(crossbow.getByTestId("charx-roll-attack"));
  await expect.poll(fresh).toHaveLength(2);
  const miraId = (await fresh()).find((x) => x !== id) as string;
  const miraCard = init.locator(`[data-testid="cbt-init-card"][data-record-id="${miraId}"]`);
  await expect(miraCard).toContainText(/Mira: \d+ to hit/);
  await rollNow(crossbow.getByTestId("charx-roll-damage"));
  await expect(miraCard).toContainText(/to hit.*, \d+ piercing/);
  await expect(tray).toHaveCount(0);
  expect(await fresh()).toHaveLength(2);

  // Leave the bundle's server as found: the DM dismisses both cards.
  const popup = dm.getByTestId("cbt-popup");
  for (const c of [card, miraCard]) {
    await c.click();
    await expect(popup).toBeVisible();
    await popup.getByTestId("cbt-popup-dismiss").click();
    await expect(c).toHaveCount(0);
  }
  for (const page of [p1, dm]) await page.context().close();
});
