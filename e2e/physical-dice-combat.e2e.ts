// e2e-bundle: physical-dice-combat
// Physical dice in combat (BL-19, BL-25; FR-CBT-74, -81, -83, FR-MOD-18, FR-DICE-31): the DM,
// physical dice on, rolls from the Initiative row's Attack ▸ (Alt+click: at once, #385) → the
// entry form opens (it closed at once before) and Roll sends the entries: Goblin's Scimitar, then
// Brakka's Flame Tongue Damage with one entry per part (card "12 slashing + 5 fire"); Check ▸
// opens its form too. Player-1, physical dice on, on Brakka's turn with Rage: Flame Tongue Attack
// (natural 20), then Damage → the
// Divine Fury group sits after the fire part, asks its die plus its extra critical die, and the
// typed values make the offer (no "rolled for you"); the DM applies it to Goblin. Own bundle
// (`rule-triggers` as `physical-dice-combat`). Form rules, part order, crit merge: bun test.
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

/**
 * The DM's Attack ▸ → Attack or Damage (Alt+click: at once) of the attack named `attack` on row
 * `id` (the Damage item sits beside the attack's name item).
 */
async function attackAction(
  dm: Page,
  init: Locator,
  id: string,
  attack: string,
  value: "toHit" | "damage",
) {
  await init.locator(`[data-testid="cbt-init-row-attack"][data-record-id="${id}"]`).click();
  const name = dm
    .locator(
      `[data-testid="cbt-init-row-attack-option"][data-record-id="${id}"][data-value="toHit"]`,
    )
    .filter({ hasText: attack });
  const attackId = await name.getAttribute("data-attack-id");
  await rollNow(
    dm.locator(
      `[data-testid="cbt-init-row-attack-option"][data-record-id="${id}"][data-value="${value}"][data-attack-id="${attackId}"]`,
    ),
  );
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

  // Goblin: Attack ▸ → Attack → the form; Roll → the card's popup; Later; Damage → its form →
  // the same card.
  await attackAction(dm, init, goblin, "Scimitar", "toHit");
  await expect(form.getByTestId("dice-manual-label")).toHaveText("Goblin — Scimitar attack");
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("11");
  await fillBonusDice(form);
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
  await expect(popup).toBeVisible();
  await popup.getByTestId("cbt-popup-later").click();
  await expect(popup).toHaveCount(0);
  await attackAction(dm, init, goblin, "Scimitar", "damage");
  await expect(form.getByTestId("dice-manual-label")).toHaveText("Goblin — Scimitar damage");
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("3");
  await fillBonusDice(form);
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("cbt-popup-waiting-damage")).toHaveCount(0);
  await popup.getByTestId("cbt-popup-dismiss").click();
  await expect(popup).toHaveCount(0);

  // Brakka's Flame Tongue: to-hit and base carry the +1, the fire part is its own entry.
  const card = init.getByTestId("cbt-init-card");
  await attackAction(dm, init, brakka, "Flame Tongue", "toHit");
  await expect(form.getByTestId("dice-manual-label")).toHaveText(
    "Brakka — Flame Tongue greatsword attack",
  );
  await expect(form.locator("code")).toHaveText(["1d20+8"]);
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("10");
  await fillBonusDice(form);
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
  await expect(popup).toBeVisible();
  await popup.getByTestId("cbt-popup-later").click();
  await expect(card).toHaveCount(1);
  await attackAction(dm, init, brakka, "Flame Tongue", "damage");
  await expect(form.getByTestId("dice-manual-label")).toHaveText(
    "Brakka — Flame Tongue greatsword damage",
  );
  await expect(form.locator("code")).toHaveText(["2d6+5", "2d6"]);
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("7");
  await form.locator('[data-testid="dice-manual-total"][data-value="1"]').fill("5");
  await fillBonusDice(form);
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
  await expect(popup).toBeVisible();
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

  // Player 1: Rage on, physical dice on, Flame Tongue (added by the first test) Attack, natural
  // 20 (Alt+click: at once, #385).
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const rage = sheet.getByTestId("mod-toggle").first();
  await rage.getByRole("switch").click();
  await expect(rage).toHaveAttribute("data-state", "on");
  await physicalOn(p1);
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const flame = sheet.getByTestId("charx-attack").filter({ hasText: "Flame Tongue" });
  const p1Log = await openWindow(p1, "dice.log");
  const lines = await p1Log.getByTestId("dice-log-entry").count();
  await rollNow(flame.getByTestId("charx-roll-attack"));
  const form = manualForm(p1);
  await expect(form.getByTestId("dice-manual-label")).toHaveText(
    "Brakka — Flame Tongue greatsword attack",
  );
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("20");
  await form.getByTestId("dice-manual-submit").click();
  await expect(form).toHaveCount(0);
  // The card reaches player-1 with its log line: Damage then knows the crit (FR-CBT-74).
  await expect(p1Log.getByTestId("dice-log-entry")).toHaveCount(lines + 1);
  await expect(init.getByTestId("cbt-init-card")).toContainText("natural 20");

  // Damage: every part gets its extra critical dice, Divine Fury too; its group comes last.
  await rollNow(flame.getByTestId("charx-roll-damage"));
  await expect(form.getByTestId("dice-manual-label")).toHaveText(
    "Brakka — Flame Tongue greatsword damage",
  );
  const fury = form.locator('[data-testid="mod-tray-group"][data-value^="t:"]');
  await expect(fury).toHaveCount(1);
  await expect(fury.getByTestId("mod-tray-group-label")).toHaveText(
    "Divine Fury (on a hit): 1d6+2",
  );
  await expect(form).not.toContainText("optional");

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
    [0, "7", "6"],
    [1, "5", "4"],
  ] as const) {
    await form.locator(`[data-testid="dice-manual-total"][data-value="${i}"]`).fill(base);
    await form.locator(`[data-testid="dice-manual-crit-total"][data-value="${i}"]`).fill(extra);
  }
  // Roll without the Divine Fury dice → asked for them, nothing sent.
  await form.getByTestId("dice-manual-submit").click();
  await expect(form.getByTestId("dice-manual-error")).toHaveText(
    "Enter the total for Divine Fury (1d6+2)",
  );
  // BL-45: the empty group is marked and focused, again on every Roll; typing clears the mark.
  const furyTotal = fury.getByTestId("mod-tray-group-total");
  await expect(fury).toHaveAttribute("data-state", "invalid");
  await expect(furyTotal).toHaveAttribute("aria-invalid", "true");
  await expect(furyTotal).toBeFocused();
  await form.getByTestId("dice-manual-submit").click();
  await expect(furyTotal).toBeFocused();
  await expect(form.getByTestId("dice-manual-error")).toBeVisible();
  await furyTotal.fill("3");
  await expect(fury).not.toHaveAttribute("data-state", "invalid");
  await expect(form.getByTestId("dice-manual-error")).toHaveCount(0);
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
