// e2e-bundle: tray-attacks
// Thin tray attacks S2 flow (CBT §13.8 T1–T2; FR-DICEX-99, -101, -102, FR-CBT-172): Player 1
// composes a free roll in the Dice tray as Brakka (an active combatant): d20 + 9, purpose Attack →
// a rowless to-hit card in the DM's Pending; then 2d6, purpose Damage, type slashing → the same
// card completed. Rules, routes, crit and limits: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSelect } from "./support/select";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** The tray's Options row → roll as `entityId`. */
async function rollAs(tray: Locator, entityId: string) {
  const options = tray.getByTestId("dicex-tray-options");
  if ((await options.getAttribute("aria-expanded")) !== "true") await options.click();
  await pickSelect(tray, "dicex-tray-actor", { value: entityId });
}

test("FR-CBT-172 FR-DICEX-99 FR-DICEX-101 free Attack then Damage as Brakka → one completed card", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const brakka = recordId("char-brakka", "entity");
  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.getByTestId("cbt-init-card")).toHaveCount(0);

  // T1: d20, constant 9, purpose Attack, as Brakka (two own PCs fight: no preset), Roll.
  const tray = await openWindow(p1, "dicex.tray");
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="20"]').click();
  await tray.getByTestId("dicex-tray-constant").fill("9");
  await tray.locator('[data-testid="dicex-tray-purpose-option"][data-value="attack"]').click();
  await expect(tray.getByTestId("dicex-tray-purpose")).toHaveAttribute("data-value", "attack");
  await rollAs(tray, brakka);
  await expect(tray.getByTestId("dicex-tray-state")).toContainText("Brakka — Attack");
  await tray.getByTestId("dicex-tray-roll").click();

  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(/Brakka: \d+ to hit \(Attack\)/);
  const p1Log = await openWindow(p1, "dice.log");
  await expect(
    p1Log.getByTestId("dice-log-entry").filter({ hasText: /Brakka — attack: /i }),
  ).toHaveCount(1);

  // T2: a fresh 2d6, Damage, type slashing, as Brakka → completes the card (rowless match).
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="6"]').click();
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="6"]').click();
  await tray.locator('[data-testid="dicex-tray-purpose-option"][data-value="damage"]').click();
  await pickSelect(tray, "dicex-tray-group-type", { value: "slashing" });
  await expect(tray.getByTestId("dicex-tray-group-type")).toHaveAttribute(
    "data-record-id",
    "6:slashing",
  );
  await rollAs(tray, brakka);
  await tray.getByTestId("dicex-tray-roll").click();

  await expect(card).toHaveCount(1);
  await expect(card).toContainText(/\d+ slashing/);
  await expect(
    p1Log
      .getByTestId("dice-log-entry")
      .filter({ hasText: /Brakka — damage: \d+ \+ \d+ slashing/i }),
  ).toHaveCount(1);
});
