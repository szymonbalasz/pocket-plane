// e2e-bundle: dice-log
// FR-SHELL-28 (#153): content first at default size. The DM's `dice.log` with Physical dice on
// (banner + roll bar) still shows ≥ 3 entries; the roll bar scrolls with the window body.
import { expect, type Locator, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { shellWindow } from "./support/shell";

/** Log entries fully inside both the window and the list's scroll box. */
const fullyShown = (log: Locator) =>
  log.evaluate((win) => {
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

  expect(await fullyShown(log)).toBeGreaterThanOrEqual(3);
  // The roll bar is still reachable by scrolling the body.
  await log.getByTestId("dice-roll-expression").scrollIntoViewIfNeeded();
  await expect(log.getByTestId("dice-roll-expression")).toBeInViewport();
});

test("FR-SHELL-28 toggling Physical dice keeps the body's scroll position (no jump past the entries)", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  const log = shellWindow(dm, "dice.log");
  await expect(log.getByTestId("dice-log-entry").first()).toBeAttached();
  const physical = log.getByTestId("dice-roll-physical");
  await physical.scrollIntoViewIfNeeded(); // the toggle sits at the bottom of the body
  const bodyTop = () =>
    log.evaluate(
      (w) => w.querySelector("[data-testid='dice-log']")?.parentElement?.scrollTop ?? -1,
    );
  const before = await bodyTop();
  const shownBefore = await fullyShown(log);
  for (const on of [true, false]) {
    await physical.click();
    await expect(log.getByTestId("dice-log-physical")).toHaveCount(on ? 1 : 0);
    await dm.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    expect(await bodyTop()).toBe(before); // no scroll anchoring on the banner
    expect(await fullyShown(log)).toBeGreaterThanOrEqual(shownBefore);
  }
  await dm.context().close();
});
