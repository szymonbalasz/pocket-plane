// e2e-bundle: late-damage
// Late damage (sprint 5 R1; FR-CBT-87–94, ADR-0053), thin: the fixture's ruled card opens in its
// damage step and player-1's Damage fills it; then player-1 attacks with physical dice, a natural
// 20 (crit) and a natural 1 the DM rules a hit: Apply hit → "— DM: …" at once for player-1, the
// popup stays open in its damage step, player-1's Damage fills it, Apply → the damage line.
// Field rules, unused rolls, the late note, ordering and leaks: bun test (late-fill.test.tsx,
// late-damage.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/** Physical dice on in this client (dice log Options). */
async function physicalOn(page: Page) {
  const log = await openWindow(page, "dice.log");
  const options = log.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  await log.getByTestId("dice-roll-physical").click();
  await expect(log.getByTestId("dice-roll-physical")).toHaveAttribute("data-state", "checked");
}

/** The open physical-dice form: the first total `first`, every other die field 1. */
async function rollPhysical(page: Page, first: string) {
  const form = page.locator("form").filter({ has: page.getByTestId("dice-manual-label") });
  await expect(form).toBeVisible();
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill(first);
  const rest = form.locator(
    '[data-testid="dice-manual-total"]:not([data-value="0"]), [data-testid="dice-manual-crit-total"], [data-testid="mod-tray-group-total"]',
  );
  for (const input of await rest.all()) await input.fill("1");
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
}

test("FR-CBT-87 FR-CBT-89 FR-CBT-90 Apply hit, then the late Damage fills the open popup (fixture card, natural 20, natural 1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  await physicalOn(p1);
  const p1Log = await openWindow(p1, "dice.log");
  const p1Lines = p1Log.getByTestId("dice-log-entry");
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(recordId("char-mira", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const crossbow = sheet.getByTestId("charx-attack").filter({ hasText: "Light crossbow" });

  const init = await openWindow(dm, "cbt.initiative");
  const popup = dm.getByTestId("cbt-popup");
  const goblin = await idByName(init, "Goblin");
  const goblin2 = await idByName(init, "Goblin 2");

  // The fixture's card: Pending reads the ruling; it opens in its damage step, waiting.
  const ruledCard = recordId("late-hit-ruled", "notification");
  const ruledRow = init.locator(`[data-testid="cbt-init-card"][data-record-id="${ruledCard}"]`);
  await expect(ruledRow).toHaveAttribute("data-step", "damage");
  await expect(ruledRow).toContainText("Mira: hit Goblin 2 — waiting for damage");
  await ruledRow.click();
  await expect(popup.getByTestId("cbt-popup-step")).toHaveAttribute("data-value", "damage");
  await expect(popup.getByTestId("cbt-popup-tohit-ruled")).toHaveText("15 · hit applied");
  await expect(popup.getByTestId("cbt-popup-waiting")).toBeVisible();
  await expect(popup.getByTestId("cbt-popup-target-row")).toHaveCount(1);
  await expect(popup.getByTestId("cbt-popup-target-add")).toHaveCount(0);
  await expect(popup.getByTestId("cbt-popup-apply")).toBeDisabled();
  // player-1's Damage joins the open popup.
  await crossbow.getByTestId("charx-roll-damage").click();
  await rollPhysical(p1, "5");
  await expect(popup.getByTestId("cbt-popup-waiting")).toHaveCount(0);
  await expect(popup.getByTestId("cbt-popup-damage")).toHaveValue("7");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(p1Lines.last()).toContainText("Mira → Goblin 2: 7 piercing damage");

  /** player-1's to-hit (physical d20 `d20`), then the DM opens its card and targets `target`. */
  const attack = async (d20: string, target: string, text: string) => {
    await crossbow.getByTestId("charx-roll-attack").click();
    await rollPhysical(p1, d20);
    const card = init.getByTestId("cbt-init-card").filter({ hasText: text });
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(popup.getByTestId("cbt-popup-step")).toHaveAttribute("data-value", "to-hit");
    await popup.getByTestId("cbt-popup-target-add").click();
    await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${target}"]`).click();
    return popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${target}"]`);
  };
  /** Apply hit → the damage step; player-1's Damage fills it; Apply → the damage line. */
  const hitThenDamage = async (players: string, name: string) => {
    await popup.getByTestId("cbt-popup-apply-hit").click();
    await expect(popup.getByTestId("cbt-popup-step")).toHaveAttribute("data-value", "damage");
    await expect(p1Lines.last()).toContainText(players);
    await expect(popup.getByTestId("cbt-popup-waiting")).toBeVisible();
    await crossbow.getByTestId("charx-roll-damage").click();
    await rollPhysical(p1, "4");
    await expect(popup.getByTestId("cbt-popup-waiting")).toHaveCount(0);
    await expect(popup.getByTestId("cbt-popup-damage")).not.toHaveValue("");
    await popup.getByTestId("cbt-popup-apply").click();
    await expect(popup).toHaveCount(0);
    await expect(p1Lines.last()).toContainText(`Mira → ${name}:`);
    await expect(p1Lines.last()).toContainText("piercing damage");
  };

  // Natural 20: preset Hit → "Apply hit"; players hear the hit at once; the crit damage fills.
  const nat20 = await attack("20", goblin, "natural 20");
  await expect(nat20.getByTestId("cbt-popup-target-hit")).toHaveAttribute("data-value", "hit");
  await hitThenDamage("(natural 20)", "Goblin");

  // Natural 1: preset Miss; the DM rules a hit (public: "DM ruled hit").
  const nat1 = await attack("1", goblin2, "natural 1");
  const hit = nat1.getByTestId("cbt-popup-target-hit");
  await expect(hit).toHaveAttribute("data-value", "miss");
  await expect(popup.getByTestId("cbt-popup-apply")).toBeVisible();
  await hit.click();
  await hitThenDamage("DM ruled hit", "Goblin 2");

  for (const page of [p1, dm]) await page.context().close();
});
