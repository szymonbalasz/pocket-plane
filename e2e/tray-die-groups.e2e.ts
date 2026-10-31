// e2e-bundle: tray-attacks
// Thin die groups flow (FR-DICEX-105, -106): Player 1 composes a damage roll in the Dice tray: a d6
// piercing +3, then "+ Group" → a second d6, lightning +2 (one size, two rows); the log line and the
// thrown dice carry both types. Composition rules, limits and effects: bun test.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { pickSelect } from "./support/select";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-DICEX-105 FR-DICEX-106 1d6+3 piercing with 1d6+2 lightning", async ({ browser }) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const tray = await openWindow(p1, "dicex.tray");
  const log = await openWindow(p1, "dice.log");
  const palette = (faces: number) =>
    tray.locator(`[data-testid="dicex-tray-palette"][data-value="${faces}"]`);

  await palette(6).click();
  await tray.locator('[data-testid="dicex-tray-purpose-option"][data-value="damage"]').click();
  await expect(tray.getByTestId("dicex-tray-constant")).toHaveCount(0);
  await pickSelect(tray, "dicex-tray-group-type", { value: "piercing" });
  await tray.getByTestId("dicex-tray-group-constant").fill("+3");

  // "+ Group", pick its type, then the same die size: a second row, nothing joins the first.
  await tray.getByTestId("dicex-tray-add-group").click();
  await pickSelect(tray, "dicex-tray-new-group-type", { value: "lightning" });
  await palette(6).click();
  const rows = tray.getByTestId("dicex-tray-group");
  await expect(rows).toHaveCount(2);
  await expect(tray.getByTestId("dicex-tray-new-group-type")).toHaveCount(0);
  await expect(rows.first().getByTestId("dicex-tray-die")).toHaveCount(1);
  await expect(rows.nth(1).getByTestId("dicex-tray-die")).toHaveCount(1);
  await tray
    .locator('[data-testid="dicex-tray-group-constant"][data-record-id="6:lightning"]')
    .fill("2");
  await expect(tray.getByTestId("dicex-tray-expression")).toHaveValue("1d6+3+1d6+2");

  // The rows' columns stay put when a type's label changes.
  const die = rows.first().getByTestId("dicex-tray-die");
  const before = await die.boundingBox();
  await pickSelect(rows.first(), "dicex-tray-group-type", { value: "bludgeoning" });
  expect(await die.boundingBox()).toEqual(before);
  await pickSelect(rows.first(), "dicex-tray-group-type", { value: "piercing" });
  expect(await die.boundingBox()).toEqual(before);

  await tray.getByTestId("dicex-tray-roll").click();
  await expect(
    log
      .getByTestId("dice-log-entry")
      .filter({ hasText: /piercing/ })
      .filter({ hasText: /lightning/ }),
  ).toHaveCount(1);
  // Every client reads the types off the roll; in the throw and its popup alike.
  await expect(
    p1.locator('[data-testid="dicex-throw-die"][data-damage="lightning"]').first(),
  ).toBeAttached();
  await p1.context().close();
});
