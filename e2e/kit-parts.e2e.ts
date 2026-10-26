// e2e-bundle: party-s5
// Thin kit-parts flow (kit-parity K0, FR-KIT-70): a dialog whose title wraps to two lines keeps its
// built-in × centred in the title bar, under both themes (K0 re-test #2: the bar grew to 69 px and
// the × stayed on the first line). One × is shown (the bar's), and opening the dialog still
// focuses its first control, not the ×. Markup rules: bun test (components/ui/dialog.test.tsx).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";
import { storedTheme } from "./support/theme";

/** "Open “PARTY-P1-ONLY Thieves' Map” on screens": two lines in the 448 px dialog. */
async function openOnScreens(page: Page, handoutId: string) {
  const board = await openWindow(page, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="handouts"]').click();
  await board
    .locator(`[data-testid="party-handout-row"][data-record-id="${handoutId}"]`)
    .getByTestId("party-handout-menu")
    .click();
  await page.getByTestId("party-present-open").click();
  const dialog = page.getByTestId("party-present-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const theme of ["gilt", "default"] as const) {
  test(`FR-KIT-70 dialog bar (${theme}): a 2-line title keeps the × centred in the bar, one ×, focus on the first control`, async ({
    browser,
  }) => {
    const { secret, recordId } = e2eEnv();
    const dm = await rolePage(browser);
    await storedTheme(dm, theme);
    await loginDm(dm, secret);
    await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    // Simple Dark (`default`) is no attribute on <html>.
    expect(
      await dm.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "default"),
    ).toBe(theme);

    const dialog = await openOnScreens(dm, recordId("handouts-1", "handout", 1));
    const bar = dialog.locator('[data-slot="dialog-header"]');
    const close = bar.locator('[data-slot="dialog-close"][aria-label="Close"]');
    await expect(close).toBeVisible();
    // Exactly one visible ×: the corner one is hidden while the dialog has a bar.
    await expect(
      dialog.locator('[data-slot="dialog-close"][aria-label="Close"]:visible'),
    ).toHaveCount(1);

    const b = await bar.boundingBox();
    const c = await close.boundingBox();
    if (!b || !c) throw new Error("bar or close has no box");
    expect(b.height).toBeGreaterThanOrEqual(60); // the title wraps to two lines
    expect(Math.abs(c.y + c.height / 2 - (b.y + b.height / 2))).toBeLessThanOrEqual(1);
    // Right end of the bar, clear of the title.
    const t = await bar.locator('[data-slot="dialog-title"]').boundingBox();
    if (!t) throw new Error("title has no box");
    expect(c.x).toBeGreaterThan(t.x + t.width);

    // Open focus: the first control, not the bar's × (Radix's rule, the × skipped).
    const focusedIsClose = await dm.evaluate(
      () => document.activeElement?.matches('[data-slot="dialog-close"]') ?? false,
    );
    expect(focusedIsClose).toBe(false);
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

    // The × still closes it.
    await close.click();
    await expect(dialog).toHaveCount(0);
  });
}
