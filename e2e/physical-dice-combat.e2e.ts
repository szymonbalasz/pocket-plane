// e2e-bundle: physical-dice-combat
// Physical dice in combat (BL-19, BL-25; FR-CBT-74, -81, -83, FR-MOD-18, FR-DICE-31): the DM,
// physical dice on, rolls from the Initiative row's Attack ▸ → the entry form opens (it closed
// at once before) and Roll sends the entries: Goblin's Scimitar, then Brakka's Flame Tongue with
// one entry per part (card "12 slashing + 5 fire"); Check ▸ opens its form too. Player-1,
// physical dice on, on Brakka's turn with Rage: Flame Tongue Attack + damage, natural 20 → the
// Divine Fury group sits after the fire part, asks its die plus its extra critical die, and the
// typed values make the offer (no "rolled for you"); the DM applies it to Goblin. Own bundle
// (`rule-triggers` as `physical-dice-combat`). Form rules, part order, crit merge: bun test.
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

/** Setup: one DM intent over a socket of its own (hello → snapshot → intent → ack result). */
function dmIntent(page: Page, secret: string, name: string, payload: unknown) {
  return page.evaluate(
    ([secret, name, payload]) =>
      new Promise<unknown>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; result?: unknown };
          if (f.type === "snapshot") {
            ws.send(
              JSON.stringify({ type: "intent", intentId: crypto.randomUUID(), name, payload }),
            );
          } else if (f.type === "ack") {
            ws.close();
            resolve(f.result);
          } else if (f.type === "reject" || f.type === "error") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [secret, name, payload] as const,
  );
}

/** Physical dice on in this client (dice log Options). */
async function physicalOn(page: Page) {
  const log = await openWindow(page, "dice.log");
  const options = log.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  await log.getByTestId("dice-roll-physical").click();
  await expect(log.getByTestId("dice-roll-physical")).toHaveAttribute("data-state", "checked");
}

/** The open physical-dice form of `page`. */
const manualForm = (page: Page) =>
  page.locator("form").filter({ has: page.getByTestId("dice-manual-label") });

/** Bonus-die groups the fixture's effects add (Goblin's Bane): 1 each. */
async function fillBonusDice(form: Locator) {
  const groups = form.locator('[data-testid="mod-tray-group-total"][data-value^="e:"]');
  for (const input of await groups.all()) await input.fill("1");
}

/** The DM's Attack ▸ → Attack + damage of the attack named `attack` on row `id`. */
async function attackBoth(dm: Page, init: Locator, id: string, attack: string) {
  await init.locator(`[data-testid="cbt-init-row-attack"][data-record-id="${id}"]`).click();
  await dm
    .locator(
      `[data-testid="cbt-init-row-attack-option"][data-record-id="${id}"][data-value="both"]`,
    )
    .filter({ hasText: attack })
    .click();
}

test("BL-19 FR-CBT-74 FR-CBT-81 DM physical Attack ▸ from the Initiative row: the form opens, Roll sends one entry per part", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  await dmIntent(dm, secret, "char.putRow", {
    creatureId: recordId("char-brakka", "entity"),
    list: "attacks",
    row: {
      name: "Flame Tongue greatsword",
      toHit: 7,
      damage: "2d6+4",
      damageType: "slashing",
      bonus: 1,
      extraDamage: [{ damage: "2d6", type: "fire" }],
    },
  });
  await physicalOn(dm);
  const init = await openWindow(dm, "cbt.initiative");
  const goblin = await idByName(init, "Goblin");
  const brakka = await idByName(init, "Brakka");
  const form = manualForm(dm);
  const popup = dm.getByTestId("cbt-popup");

  // Goblin: Attack ▸ → Attack + damage (plain click) → the form; Roll → the card's popup.
  await attackBoth(dm, init, goblin, "Scimitar");
  await expect(form.getByTestId("dice-manual-label")).toHaveText("Goblin — Scimitar attack");
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("11");
  await form.locator('[data-testid="dice-manual-total"][data-value="1"]').fill("3");
  await fillBonusDice(form);
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
  await expect(popup).toBeVisible();
  await popup.getByTestId("cbt-popup-dismiss").click();
  await expect(popup).toHaveCount(0);

  // Brakka's Flame Tongue: to-hit and base carry the +1, the fire part is its own entry.
  await attackBoth(dm, init, brakka, "Flame Tongue");
  await expect(form.getByTestId("dice-manual-label")).toHaveText(
    "Brakka — Flame Tongue greatsword attack",
  );
  await expect(form.locator("code")).toHaveText(["1d20+8", "2d6+5", "2d6"]);
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("10");
  await form.locator('[data-testid="dice-manual-total"][data-value="1"]').fill("7");
  await form.locator('[data-testid="dice-manual-total"][data-value="2"]').fill("5");
  await fillBonusDice(form);
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
  await expect(popup).toBeVisible();
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("18 to hit, 12 slashing + 5 fire");
  await popup.getByTestId("cbt-popup-dismiss").click();
  await expect(card).toHaveCount(0);

  // Check ▸ Strength opens its form too (same menu-anchor path); Cancel sends nothing.
  await init.locator(`[data-testid="cbt-init-row-menu"][data-record-id="${goblin}"]`).click();
  await dm.locator(`[data-testid="cbt-init-row-check"][data-record-id="${goblin}"]`).click();
  await dm
    .locator(
      `[data-testid="cbt-init-row-check-option"][data-record-id="${goblin}"][data-value="str"]`,
    )
    .click();
  await expect(form.getByTestId("dice-manual-label")).toHaveText("Goblin — Strength check");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);

  await dm.context().close();
});

