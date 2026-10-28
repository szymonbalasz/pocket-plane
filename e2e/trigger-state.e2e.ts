// e2e-bundle: session-sim-7
// Thin trigger-state flow (MOD §13.1 steps 1–5, S4-3; FR-MOD-53–56, -60): player-1's Brakka →
// Active effects: Divine Fury "Not in effect — needs Rage"; Rage on → "On Brakka's turn" (the
// Wolf's turn); DM Next → "Ready"; Alt+click Greataxe Attack + damage → the tray offers "Divine
// Fury (on a hit)" → Roll → the DM applies it to Goblin → "Used this turn"; a second Alt+click
// the same turn → no Divine Fury in the tray (sim-7 glitch 11). Own server: `session-sim-7` has
// no other spec. Writes on every path, visibility and leaks: bun test (effect-modifiers).
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

test("FR-MOD-60 FR-MOD-56 FR-MOD-53 Divine Fury's state in the sheet; the tray stops offering it once used this turn", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // Player 1: Brakka's sheet → Active effects → Divine Fury needs Rage.
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, recordId("char-brakka", "entity"));
  const effectsTab = sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]');
  const actionsTab = sheet.locator('[data-testid="charx-tab"][data-value="actions"]');
  await effectsTab.click();
  const state = sheet.getByTestId("mod-triggers-block").getByTestId("mod-trigger-state");
  await expect(state).toHaveAttribute("data-state", "off");
  await expect(state).toHaveText("Not in effect — needs Rage");

  // Rage on during the Wolf's turn → armed, waiting for her turn.
  const rage = sheet.getByTestId("mod-toggle").first();
  await rage.getByRole("switch").click();
  await expect(rage).toHaveAttribute("data-state", "on");
  await expect(state).toHaveAttribute("data-state", "waiting");
  await expect(state).toHaveText("On Brakka's turn");

  // DM: Next (Wolf → Brakka) → Ready.
  const init = await openWindow(dm, "cbt.initiative");
  const brakka = await idByName(init, "Brakka");
  await init.getByTestId("cbt-init-next").click();
  await expect(
    init.locator(`[data-testid="cbt-init-row"][data-record-id="${brakka}"]`),
  ).toHaveAttribute("data-turn", "true");
  await expect(state).toHaveAttribute("data-state", "ready");
  await expect(state).toHaveText("Ready");

  // Alt+click Greataxe Attack + damage → the tray offers Divine Fury's die → Roll.
  await actionsTab.click();
  const greataxe = sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Greataxe" })
    .getByTestId("charx-roll-attack-damage");
  await greataxe.click({ modifiers: ["Alt"] });
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "adjust");
  const fury = tray.getByTestId("dicex-tray-extra").filter({ hasText: "Divine Fury (on a hit)" });
  await expect(fury).toHaveCount(1);
  await tray.getByTestId("dicex-tray-roll").click();

  // DM: the card → Goblin, Hit, the Divine Fury chip ticked → Apply.
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
  await expect(trow.getByTestId("mod-popup-part")).toHaveAttribute("data-state", "on");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);

  // Used this turn: the sheet says so, and the tray no longer offers it.
  await effectsTab.click();
  await expect(state).toHaveAttribute("data-state", "used");
  await expect(state).toHaveText("Used this turn");
  await actionsTab.click();
  await greataxe.click({ modifiers: ["Alt"] });
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "adjust");
  await expect(tray.locator('[data-testid="dicex-tray-die"][data-faces="12"]')).toHaveCount(1);
  await expect(tray.getByText("Divine Fury")).toHaveCount(0);

  for (const page of [p1, dm]) await page.context().close();
});
