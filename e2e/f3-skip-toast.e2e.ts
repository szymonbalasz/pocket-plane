// e2e-bundle: f3-skip-e2e
// Sprint 11 F3 (BL-110, FR-CBT-50): DM 1440×900 on `fu-s7`'s running ambush with Mira's charmed
// Goblin 2 ("After Mira") and Brakka's Drake Companion (a line in her turn) both at 0; the Wolf's
// turn. Initiative Next → Brakka: "Skipped Drake Companion (down)"; Next → Mira: no toast; Next →
// Owlbear: "Skipped Goblin 2 (down)". The palette's keys say the same: Shift+N → Mira
// ("Skipped Goblin 2 (down)"), Shift+N → Brakka ("Skipped Drake Companion (down)"). Rules and the
// socket replay: bun test (skip, f3-skip-sync).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Closes the plain (sonner) toasts: the skip cue is one, not a notification card. */
async function closePlainToasts(page: Page) {
  const close = page.locator("[data-sonner-toast] [data-close-button]");
  for (let i = 0; i < 20 && (await close.count()) > 0; i++) {
    await close
      .first()
      .click({ timeout: 2_000 })
      .catch(() => {});
  }
}

/** The turn row's name. */
const turnName = (init: Locator) =>
  init
    .locator('li[data-testid="cbt-init-row"][data-turn="true"]')
    .getByTestId("cbt-init-row-name")
    .first()
    .getAttribute("data-value");

test("FR-CBT-50 BL-110 Next / Prev name the down companions: the in-turn drake and the after-Mira Goblin 2", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  await expect.poll(() => turnName(init)).toBe("Wolf");
  const skipped = dm.getByTestId("cbt-init-skipped");

  /** One step; `toast` = the skip toast it shows (null = none), checked after the turn moved. */
  const step = async (go: () => Promise<void>, to: string, toast: string | null) => {
    await closePlainToasts(dm);
    await expect(skipped).toHaveCount(0);
    await go();
    await expect.poll(() => turnName(init)).toBe(to);
    if (toast) await expect(skipped).toHaveText(toast);
    else {
      await dm.waitForTimeout(300);
      await expect(skipped).toHaveCount(0);
    }
  };
  const next = () => init.getByTestId("cbt-init-next").click();
  const prevKey = async () => {
    await dm.getByTestId("map-canvas").focus();
    await dm.keyboard.press("Shift+N");
  };

  await step(next, "Brakka", "Skipped Drake Companion (down)");
  await step(next, "Mira", null);
  await step(next, "Owlbear", "Skipped Goblin 2 (down)");
  await step(prevKey, "Mira", "Skipped Goblin 2 (down)");
  await step(prevKey, "Brakka", "Skipped Drake Companion (down)");
  await dm.context().close();
});
