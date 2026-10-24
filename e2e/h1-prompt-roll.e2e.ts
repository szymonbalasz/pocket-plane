// e2e-bundle: h1-prompt-roll-e2e
// Sprint 10 H1 (BL-105, FR-DICEX-83 / -84): the roll-request prompt's Roll is a normal roll button.
// B (player-1, Mira) has the open hidden Insight prompt as a card toast. Alt+click → the tray
// adjusts it (expression locked); closed again. A plain click → the answer throws big on B's
// screen (3D, default display) and pops in B's popup, marked hidden, like a sheet roll; the tray
// stays shut. C (player-2) gets no popup and no frame naming the entry. H1 re-test: C with
// physical dice on clicks Roll on Thorn's prompt at 1280×720 and 1280×800 → the "Physical dice"
// popover sits above the toast stack, so its Roll for me / Roll take the click (not the card).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

// Headless Chromium has WebGL only through SwiftShader, which Chrome gates behind a flag.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const hasWebgl = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement("canvas");
    return (c.getContext("webgl2") ?? c.getContext("webgl")) !== null;
  });

test("FR-DICEX-83 FR-DICEX-84 BL-105 prompt Roll follows the player's dice settings: Alt → tray; Roll → big throw + popup, no tray", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  const frames2: string[] = [];
  p2.on("websocket", (ws) => ws.on("framereceived", (f) => frames2.push(String(f.payload))));
  await p2.goto(link("Player 2"));
  await live(p2);
  const webgl = await hasWebgl(p1);
  if (webgl) {
    await expect(p1.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
      timeout: 10_000,
    });
  }

  // FR-DICEX-91: the open prompt is back as a card toast after the load.
  const card = p1.locator('[data-testid="note-toast"][data-class="card"]');
  const prompt = card.getByTestId("dicex-prompt");
  await expect(prompt).toContainText("DM: Insight · Mira");
  const roll = prompt.getByTestId("dicex-prompt-roll");

  // Alt → the tray adjusts the asked roll (a `control` request); nothing is sent. Closed again.
  await roll.click({ modifiers: ["Alt"] });
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "adjust");
  await expect(prompt).toHaveAttribute("data-state", "pending");
  await tray.getByTestId("ui-window-close").click();
  await expect(tray).toHaveCount(0);

  // Roll → B's own popup (marked hidden) and, with WebGL, the big throw on the screen layer.
  await roll.click();
  const popup = p1.locator('[data-testid="dicex-popup"][data-record-id]');
  await expect(popup).toHaveCount(1);
  const entryId = (await popup.getAttribute("data-record-id")) as string;
  await expect(popup).toHaveAttribute("data-hidden", "true");
  await expect(popup.getByTestId("dicex-popup-row")).toContainText("Mira");
  if (webgl) {
    const thrown = p1.locator(
      `[data-testid="dicex-throw"][data-record-id="${entryId}"][data-arena="screen"]`,
    );
    await expect(thrown).toHaveAttribute("data-state", "rest", { timeout: 6_000 });
    await expect(popup.getByTestId("dicex-popup-pip")).toHaveAttribute("data-mode", "handoff");
  }
  await expect(popup).toHaveAttribute("data-state", "rest", { timeout: 6_000 });
  await expect(p1.locator('[data-testid="note-toast"] [data-testid="dicex-prompt"]')).toHaveCount(
    0,
  );
  await expect(tray).toHaveCount(0);

  // C: nothing about B's hidden answer.
  await p2.waitForTimeout(500);
  await expect(p2.getByTestId("dicex-popup")).toHaveCount(0);
  expect(frames2.join(" ")).not.toContain(entryId);

  for (const page of [p1, p2]) await page.context().close();
});

/** The element at the centre of `testId`'s box is that control (nothing covers it). */
const reachable = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit !== null && el.contains(hit);
  });

test("FR-DICEX-83 H1 physical dice: the prompt's popover is above the toast stack at 1280×720 and 1280×800; its Roll answers", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1280, height: 720 });
  await p2.goto(link("Player 2"));
  await live(p2);
  // Game log → Roll options → Physical dice on (FR-DICE-07), then the log closed again.
  const log = await openWindow(p2, "dice.log");
  const options = log.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  await log.getByTestId("dice-roll-physical").click();
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await log.getByTestId("ui-window-close").click();

  const card = p2.locator('[data-testid="note-toast"][data-class="card"]');
  const prompt = card.getByTestId("dicex-prompt");
  await expect(prompt).toContainText("DM: Insight · Thorn");
  const roll = prompt.getByTestId("dicex-prompt-roll");
  await expect(roll).toHaveAttribute("data-physical", "true");
  for (const height of [720, 800]) {
    await p2.setViewportSize({ width: 1280, height });
    await roll.click();
    await expect(p2.getByTestId("dice-manual-label")).toHaveText("Thorn — Insight");
    for (const id of ["dice-manual-total", "dice-manual-auto", "dice-manual-submit"]) {
      expect(await reachable(p2, id), `${id} at 1280×${height}`).toBe(true);
    }
    if (height === 720) {
      await p2.keyboard.press("Escape");
      await expect(p2.getByTestId("dice-manual-label")).toHaveCount(0);
    }
  }
  await p2.getByTestId("dice-manual-total").fill("14");
  await p2.getByTestId("dice-manual-submit").click();
  await expect(prompt).toHaveCount(0);
  const popup = p2.locator('[data-testid="dicex-popup"][data-record-id]');
  await expect(popup).toHaveAttribute("data-hidden", "true");
  await p2.context().close();
});
