// e2e-bundle: tray-attacks
// Thin Use-as flow (CBT §13.8 S4, T12 / T10 in short; FR-DICE-97, FR-CBT-174): player-1's plain
// "1d8+1d6" roll as themselves (two PCs: Mira, Brakka) has no Use-as action for the player; the
// DM's line → Use as damage → the popup's Use roll step (Attacker unset, one Type "No type") →
// Mira, piercing → Make card → the popup continues on Mira's card "Damage, piercing"; the line's
// actions are gone. Resolve rules, refusals, visibility, reconnect: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSelect } from "./support/select";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });
const useAs = (row: Locator) => row.locator('[data-testid="dice-log-action"][data-value^="cbt."]');

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

test("FR-DICE-97 FR-CBT-174 DM uses a player's 'me' roll as damage: step → Mira, piercing → card; players get no action", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // Player 1: the line, no Use-as action (hovered or not).
  const p1Log = await openWindow(p1, "dice.log");
  const p1Row = line(p1Log, "1d8+1d6");
  await expect(p1Row).toHaveCount(1);
  await p1Row.hover();
  await expect(useAs(p1Row)).toHaveCount(0);

  const init = await openWindow(dm, "cbt.initiative");
  const mira = await idByName(init, "Mira");
  const log = await openWindow(dm, "dice.log");
  const row = line(log, "1d8+1d6");
  await expect(row).toHaveCount(1);
  await row.hover();
  // A plain roll without a d20: damage only.
  await expect(useAs(row)).toHaveCount(1);
  const action = row.locator('[data-testid="dice-log-action"][data-value="cbt.useAsDamage"]');
  await expect(action).toHaveAttribute("aria-label", "Use as damage");
  await action.click();

  // Two PCs for Player 1: the step, nothing written yet.
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup.getByTestId("cbt-popup-step")).toHaveAttribute("data-value", "use-roll");
  await expect(popup.getByTestId("cbt-popup-use-attacker")).toHaveAttribute("data-value", "");
  const type = popup.getByTestId("cbt-popup-use-type");
  await expect(type).toHaveCount(1);
  await expect(type).toHaveAttribute("data-value", "none");
  const make = popup.getByTestId("cbt-popup-use-confirm");
  await expect(make).toBeDisabled();
  await pickSelect(popup, "cbt-popup-use-attacker", { value: mira });
  await pickSelect(popup, "cbt-popup-use-type", { value: "piercing" });
  await expect(make).toBeEnabled();
  await make.click();

  // The popup continues on the card (Mira's, no pending to-hit → damage only).
  await expect(popup.getByTestId("cbt-popup-use")).toHaveCount(0);
  await expect(popup).toHaveAttribute("data-record-id", /.+/);
  await expect(popup.getByTestId("cbt-popup-drag")).toContainText("Mira — Damage");
  await expect(popup).toContainText("Damage, piercing");
  await popup.getByTestId("cbt-popup-later").click();
  await expect(popup).toHaveCount(0);

  // Used: the line's actions are gone.
  await row.hover();
  await expect(useAs(row)).toHaveCount(0);
});
