// e2e-bundle: dice-log
// FR-SHELL-28 (#153): content first at default size. The roll bar is a pinned footer: at the
// default size, with Physical dice on, it is fully shown without scrolling and the entry list
// above it still shows ≥ 3 entries (DM and player).
import { expect, type Locator, type Page, test } from "@playwright/test";
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

const ROLL_BAR = [
  "dice-roll-expression",
  "dice-roll-mode",
  "dice-roll-submit",
  "dice-roll-category",
  "dice-roll-label",
  "dice-roll-physical",
  "dice-log-physical-off",
];

/** Roll-bar test IDs not fully inside the window (none = pinned footer fully shown). */
const clippedRollBar = (log: Locator) =>
  log.evaluate((win, ids) => {
    const w = win.getBoundingClientRect();
    return ids.filter((id) => {
      const el = win.querySelector(`[data-testid='${id}']`);
      const r = el?.getBoundingClientRect();
      return !r || r.top < w.top - 0.5 || r.bottom > w.bottom + 0.5;
    });
  }, ROLL_BAR);

/** Turns Physical dice on and reloads: the mode is stored; a fresh page at default size. */
async function physicalOnFresh(page: Page, log: Locator) {
  await expect(log).toBeVisible(); // default open, default size
  await log.getByTestId("dice-roll-physical").click();
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await page.reload();
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await expect(log.getByTestId("dice-log-entry").first()).toBeAttached();
}

test("FR-SHELL-28 DM game log at default size, Physical dice on → ≥ 3 entries + the whole roll bar", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 }); // the tightest laptop layout
  await loginDm(dm, secret);
  const log = shellWindow(dm, "dice.log");
  await physicalOnFresh(dm, log);
  expect(await fullyShown(log)).toBeGreaterThanOrEqual(3);
  expect(await clippedRollBar(log)).toEqual([]);
  await expect(log.getByTestId("dice-settings-open")).toBeInViewport({ ratio: 1 });
  // Toggling the mode keeps the roll bar in place and never hides entries.
  for (const on of [false, true]) {
    await log.getByTestId("dice-roll-physical").click();
    await expect(log.getByTestId("dice-log-physical")).toHaveCount(on ? 1 : 0);
    expect(await fullyShown(log)).toBeGreaterThanOrEqual(3);
    expect(
      await clippedRollBar(log).then((c) => c.filter((id) => id !== "dice-log-physical-off")),
    ).toEqual([]);
  }
  await dm.context().close();
});

test("FR-SHELL-28 player game log at default size with entries → the whole roll bar, entries above it", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const player = await rolePage(browser);
  await player.setViewportSize({ width: 1280, height: 720 });
  await player.goto(link("Player 1"));
  const log = shellWindow(player, "dice.log");
  await physicalOnFresh(player, log);
  // Other specs on this bundle's server may have added entries: at least 3 (or all) shown.
  const count = await log.getByTestId("dice-log-entry").count();
  expect(await fullyShown(log)).toBeGreaterThanOrEqual(Math.min(3, count));
  expect(await clippedRollBar(log)).toEqual([]);
  // The body itself does not scroll: only the entry list does.
  const bodyScrolls = await log.evaluate((w) => {
    const body = w.querySelector("[data-testid='dice-log']")?.parentElement;
    return body ? body.scrollHeight > body.clientHeight + 0.5 : true;
  });
  expect(bodyScrolls).toBe(false);
  await player.context().close();
});
