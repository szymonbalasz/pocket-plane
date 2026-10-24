// e2e-bundle: dice-polish
// Thin popup-line flows (D11; DICEX §13 sprint 5 E2E, walkthrough 30, 31, 33). B (player-1) rolls
// from the Game log's roll bar; every popup lays its dice out in 62 px cells (T5, DM #347: 44 ×
// 1.4 on a 448 px card; never shrunk by the count): 3 dice
// in one line with each row's total at its right, 10d6 in 2 lines (6 + 4), 20d6 as 11 dice + "+9"
// whose click fronts the Game log at the entry with all 20 chips. With others' rolls off, C's
// popup plays the miniature into its cells and lands only once they rest. Short screens: with a
// toast up, only the popups that fit the toast region show (the oldest dropped), none past the
// viewport or over the top bar (1280×1080, 1280×720, 1280×560: 3, 2, 1 of T5's 206-px cards).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

// Headless Chromium has WebGL only through SwiftShader, which Chrome gates behind a flag.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

/** The top bar's height and the gap below it (play-shell geometry). */
const TOP_BAR_H = 48;

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const hasWebgl = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement("canvas");
    return (c.getContext("webgl2") ?? c.getContext("webgl")) !== null;
  });

async function player(browser: Parameters<typeof rolePage>[0], name: string) {
  const page = await rolePage(browser);
  await page.goto(e2eEnv().link(name));
  await live(page);
  return page;
}

/** Roll `expression` from `page`'s roll bar; returns the new entry's id. */
async function roll(page: Page, expression: string): Promise<string> {
  const log = await openWindow(page, "dice.log");
  const before = await log.getByTestId("dice-log-entry").count();
  await log.getByTestId("dice-roll-expression").fill(expression);
  await log.getByTestId("dice-roll-expression").press("Enter");
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(before + 1);
  return (await log
    .getByTestId("dice-log-entry")
    .nth(before)
    .getAttribute("data-record-id")) as string;
}

const popupOf = (page: Page, id: string) =>
  page.locator(`[data-testid="dicex-popup"][data-record-id="${id}"]`);

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

/** Every cell of `popup`: its line and size (px). */
const cellsOf = (popup: Locator) =>
  popup.getByTestId("dicex-popup-cell").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { line: el.getAttribute("data-line"), w: r.width, h: r.height };
    }),
  );

