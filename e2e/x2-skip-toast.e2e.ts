// e2e-bundle: x2-skip-e2e
// Sprint 12 X2 (BL-122, FR-CBT-50): one skip toast at a time. DM 1440×900 on `f3-skip-e2e`'s
// running ambush (Mira's Goblin 2 "After Mira" and Brakka's in-turn Drake Companion at 0; the
// Wolf's turn). No toast is closed between steps (sim-15 glitch 7: they lasted ~4 s and stacked).
// Initiative Next → Brakka: "Skipped Drake Companion (down)"; Next → Mira: none left at once;
// Next → Owlbear: "Skipped Goblin 2 (down)"; the palette's Shift+N → Mira: still one, the new
// one; Shift+N → Brakka: only "Skipped Drake Companion (down)". Rules: bun test (skip).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** The turn row's name. */
const turnName = (init: Locator) =>
  init
    .locator('li[data-testid="cbt-init-row"][data-turn="true"]')
    .getByTestId("cbt-init-row-name")
    .first()
    .getAttribute("data-value");

test("FR-CBT-50 BL-122 a turn change replaces the skip toast: Next / Prev, Initiative and palette, never two", async ({
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

  /** One step; `toast` = the only skip toast left once the turn moved (null = none). */
  const step = async (go: () => Promise<void>, to: string, toast: string | null) => {
    await go();
    await expect.poll(() => turnName(init)).toBe(to);
    if (toast) {
      await expect(skipped).toHaveText([toast]);
    } else {
      // Gone with the turn change, long before a toast's own time (≥ 4 s) could end it.
      await expect(skipped).toHaveCount(0, { timeout: 1_500 });
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
