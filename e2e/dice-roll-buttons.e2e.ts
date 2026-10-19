// e2e-bundle: dice-polish
// Thin roll-button flows (D9; DICEX §13 sprint 5 walkthrough 34, 36). B (player-1), physical dice
// on: Brakka's Flame Tongue Attack + damage → the form heads its slots "To hit — 1d20+8",
// "Slashing — 2d6+5", "Fire — 2d6", and Alt+click on the same button stages the same labelled
// groups in the tray (FR-DICE-41). Then the Alt hint, exactly once per open surface
// (FR-DICEX-51): A's Initiative row initiative, Attack ▸ trigger tooltip, open Check ▸ / Save ▸
// submenus, Mira's death-save item; B's sheet death save and roll bar Roll; B's Alt+click on the
// roll bar's Roll stages `2d6` (OQ-DICEX-45 A). Last, in combat (only `cbt.attack` doubles on a
// crit; `char.roll` has no crit form), a natural 20 adds "(slashing)" / "(fire)" crit sub-rows.
// Wiring per surface and the non-stageable ones: bun test (`stage-hint.test.tsx`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

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

const manualForm = (page: Page) =>
  page.locator("form").filter({ has: page.getByTestId("dice-manual-label") });

/** Hover `target`: its tooltip opens with the Alt hint, the only one on the page; returns the text. */
async function hintedTooltip(page: Page, target: Locator): Promise<string> {
  await target.hover();
  const tip = page.getByTestId("ui-tooltip");
  await expect(tip).toBeVisible();
  await expect(tip.getByTestId("dicex-stage-hint")).toHaveCount(1);
  await expect(page.getByTestId("dicex-stage-hint")).toHaveCount(1);
  const text = (await tip.textContent()) ?? "";
  await page.mouse.move(2, 2);
  await expect(page.getByTestId("dicex-stage-hint")).toHaveCount(0);
  return text;
}

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

test("FR-DICE-41 FR-DICEX-51 Flame Tongue: the physical form names each part; Alt+click stages the same labelled groups", async ({
  browser,
}) => {
  const { link, recordId } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  await physicalOn(p1);
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const button = sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Flame Tongue" })
    .getByTestId("charx-roll-attack-damage");
  expect(await hintedTooltip(p1, button)).toContain(
    "Shift: advantage · Ctrl: disadvantage · Alt: adjust in tray",
  );

  await button.click();
  const form = manualForm(p1);
  await expect(form.getByTestId("dice-manual-slot-label")).toHaveText([
    "To hit — 1d20+8",
    "Slashing — 2d6+5",
    "Fire — 2d6",
  ]);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);

  // Alt+click the same button: staged, not rolled; the tray's groups carry the same labels.
  await button.click({ modifiers: ["Alt"] });
  await expect(form).toHaveCount(0);
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "adjust");
  await expect(tray.getByTestId("dicex-tray-group-label")).toHaveText([
    "To hit",
    "Slashing",
    "Fire",
  ]);
  await p1.context().close();
});

test("FR-DICEX-51 Alt hint once on every stageable surface; Alt+click on the roll bar's Roll stages it", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // A: Start "Ambush at the Ford"; Mira to 0 HP (dying).
  await dmIntent(dm, secret, "cbt.start", {
    encounterId: recordId("encounter-1", "encounter"),
    sceneId: recordId("battlemap", "scene"),
  });
  // Started over another socket: Initiative isn't fronted here (FR-CBT-60), open it.
  await expect(
    dm.locator('[data-testid="ui-launcher-button"][data-record-id="cbt.initiative"]'),
  ).toBeVisible();
  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.getByTestId("cbt-init-row").first()).toBeVisible();
  const mira = await idByName(init, "Mira");
  const goblin = await idByName(init, "Goblin");
  await dmIntent(dm, secret, "cbt.applyHp", { combatantId: mira, kind: "damage", amount: 99 });

  // A: row initiative (Mira has none yet), Attack ▸ trigger.
  const roll = init.locator(`[data-testid="cbt-init-row-roll"][data-record-id="${mira}"]`);
  expect(await hintedTooltip(dm, roll)).toMatch(
    /^Roll initiative: d20[+-]\d+ \(Shift adv, Ctrl dis\) · Alt: adjust in tray$/,
  );
  const attack = init.locator(`[data-testid="cbt-init-row-attack"][data-record-id="${goblin}"]`);
  expect(await hintedTooltip(dm, attack)).toBe(
    "Attack ▸ · Shift: advantage · Ctrl: disadvantage · Alt: adjust in tray",
  );

  // A: the open Check ▸ / Save ▸ submenus, Mira's death-save item: one line each.
  for (const kind of ["check", "save"]) {
    await init.locator(`[data-testid="cbt-init-row-menu"][data-record-id="${goblin}"]`).click();
    await dm.locator(`[data-testid="cbt-init-row-${kind}"][data-record-id="${goblin}"]`).click();
    const option = dm.locator(`[data-testid="cbt-init-row-${kind}-option"][data-value="str"]`);
    await expect(option).toBeVisible();
    await expect(dm.getByTestId("dicex-stage-hint")).toHaveCount(1);
    await dm.keyboard.press("Escape");
    await dm.keyboard.press("Escape");
    await expect(dm.getByTestId("dicex-stage-hint")).toHaveCount(0);
  }
  await init.locator(`[data-testid="cbt-init-row-menu"][data-record-id="${mira}"]`).click();
  const death = dm.getByTestId("cbtx-init-row-death-roll");
  await expect(death.getByTestId("dicex-stage-hint")).toHaveCount(1);
  await expect(dm.getByTestId("dicex-stage-hint")).toHaveCount(1);
  await dm.keyboard.press("Escape");

  // B: Mira's sheet death save; the roll bar Roll (2d6 typed).
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(recordId("char-mira", "entity"));
  expect(await hintedTooltip(p1, sheet.getByTestId("cbtx-death-roll"))).toContain(
    "Alt: adjust in tray",
  );
  const log = await openWindow(p1, "dice.log");
  await log.getByTestId("dice-roll-expression").fill("2d6");
  const submit = log.getByTestId("dice-roll-submit");
  expect(await hintedTooltip(p1, submit)).toContain(
    "Shift: advantage · Ctrl: disadvantage · Alt: adjust in tray",
  );
  const before = await log.getByTestId("dice-log-entry").count();
  await submit.click({ modifiers: ["Alt"] });
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "compose");
  await expect(tray.locator('[data-testid="dicex-tray-die"][data-faces="6"]')).toHaveCount(2);
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(before); // staged, not rolled

  // B, in combat (the sheet attack routes to `cbt.attack`, which doubles on a crit): Brakka's
  // Flame Tongue, physical, d20 = 20 → each part's crit sub-row names its type (FR-DICE-41).
  await physicalOn(p1);
  await sheet.getByTestId("char-sheet-picker").selectOption(recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Flame Tongue" })
    .getByTestId("charx-roll-attack-damage")
    .click();
  const form = manualForm(p1);
  await expect(form.getByTestId("dice-manual-slot-label")).toHaveText([
    "To hit — 1d20+8",
    "Slashing — 2d6+5",
    "Fire — 2d6",
  ]);
  await form.locator('[data-testid="dice-manual-total"][data-value="0"]').fill("20");
  await expect(form.getByTestId("dice-manual-crit-label")).toHaveText([
    "Extra critical dice: 2d6 (slashing)",
    "Extra critical dice: 2d6 (fire)",
  ]);
  await form.getByRole("button", { name: "Cancel" }).click();

  await dm.context().close();
  await p1.context().close();
});