test("FR-DICEX-46 FR-DICEX-47 popup line: 3 dice in one line at 62 px (T5), each row's total at its right; 10d6 → 6 + 4; 20d6 → 11 + '+9' → Game log at the entry", async ({
  browser,
}) => {
  const p1 = await player(browser, "Player 1");
  const p2 = await player(browser, "Player 2");

  // Walkthrough 30: 2d6 + 1d8 → one line of 3 cells on both players.
  const three = await roll(p1, "2d6+1d8");
  for (const page of [p1, p2]) {
    const popup = popupOf(page, three);
    await expect(popup).toHaveAttribute("data-landed", "true", { timeout: 10_000 });
    await expect(popup).toHaveAttribute("data-shown", "3");
    const cells = await cellsOf(popup);
    expect(cells).toEqual(Array(3).fill({ line: "1", w: 62, h: 62 }));
    const card = await box(popup);
    expect(card.width).toBe(448);
    expect(Math.round(card.height)).toBe(138); // table B × 1.4: one row + one line
    await expect(popup).toHaveAttribute("data-scale", "1.4");
    const row = await box(popup.getByTestId("dicex-popup-row"));
    const total = await box(popup.getByTestId("dicex-popup-total"));
    expect(total.x + total.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
    expect(total.x).toBeGreaterThan(row.x + row.width / 2);
    expect(total.y).toBeGreaterThanOrEqual(row.y - 0.5);
    expect(total.y + total.height).toBeLessThanOrEqual(row.y + row.height + 0.5);
  }

  // Walkthrough 31: 10d6 → 2 lines (6 + 4), not shrunk.
  const ten = await roll(p1, "10d6");
  const popup10 = popupOf(p2, ten);
  await expect(popup10).toHaveAttribute("data-shown", "10");
  const cells10 = await cellsOf(popup10);
  expect(cells10.filter((c) => c.line === "1")).toHaveLength(6);
  expect(cells10.filter((c) => c.line === "2")).toHaveLength(4);
  expect(cells10.every((c) => c.w === 62 && c.h === 62)).toBe(true);
  expect(Math.round((await box(popup10)).height)).toBe(206);

  // 20d6 → 11 dice + "+9"; its click fronts the Game log at the entry with all 20 chips.
  const twenty = await roll(p1, "20d6");
  const popup20 = popupOf(p2, twenty);
  await expect(popup20).toHaveAttribute("data-dice", "20");
  await expect(popup20).toHaveAttribute("data-shown", "11");
  const more = popup20.getByTestId("dicex-popup-more");
  await expect(more).toHaveAttribute("data-value", "9");
  await expect(more).toHaveAttribute("data-entry-id", twenty);
  await expect(more).toHaveText("+9");
  expect((await cellsOf(popup20)).every((c) => c.w === 62 && c.h === 62)).toBe(true);
  expect(Math.round((await box(popup20)).height)).toBeLessThanOrEqual(268);
  await more.click();
  const log2 = p2.locator('[data-testid="ui-window"][data-record-id="dice.log:main"]');
  await expect(log2).toBeVisible();
  const entry = log2.locator(`[data-testid="dice-log-entry"][data-record-id="${twenty}"]`);
  await expect(entry).toHaveAttribute("data-focused", "true");
  await expect(entry.getByTestId("dice-log-die")).toHaveCount(20);

  for (const page of [p1, p2]) await page.context().close();
});

test("FR-DICEX-46 others off: C's popup plays the miniature into its cells and lands only once its dice rest", async ({
  browser,
}) => {
  const p1 = await player(browser, "Player 1");
  const p2 = await player(browser, "Player 2");
  test.skip(!(await hasWebgl(p2)), "no WebGL in this headless browser: popups show chips");
  await expect(p2.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
    timeout: 10_000,
  });
  // C: tray gear → others' rolls off (Full screen stays).
  const tray = await openWindow(p2, "dicex.tray");
  await tray.getByTestId("dicex-settings-open").click();
  await p2.getByTestId("dicex-settings-others").click();
  await expect(p2.getByTestId("dicex-settings-others")).toHaveAttribute("data-state", "unchecked");
  await p2.keyboard.press("Escape");
  // C's recorder: every popup state / landing change, in order.
  await p2.evaluate(() => {
    const w = window as unknown as { __pop: { state: string | null; landed: string | null }[] };
    w.__pop = [];
    let last = "";
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="dicex-popup"][data-record-id]');
      if (!el) return;
      const r = { state: el.getAttribute("data-state"), landed: el.getAttribute("data-landed") };
      const key = JSON.stringify(r);
      if (key !== last) w.__pop.push(r);
      last = key;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });

  const id = await roll(p1, "4d6");
  const popup = popupOf(p2, id);
  await expect(popup.getByTestId("dicex-popup-pip")).toHaveAttribute("data-mode", "play");
  await expect(popup).toHaveAttribute("data-landed", "true", { timeout: 8_000 });
  // No big throw on C.
  await expect(p2.locator('[data-testid="dicex-throw"][data-arena="screen"]')).toHaveCount(0);
  // The miniature's dice rest on the server's faces, one per cell.
  const dice = popup.getByTestId("dicex-throw-die");
  await expect(dice).toHaveCount(4);
  for (const d of await dice.all()) {
    await expect(d).toHaveAttribute("data-settled", (await d.getAttribute("data-value")) ?? "");
  }
  await expect(popup.locator('[data-testid="dicex-popup-cell"][data-value]')).toHaveCount(4);
  const rec = await p2.evaluate(
    () => (window as unknown as { __pop: { state: string; landed: string }[] }).__pop,
  );
  expect(rec[0]).toEqual({ state: "rolling", landed: "false" });
  for (const r of rec) if (r.landed === "true") expect(r.state).not.toBe("rolling");

  for (const page of [p1, p2]) await page.context().close();
});

test("FR-DICEX-47 short screens: with a toast up only the popups that fit show (oldest dropped), none past the viewport or over the top bar", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await player(browser, "Player 1");

  // T5: 206-px cards (1 row + 2 lines × 1.4): fewer at once on short screens.
  for (const [h, fit] of [
    [1080, 3],
    [720, 2],
    [560, 1],
  ] as const) {
    for (const page of [p1, dm]) await page.setViewportSize({ width: 1280, height: h });
    // A toast in each region (FR-SHELL-27's test alert), then three 10d6 popups (206 px each).
    for (const page of [p1, dm]) {
      const win = await openWindow(page, "shell.test");
      // The last round's popups may cover the button: no pointer needed for the alert. The same
      // alert id re-fired while its last toast leaves can be swallowed: fire until one shows.
      await expect(async () => {
        await win.getByTestId("shell-test-alert").dispatchEvent("click");
        await expect(page.getByTestId("ui-alert-toast").first()).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 8_000 });
    }
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await roll(p1, "10d6"));
    for (const page of [p1, dm]) {
      await expect(popupOf(page, ids[2] as string)).toBeVisible();
      const shown = page.locator(
        '[data-testid="dicex-popup"][data-record-id]:not([data-state="closing"])',
      );
      // Only this round's newest `fit` popups stay; the oldest dropped first.
      const want = ids.slice(3 - fit);
      await expect(shown).toHaveCount(want.length);
      const got = await shown.evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-record-id")),
      );
      expect(got.sort()).toEqual([...want].sort());
      for (const b of await shown.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        }),
      )) {
        expect(b.top).toBeGreaterThanOrEqual(TOP_BAR_H);
        expect(b.bottom).toBeLessThanOrEqual(h);
      }
    }
  }

  for (const page of [p1, dm]) await page.context().close();
});
