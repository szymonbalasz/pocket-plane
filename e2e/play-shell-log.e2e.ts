// e2e-bundle: dice-log
// FR-SHELL-35 (R3, amends FR-SHELL-28 for `dice.log`): at its default size, with the one-row
// roll bar (FR-DICE-30), the Game log shows ≥ 6 single-line entries fully above the bar, ≥ 4
// with Physical dice on (strip shown). The roll bar is a pinned footer: always fully shown, and
// only the entry list scrolls (DM 460×240, player 340×280).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { shellWindow } from "./support/shell";

/**
 * Log entries fully inside both the window and the list's scroll box, and above the roll bar.
 * Each must be a single line (FR-SHELL-35 counts single-line entries).
 */
const fullyShown = (log: Locator) =>
  log.evaluate((win) => {
    const list = win.querySelector("[data-testid='dice-log-list']");
    const bar = win.querySelector("[data-testid='dice-roll-expression']")?.closest("form");
    if (!list || !bar) return { count: 0, multiLine: 0 };
    const w = win.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    const top = Math.max(w.top, l.top);
    const bottom = Math.min(w.bottom, l.bottom, bar.getBoundingClientRect().top);
    const shown = [...list.querySelectorAll("[data-testid='dice-log-entry']")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
    });
    const multiLine = shown.filter((e) => e.getBoundingClientRect().height > 26).length;
    return { count: shown.length, multiLine };
  });

const ROW_1 = ["dice-roll-expression", "dice-roll-mode", "dice-roll-submit", "dice-roll-options"];

/** Roll-bar test IDs not fully inside the window (none = pinned footer fully shown). */
const clippedRollBar = (log: Locator, ids: string[]) =>
  log.evaluate((win, ids) => {
    const w = win.getBoundingClientRect();
    return ids.filter((id) => {
      const el = win.querySelector(`[data-testid='${id}']`);
      const r = el?.getBoundingClientRect();
      return !r || r.top < w.top - 0.5 || r.bottom > w.bottom + 0.5;
    });
  }, ids);

const windowSize = (log: Locator) =>
  log.evaluate((w) => {
    const r = w.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });

/** Rolls `1d4` n times from the log's own bar (single-line entries). */
async function rollMany(log: Locator, n: number) {
  const entries = log.getByTestId("dice-log-entry");
  for (let i = 0; i < n; i++) {
    const before = await entries.count();
    await log.getByTestId("dice-roll-expression").fill("1d4");
    await log.getByTestId("dice-roll-expression").press("Enter");
    await expect(entries).toHaveCount(before + 1);
  }
}

/** Physical dice on via Options, Options closed again, reload: both are stored. */
async function physicalOnOptionsClosed(page: Page, log: Locator) {
  const options = log.getByTestId("dice-roll-options");
  await options.click();
  await expect(options).toHaveAttribute("data-state", "open");
  await log.getByTestId("dice-roll-physical").click();
  await options.click();
  await expect(options).toHaveAttribute("data-state", "closed");
  await page.reload();
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await expect(log.getByTestId("dice-roll-options")).toHaveAttribute("data-state", "closed");
  await expect(log.getByTestId("dice-roll-physical")).toHaveCount(0);
  await expect(log.getByTestId("dice-log-entry").first()).toBeAttached();
}

async function expectHistory(log: Locator, min: number) {
  await expect.poll(async () => (await fullyShown(log)).count).toBeGreaterThanOrEqual(min);
  expect((await fullyShown(log)).multiLine).toBe(0);
}

for (const role of ["DM", "player"] as const) {
  test(`FR-SHELL-35 ${role} game log at default size: ≥ 6 single-line entries, ≥ 4 with Physical dice on`, async ({
    browser,
  }) => {
    const { secret, link } = e2eEnv();
    const page = await rolePage(browser);
    await page.setViewportSize({ width: 1280, height: 720 }); // the tightest laptop layout
    if (role === "DM") await loginDm(page, secret);
    else await page.goto(link("Player 1"));
    const log = shellWindow(page, "dice.log");
    await expect(log).toBeVisible(); // default open, default size
    expect(await windowSize(log)).toEqual(role === "DM" ? { w: 460, h: 240 } : { w: 340, h: 280 });
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

    // FR-DICE-30: Options closed by default → one row.
    await expect(log.getByTestId("dice-roll-options")).toHaveAttribute("data-state", "closed");
    await expect(log.getByTestId("dice-roll-category")).toHaveCount(0);
    await expect(log.getByTestId("dice-log-physical")).toHaveCount(0);

    await rollMany(log, 8);
    await expectHistory(log, 6);
    expect(await clippedRollBar(log, ROW_1)).toEqual([]);
    // The body itself does not scroll: only the entry list does.
    const bodyScrolls = await log.evaluate((w) => {
      const body = w.querySelector("[data-testid='dice-log']")?.parentElement;
      return body ? body.scrollHeight > body.clientHeight + 0.5 : true;
    });
    expect(bodyScrolls).toBe(false);

    await physicalOnOptionsClosed(page, log);
    await expectHistory(log, 4);
    expect(await clippedRollBar(log, [...ROW_1, "dice-log-physical-off"])).toEqual([]);

    // Options open with the strip on: the whole bar (incl. the DM gear) stays in the window.
    await log.getByTestId("dice-roll-options").click();
    const row2 = ["dice-roll-category", "dice-roll-actor", "dice-roll-label", "dice-roll-physical"];
    if (role === "DM") row2.push("dice-settings-open");
    expect(await clippedRollBar(log, [...ROW_1, ...row2, "dice-log-physical-off"])).toEqual([]);
    expect((await fullyShown(log)).count).toBeGreaterThanOrEqual(1);

    // Leave the mode off for later specs on this server's browser contexts.
    await log.getByTestId("dice-log-physical-off").click();
    await expect(log.getByTestId("dice-log-physical")).toHaveCount(0);
    await page.context().close();
  });
}
