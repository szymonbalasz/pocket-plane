// e2e-bundle: stats-dice-e2e
// Thin d20 chart flow (FR-STATS-89, -90), DM + player-2 (Thorn) on the `stats-b` bundle: the Luck
// tab's Chart button opens one `stats.dice` window on the tab's scope; 20 bars that add up to the
// Luck table's d20s; Count / Percent; one person's dice; a live roll moves the bar; the DM's total
// holds what a player's doesn't. Numbers and hidden rolls: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";
import { closeToasts } from "./support/toasts";

const chart = (page: Page) => shellWindow(page, "stats.dice", "chart");
const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const bar = (win: Locator, face: number) =>
  win.locator(`[data-testid="stats-dice-bar"][data-record-id="${face}"]`);

const barTotal = (win: Locator) =>
  win
    .getByTestId("stats-dice-bar")
    .evaluateAll((els) => els.reduce((a, e) => a + Number(e.getAttribute("data-value")), 0));

/** Stats → Luck · Campaign → Chart; returns the sum of the table's d20s column. */
async function openChart(page: Page) {
  const stats = await openWindow(page, "stats.board");
  await closeToasts(page);
  await stats.locator('[data-testid="stats-tab"][data-value="luck"]').click();
  await stats.getByTestId("stats-luck-scope").click();
  await page.locator('[data-testid="stats-luck-scope-option"][data-record-id="campaign"]').click();
  await expect(stats.getByTestId("stats-luck")).toHaveAttribute("data-state", "ok");
  await expect(stats.getByTestId("stats-luck-row").first()).toBeVisible();
  const d20s = await stats
    .getByTestId("stats-luck-d20s")
    .evaluateAll((els) => els.reduce((a, e) => a + Number(e.textContent), 0));
  await stats.getByTestId("stats-luck-chart").click();
  await expect(chart(page).getByTestId("stats-dice")).toHaveAttribute("data-state", "ok");
  return d20s;
}

test("FR-STATS-89 FR-STATS-90 the Luck tab's chart: 20 bars, Count and Percent, one person's dice, live", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, link, recordId } = e2eEnv();
  const thorn = recordId("char-thorn", "entity");

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);
  const present = p2.getByTestId("party-present-close");
  if (await present.isVisible()) await present.click();

  const dmD20s =
    await test.step("FR-STATS-90 the DM opens it: bars add up to the table's d20s", async () => {
      const d20s = await openChart(dm);
      const win = chart(dm);
      await expect(win.getByTestId("ui-window-title")).toContainText("d20 rolls");
      await expect(win.getByTestId("stats-dice-scope")).toContainText("Campaign");
      await expect(win.getByTestId("stats-dice-bar")).toHaveCount(20);
      expect(d20s).toBeGreaterThan(0);
      expect(await barTotal(win)).toBe(d20s);
      await expect(win.getByTestId("stats-dice-total")).toContainText(`${d20s} d20s`);
      await expect(win.getByTestId("stats-dice-fair")).toContainText("5% each");
      await dm.screenshot({ path: test.info().outputPath("dm-percent.png") });
      return d20s;
    });

  await test.step("FR-STATS-90 Count mode: the same bars on a count scale", async () => {
    const win = chart(dm);
    await win.locator('[data-testid="stats-dice-mode-item"][data-value="count"]').click();
    await expect(win.getByTestId("stats-dice-fair")).not.toContainText("5% each");
    expect(await barTotal(win)).toBe(dmD20s);
    await dm.screenshot({ path: test.info().outputPath("dm-count.png") });
    await win.locator('[data-testid="stats-dice-mode-item"][data-value="percent"]').click();
  });

  await test.step("FR-STATS-90 the same chart again adds no window; one person's dice", async () => {
    await shellWindow(dm, "stats.board").getByTestId("stats-luck-chart").click();
    await expect(
      dm.locator('[data-testid="ui-window"][data-record-id^="stats.dice:"]'),
    ).toHaveCount(1);
    const win = chart(dm);
    await win.getByTestId("stats-dice-who").click();
    await dm.locator(`[data-testid="stats-dice-who-option"][data-record-id="${thorn}"]`).click();
    const row = shellWindow(dm, "stats.board").locator(
      `[data-testid="stats-luck-row"][data-record-id="${thorn}"]`,
    );
    const own = Number(await row.getByTestId("stats-luck-d20s").textContent());
    await expect.poll(() => barTotal(win)).toBe(own);
    await win.getByTestId("stats-dice-who").click();
    await dm.locator('[data-testid="stats-dice-who-option"][data-record-id="everyone"]').click();
    await expect.poll(() => barTotal(win)).toBe(dmD20s);
  });

  await test.step("FR-STATS-90 a player's chart has no DM dice and moves on a live roll", async () => {
    const d20s = await openChart(p2);
    const win = chart(p2);
    expect(await barTotal(win)).toBe(d20s);
    expect(d20s).toBeLessThan(dmD20s);
    await win.getByTestId("stats-dice-who").click();
    await expect(
      p2.locator('[data-testid="stats-dice-who-option"][data-record-id="dm-dice"]'),
    ).toHaveCount(0);
    await p2.keyboard.press("Escape");

    const before = Number(await bar(win, 20).getAttribute("data-value"));
    await dm.evaluate(
      ([secret, entityId]) =>
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
          ws.onopen = () =>
            ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
          let sent = false;
          ws.onmessage = (m) => {
            const f = JSON.parse(String(m.data)) as { type: string };
            if (f.type === "snapshot" && !sent) {
              sent = true;
              ws.send(
                JSON.stringify({
                  type: "intent",
                  intentId: crypto.randomUUID(),
                  name: "dice.roll",
                  payload: {
                    expression: "1d20+5",
                    category: "attack",
                    actor: { entityId },
                    manual: { diceTotal: 20 },
                    public: true,
                  },
                }),
              );
            } else if (f.type === "ack") {
              ws.close();
              resolve();
            } else if (f.type === "reject") {
              ws.close();
              reject(new Error(String(m.data)));
            }
          };
        }),
      [secret, thorn] as const,
    );
    await expect(bar(win, 20)).toHaveAttribute("data-value", String(before + 1));
  });

  await test.step("FR-SHELL-201 a close removes the window; a reload never brings it back", async () => {
    await chart(p2).getByTestId("ui-window-close").click();
    await expect(chart(p2)).toHaveCount(0);
    await dm.reload();
    await live(dm);
    await expect(chart(dm)).toHaveCount(0);
  });
});
