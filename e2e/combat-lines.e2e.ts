// e2e-bundle: late-damage
// Combat log wording (sprint 5 R2; CBT §13.1 L12–L14), thin, physical dice so the d20s are set:
// L12 Brakka (Rage anyway) Flame Tongue Attack → Apply hit on Goblin → Damage fills → Apply (a
// damage-only line, FR-CBT-91): the DM's line holds Rage inside the slashing run ("incl. + 2 Rage", FR-CBT-96), players' line plain;
// L13 Thorn's Dagger on Goblin 2, Sneak Attack "Not applied" until the DM includes it (BL-45): "+ N piercing (Sneak Attack)" (FR-MOD-62); L14 Mira
// rolls a natural 1, the DM sets Hit: "— DM ruled hit. N piercing damage" for everyone (FR-CBT-58)
// (FR-CBT-95). Every wording case and old rows: bun test (combat-lines.test.ts).
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

/**
 * The open physical-dice form: the first total `first`, every other die 1 (a group of several
 * dice by its per-die inputs: a total of 1 for 2d6 is refused).
 */
async function rollPhysical(page: Page, first: string) {
  const form = page.locator("form").filter({ has: page.getByTestId("dice-manual-label") });
  await expect(form).toBeVisible();
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill(first);
  const rest = form.locator(
    '[data-testid="dice-manual-total"]:not([data-value="0"]), [data-testid="dice-manual-crit-total"], [data-testid="mod-tray-group-total"]',
  );
  for (const input of await rest.all()) {
    const id = (await input.getAttribute("data-testid"))?.replace(/-total$/, "-die");
    const value = await input.getAttribute("data-value");
    const dice = form.locator(`[data-testid="${id}"][data-value="${value}"]`);
    if ((await dice.count()) === 0) await input.fill("1");
    else for (const die of await dice.all()) await die.fill("1");
  }
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
}

