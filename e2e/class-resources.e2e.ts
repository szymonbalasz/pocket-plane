// e2e-bundle: class-resources
// Pact slots and pact weapons (class-resources FR-CRES-01–04, -14): Player 1 ticks a pact slot
// and a 1st-level slot on Vex's own sheet; the DM sees both live; the DM's short rest gives the
// pact slot back and keeps the 1st-level one; the pact weapon row shows its chip, and the DM's
// editor has the pact fields. Rules, clamps, refusals and the trigger filter: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const tab = (win: Locator, value: string) =>
  win.locator(`[data-testid="charx-tab"][data-value="${value}"]`).click();

const pactPip = (win: Locator) => win.getByTestId("cres-pact-pip").first();
const slotPip = (win: Locator, level: string) =>
  win.locator(`[data-testid="charx-slot"][data-value="${level}"]`).first();

test("FR-CRES-02 FR-CRES-03 FR-CRES-04 FR-CRES-14 pact slots: player ticks, DM sees live, short rest gives them back; pact weapon chip", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const vex = recordId("char-vex", "entity");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);

  // Player 1's own sheet: 2 pact pips (Pact 1st), none used; the pact blade has its chip.
  const own = await openWindow(p1, "char.sheet");
  await expect(own.getByTestId("char-sheet")).toHaveAttribute("data-record-id", vex);
  await tab(own, "actions");
  await expect(own.getByTestId("cres-pact-pips").first()).toContainText("Pact 1st");
  await expect(own.getByTestId("cres-pact-pip")).toHaveCount(2);
  await expect(pactPip(own)).toHaveAttribute("data-used", "0");
  await expect(
    own
      .getByTestId("charx-attack")
      .filter({ hasText: "Pact blade" })
      .getByTestId("cres-pact-weapon"),
  ).toHaveText("Pact");
  await expect(
    own.getByTestId("charx-attack").filter({ hasText: "Dagger" }).getByTestId("cres-pact-weapon"),
  ).toHaveCount(0);

  // Tick one pact slot and one 1st-level slot.
  await pactPip(own).click();
  await expect(pactPip(own)).toHaveAttribute("data-used", "1");
  await slotPip(own, "1").click();
  await expect(slotPip(own, "1")).toHaveAttribute("data-used", "1");

  // The DM's sheet shows both, live.
  const sheet = await openWindow(dm, "char.sheet");
  await pickSheet(sheet, vex);
  await tab(sheet, "actions");
  await expect(pactPip(sheet)).toHaveAttribute("data-used", "1");
  await expect(slotPip(sheet, "1")).toHaveAttribute("data-used", "1");

  // DM: short rest → pact back, the 1st-level slot stays spent (player's sheet too).
  await sheet.getByTestId("charx-rest").click();
  const pop = dm.getByTestId("charx-rest-popover");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("pact slots");
  await dm.getByTestId("charx-rest-confirm").click();
  await expect(pop).toHaveCount(0);
  await expect(pactPip(sheet)).toHaveAttribute("data-used", "0");
  await expect(slotPip(sheet, "1")).toHaveAttribute("data-used", "1");
  await expect(pactPip(own)).toHaveAttribute("data-used", "0");
  await expect(slotPip(own, "1")).toHaveAttribute("data-used", "1");

  // DM edit mode: the pact fields and the pact weapon box.
  await sheet.getByTestId("charx-edit-toggle").click();
  await expect(sheet.getByTestId("cres-pact-editor")).toBeVisible();
  await expect(
    sheet.locator('[data-testid="cres-pact-weapon"][role="checkbox"]').first(),
  ).toHaveAttribute("data-state", "checked");

  await dm.context().close();
  await p1.context().close();
});

test("FR-CRES-06 FR-CRES-07 FR-CRES-08 Flexible Casting: create a slot, convert a pact slot, created slot spent first, gone on a long rest", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const vex = recordId("char-vex", "entity");
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const own = await openWindow(p1, "char.sheet");
  await expect(own.getByTestId("char-sheet")).toHaveAttribute("data-record-id", vex);

  const font = () => own.getByTestId("charx-feature").filter({ hasText: "Font of Magic" }).first();
  const left = () => font().getByTestId("charx-feature-left");
  const menu = p1.getByTestId("cres-convert-menu");
  await tab(own, "features");
  await expect(left()).toHaveAttribute("data-value", "5");

  // Full points: converting is disabled; creating a 1st-level slot costs 2.
  await font().getByTestId("cres-convert").click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-testid="cres-convert-slot"][data-value="pact"]')).toBeDisabled();
  await expect(menu.locator('[data-testid="cres-create-slot"][data-value="3"]')).toBeEnabled();
  await expect(menu.locator('[data-testid="cres-create-slot"][data-value="4"]')).toBeDisabled();
  await menu.locator('[data-testid="cres-create-slot"][data-value="1"]').click();
  await expect(menu).toHaveCount(0);
  await expect(left()).toHaveAttribute("data-value", "3");

  // Pact slot → +1 point.
  await font().getByTestId("cres-convert").click();
  await menu.locator('[data-testid="cres-convert-slot"][data-value="pact"]').click();
  await expect(left()).toHaveAttribute("data-value", "4");

  // Actions: one created 1st-level pip; ticking the level spends it first.
  await tab(own, "actions");
  await expect(pactPip(own)).toHaveAttribute("data-used", "1");
  const created = own.locator('[data-testid="cres-created-pip"][data-value="1"]');
  await expect(created).toHaveCount(1);
  // The first test left one 1st-level slot spent; ticking takes the created slot instead.
  const usedBefore = (await slotPip(own, "1").getAttribute("data-used")) ?? "";
  await slotPip(own, "1").click();
  await expect(created).toHaveCount(0);
  await expect(slotPip(own, "1")).toHaveAttribute("data-used", usedBefore);

  // A second created slot, then the DM's long rest: gone, points back to 5.
  await tab(own, "features");
  await font().getByTestId("cres-convert").click();
  await menu.locator('[data-testid="cres-create-slot"][data-value="1"]').click();
  await expect(left()).toHaveAttribute("data-value", "2");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const sheet = await openWindow(dm, "char.sheet");
  await pickSheet(sheet, vex);
  await sheet.getByTestId("charx-rest").click();
  await dm.locator('[data-testid="charx-rest-kind"][data-value="long"]').click();
  await dm.getByTestId("charx-rest-confirm").click();
  await expect(left()).toHaveAttribute("data-value", "5");
  await tab(own, "actions");
  await expect(own.getByTestId("cres-created-pip")).toHaveCount(0);
  await dm.context().close();
  await p1.context().close();
});
