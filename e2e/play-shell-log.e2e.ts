// e2e-bundle: dice-log
// FR-SHELL-28 (#153): content first at default size. The DM's `dice.log` with Physical dice on
// (banner + roll bar) still shows ≥ 3 entries; the roll bar scrolls with the window body.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { shellWindow } from "./support/shell";

test("FR-SHELL-28 DM game log at default size, Physical dice on → ≥ 3 entries visible", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 }); // the tightest laptop layout
  await loginDm(dm, secret);
  const log = shellWindow(dm, "dice.log");
  await expect(log).toBeVisible(); // default open, default size
  await log.getByTestId("dice-roll-physical").click();
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  // Reload: the mode is stored, the body starts unscrolled, as a fresh page would show it.
  await dm.reload();
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await expect(log.getByTestId("dice-log-entry").first()).toBeAttached();

  const fullyShown = await log.evaluate((win) => {
    const list = win.querySelector("[data-testid='dice-log-list']");
    if (!list) return 0;
    const w = win.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    const top = Math.max(w.top, l.top);
    const bottom = Math.min(w.bottom, l.bottom);
    return [...list.querySelectorAll("[data-testid='dice-log-entry']")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
    }).length;
  });
  expect(fullyShown).toBeGreaterThanOrEqual(3);
  // The roll bar is still reachable by scrolling the body.
  await log.getByTestId("dice-roll-expression").scrollIntoViewIfNeeded();
  await expect(log.getByTestId("dice-roll-expression")).toBeInViewport();
});
