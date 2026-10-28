// e2e-bundle: s14-kit-e2e
// Thin sprint 14 F3 flows (kit nits; BL-138, BL-139, BL-141). The DM with sim-12's pending rows
// (the "N pending actions" summary) at 1280×720 opens the Compendium's modal homebrew dialog over
// the home column (F2 walkthrough side finding: the summary sat on its Name field): the summary
// goes compact (FR-NOTE-79) left of the dialog, off it, and the Name field takes the click.
// Placement rules: bun test (`keep-out-compact.test.ts`). The DM's sheet (BL-139): the name picker
// opens the shared Select's menu (Party heading, items by record id); the Actions tab's Attacks
// box has no public switch, the header's Public rolls menu has Attack and Damage.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** The element at `l`'s centre is `l` (or inside it): nothing drawn over it. */
const onTop = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!at && (el === at || el.contains(at));
  });

async function dmAt(browser: Parameters<typeof rolePage>[0], width: number, height: number) {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width, height });
  await loginDm(dm, secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  return dm;
}

test("FR-NOTE-79 FR-NOTE-76 F2 side finding DM 1280×720: the modal homebrew dialog over the home column → the summary goes compact, left of the dialog, off its Name field", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1280, 720);
  const win = await openWindow(dm, "cmp.compendium");
  await win.getByTestId("cmp-new").click();
  const form = dm.getByTestId("cmp-form");
  await expect(form).toBeVisible();
  const stack = dm.getByTestId("note-toasts");
  const summary = dm.getByTestId("note-toast-pending-summary");
  await expect(summary).toHaveAttribute("data-compact", "true");
  await expect(stack).toHaveAttribute("data-settled", "true");
  await expect
    .poll(async () => overlaps(await box(stack), await box(form)), { timeout: 3_000 })
    .toBe(false);
  const s = await box(stack);
  const f = await box(form);
  expect(s.x + s.w).toBeLessThanOrEqual(f.x);
  expect(s.x).toBeGreaterThanOrEqual(80);
  // One short line, with Open still one click away.
  expect(s.h).toBeLessThanOrEqual(44);
  await expect(summary.getByTestId("note-toast-open")).toBeVisible();
  const name = form.getByTestId("cmp-form-name");
  expect(await onTop(name)).toBe(true);
  await name.click();
  await name.fill("Lamp 7");
  await expect(name).toHaveValue("Lamp 7");
});

test("FR-CHAR-02 FR-CHARX-114 BL-139 DM sheet: the name picker is the shared Select's menu; Attack / Damage switches in the header's Public rolls menu, none in the Attacks box", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "char.sheet");
  const brakka = recordId("char-brakka", "entity");
  const mira = recordId("char-mira", "entity");
  await pickSheet(win, brakka);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", brakka);
  // The list is the shared Select's (no native select anywhere in the sheet).
  await expect(win.locator("select[data-testid=char-sheet-picker]")).toHaveCount(0);
  await win.getByTestId("char-sheet-picker").click();
  const menu = dm.locator('[data-slot="select-content"]');
  await expect(menu).toBeVisible();
  await expect(
    menu
      .locator('[data-testid="char-sheet-picker-option"]')
      .and(dm.locator(`[data-value="${mira}"]`)),
  ).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await pickSheet(win, mira);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", mira);

  // Actions tab: no switch in the Attacks box.
  await win.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await expect(win.locator('[data-testid="charx-attack"]').first()).toBeVisible();
  await expect(win.getByTestId("charx-public-attack")).toHaveCount(0);
  // The header menu: Attack and Damage after the others; flipping Attack marks the menu.
  await win.getByTestId("charx-public-menu").click();
  const attack = dm.getByTestId("charx-public-attack");
  await expect(attack).toBeVisible();
  await expect(dm.getByTestId("charx-public-damage")).toBeVisible();
  const was = await attack.getAttribute("data-state");
  await attack.click();
  await expect(attack).toHaveAttribute("data-state", was === "checked" ? "unchecked" : "checked");
  await dm.keyboard.press("Escape");
  await expect(win.getByTestId("charx-public-menu")).toHaveAttribute("data-on", "true");
});