/** A character's attack row on its sheet's Actions tab. */
async function attackRow(page: Page, characterId: string, name: string) {
  const sheet = await openWindow(page, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(characterId);
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  return sheet.getByTestId("charx-attack").filter({ hasText: name });
}

const lastLine = async (page: Page) =>
  (await openWindow(page, "dice.log")).getByTestId("dice-log-entry").last();

test.setTimeout(90_000);

test("FR-CBT-96 FR-MOD-62 FR-CBT-95 combat log wording: Rage once in the DM line, Sneak Attack typed, 'DM ruled hit.'", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  for (const page of [p1, p2]) await physicalOn(page);

  const init = await openWindow(dm, "cbt.initiative");
  const popup = dm.getByTestId("cbt-popup");
  const goblin = await idByName(init, "Goblin");
  const goblin2 = await idByName(init, "Goblin 2");
  /** Opens the newest pending card matching `text` and adds `target` (preset Hit / Miss kept). */
  const openCard = async (text: RegExp, target: string) => {
    const card = init.getByTestId("cbt-init-card").filter({ hasText: text });
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(popup).toBeVisible();
    await popup.getByTestId("cbt-popup-target-add").click();
    await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${target}"]`).click();
    return popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${target}"]`);
  };

  // L12: Next → Brakka's turn (Divine Fury: own turn); Rage anyway (uses spent).
  const brakka = await idByName(init, "Brakka");
  await init.getByTestId("cbt-init-next").click();
  await expect(
    init.locator(`[data-testid="cbt-init-row"][data-record-id="${brakka}"]`),
  ).toHaveAttribute("data-turn", "true");
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const rage = sheet.getByTestId("mod-toggle").first();
  await rage.getByRole("switch").click();
  await p1.getByTestId("mod-toggle-overspend-confirm").click();
  await expect(rage).toHaveAttribute("data-state", "on");
  const flameTongue = await attackRow(p1, recordId("char-brakka", "entity"), "Flame Tongue");
  await flameTongue.getByTestId("charx-roll-attack").click();
  await rollPhysical(p1, "15");
  const brakkaRow = await openCard(/Brakka/, goblin);
  await expect(brakkaRow.getByTestId("cbt-popup-target-hit")).toHaveAttribute("data-value", "hit");
  await popup.getByTestId("cbt-popup-apply-hit").click();
  await expect(popup.getByTestId("cbt-popup-step")).toHaveAttribute("data-value", "damage");
  await flameTongue.getByTestId("charx-roll-damage").click();
  await rollPhysical(p1, "7");
  await expect(popup.getByTestId("cbt-popup-waiting")).toHaveCount(0);
  await expect(popup.getByTestId("mod-popup-part")).toHaveAttribute("data-state", "on");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  const dmBrakka = await lastLine(dm);
  await expect(dmBrakka).toContainText(
    /Brakka → Goblin: \d+ slashing \(.*incl\. \+ 2 Rage\) \+ \d+ fire \(half\).* damage \(Flame Tongue greatsword\) \+ \d+ radiant \(Divine Fury\)/,
  );
  await expect(dmBrakka).not.toContainText(") + 2 Rage");
  for (const page of [p1, p2]) {
    await expect(await lastLine(page)).toContainText(
      /Brakka → Goblin: \d+ slashing \+ \d+ fire \(half\) damage \(Flame Tongue greatsword\) \+ \d+ radiant \(Divine Fury\)/,
    );
  }

  // L13: Thorn's Dagger Attack + damage without advantage: Sneak Attack offered unticked (soft
  // mode, FR-MOD-39); the popup says it won't land ("Not applied: …", BL-45); the DM's Include
  // ticks it on Goblin 2 → typed on the line.
  const dagger = await attackRow(p2, recordId("char-thorn", "entity"), "Dagger");
  await dagger.getByTestId("charx-roll-attack-damage").click();
  await rollPhysical(p2, "15");
  const thornRow = await openCard(/Thorn/, goblin2);
  const hit = thornRow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  const sneak = popup.getByTestId("mod-popup-part").filter({ hasText: "Sneak Attack" });
  const chipText = (await sneak.textContent()) ?? "";
  const n = /\+ (\d+) piercing Sneak Attack/.exec(chipText)?.[1];
  expect(n, chipText).toBeDefined();
  await expect(sneak).toHaveAttribute("data-state", "off");
  const skipped = popup.getByTestId("mod-popup-part-skipped");
  await expect(skipped).toContainText(`Not applied: + ${n} piercing Sneak Attack`);
  await skipped.getByTestId("mod-popup-part-include").click();
  await expect(sneak).toHaveAttribute("data-state", "on");
  await expect(skipped).toHaveCount(0);
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  for (const [who, page] of [
    ["dm", dm],
    ["player-2", p2],
  ] as const) {
    const log = await openWindow(page, "dice.log");
    await expect(
      log.getByTestId("dice-log-entry").filter({ hasText: /Thorn attacks Goblin 2/ }),
      who,
    ).toContainText(`+ ${n} piercing (Sneak Attack)`);
  }

  // L14: Mira's crossbow rolls a natural 1 (a computed miss); the DM sets Hit and applies. A
  // ruling against a natural roll is public (FR-CBT-58, -95).
  const crossbow = await attackRow(p1, recordId("char-mira", "entity"), "Light crossbow");
  await crossbow.getByTestId("charx-roll-attack-damage").click();
  await rollPhysical(p1, "1");
  const miraRow = await openCard(/Mira: \d+ to hit \(natural 1\), \d+ piercing/, goblin);
  const miraHit = miraRow.getByTestId("cbt-popup-target-hit");
  await expect(miraHit).toHaveAttribute("data-value", "miss");
  await miraHit.click();
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(await lastLine(dm)).toContainText(
    /Mira attacks Goblin: .*\(natural 1\).*vs AC \d+ — DM ruled hit\. \d+ piercing damage/,
  );
  for (const page of [p1, p2]) {
    await expect(await lastLine(page)).toContainText(
      /Mira attacks Goblin: .*\(natural 1\).* — DM ruled hit\. \d+ piercing damage/,
    );
  }

  for (const page of [p1, p2, dm]) await page.context().close();
});