test("BL-25 FR-MOD-18 FR-DICE-31 physical Flame Tongue crit: the Divine Fury die is typed in (after the fire part, with its extra critical die)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // DM: Next → Brakka's turn (Divine Fury ready once Rage is on).
  const init = await openWindow(dm, "cbt.initiative");
  const brakka = await idByName(init, "Brakka");
  await init.getByTestId("cbt-init-next").click();
  await expect(
    init.locator(`[data-testid="cbt-init-row"][data-record-id="${brakka}"]`),
  ).toHaveAttribute("data-turn", "true");

  // Player 1: Rage on, physical dice on, Flame Tongue (added by the first test) Attack + damage.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const rage = sheet.getByTestId("mod-toggle").first();
  await rage.getByRole("switch").click();
  await expect(rage).toHaveAttribute("data-state", "on");
  await physicalOn(p1);
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Flame Tongue" })
    .getByTestId("charx-roll-attack-damage")
    .click();
  const form = manualForm(p1);
  await expect(form.getByTestId("dice-manual-label")).toHaveText(
    "Brakka — Flame Tongue greatsword attack + damage",
  );
  const fury = form.locator('[data-testid="mod-tray-group"][data-value^="t:"]');
  await expect(fury).toHaveCount(1);
  await expect(fury.getByTestId("mod-tray-group-label")).toHaveText(
    "Divine Fury (on a hit): 1d6+2",
  );
  await expect(form).not.toContainText("optional");

  // Natural 20: every part gets its extra critical dice, Divine Fury too; its group comes last.
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("20");
  await expect(form.getByTestId("dice-manual-crit")).toHaveCount(2);
  await expect(fury.getByTestId("mod-tray-group-crit-label")).toHaveText(
    "Extra critical dice: 1d6",
  );
  const order = await form.evaluate((f) => {
    const ids = [...f.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));
    return { fire: ids.lastIndexOf("dice-manual-crit-total"), fury: ids.indexOf("mod-tray-group") };
  });
  expect(order.fury).toBeGreaterThan(order.fire);
  for (const [i, base, extra] of [
    [1, "7", "6"],
    [2, "5", "4"],
  ] as const) {
    await form.locator(`[data-testid="dice-manual-total"][data-value="${i}"]`).fill(base);
    await form.locator(`[data-testid="dice-manual-crit-total"][data-value="${i}"]`).fill(extra);
  }
  // Roll without the Divine Fury dice → asked for them, nothing sent.
  await form.getByTestId("dice-manual-submit").click();
  await expect(form.getByTestId("dice-manual-error")).toHaveText(
    "Enter the total for Divine Fury (1d6+2)",
  );
  await fury.getByTestId("mod-tray-group-total").fill("3");
  await fury.getByTestId("mod-tray-group-crit-total").fill("2");
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);

  // The offer carries the typed dice: 3 + 2 + 2 = 7 radiant; the DM applies it to Goblin.
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("+ 7 radiant Divine Fury on a hit");
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  const goblin = await idByName(init, "Goblin");
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await expect(trow.getByTestId("mod-popup-part")).toHaveAttribute("data-state", "on");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  for (const page of [dm, p1]) {
    const log = await openWindow(page, "dice.log");
    const entries = log.getByTestId("dice-log-entry");
    await expect(entries.filter({ hasText: "+ 7 radiant (Divine Fury)" })).toHaveCount(1);
    await expect(entries.filter({ hasText: "rolled for you" })).toHaveCount(0);
  }

  await p1.context().close();
  await dm.context().close();
});
