// e2e-bundle: dice-display
// Thin roll-popup flows (D7; DICEX §13 sprint-4 E2E, walkthrough 15, 18, 26): B (player-1, Mira)
// rolls Athletics from her sheet; C (player-2) and A (DM) get a popup with one d20 (`data-dice`
// = 1) in their toast region (players bottom-right, the DM top-centre), the roller too; C's big
// throw rests on the server's face first (or shows flat chips without WebGL). At 1280×800 the
// popup covers no window (toast keep-out, A11). Hover keeps it; a click fronts the Game log at the
// entry. The DM's hidden roll pops only on the DM's side, eye-off, never big; players get nothing.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

// Headless Chromium has WebGL only through SwiftShader, which Chrome gates behind a flag.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const hasWebgl = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement("canvas");
    return (c.getContext("webgl2") ?? c.getContext("webgl")) !== null;
  });

const popupOf = (page: Page, entryId: string) =>
  page.locator(`[data-testid="dicex-popup"][data-record-id="${entryId}"]`);

test("FR-DICEX-39 FR-DICEX-40 FR-DICEX-41 a sheet roll pops on every client in its toast region with the same dice; clear of windows at 1280×800; click → Game log", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  const webgl = await hasWebgl(p2);
  if (webgl) {
    await expect(p2.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
      timeout: 10_000,
    });
  }

  // B: Mira's sheet → Athletics.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.locator('[data-testid="charx-roll-skill"][data-value="athletics"]').click();
  const first = p2.locator('[data-testid="dicex-popup"][data-record-id]');
  await expect(first).toHaveCount(1);
  const entryId = (await first.getAttribute("data-record-id")) as string;
  const log = await openWindow(dm, "dice.log");
  await expect(
    log.locator(`[data-testid="dice-log-entry"][data-record-id="${entryId}"]`),
  ).toContainText("Athletics");

  // C: the big d20 rests on the server's face (WebGL), then the popup holds the same one die.
  if (webgl) {
    const thrown = p2.locator(
      `[data-testid="dicex-throw"][data-record-id="${entryId}"][data-arena="screen"]`,
    );
    await expect(thrown).toHaveAttribute("data-state", "rest", { timeout: 6_000 });
    const die = thrown.getByTestId("dicex-throw-die");
    await expect(die).toHaveAttribute("data-settled", (await die.getAttribute("data-value")) ?? "");
  }
  for (const page of [p2, p1, dm]) {
    const popup = popupOf(page, entryId);
    await expect(popup).toHaveAttribute("data-dice", "1");
    await expect(popup).toHaveAttribute("data-state", "rest", { timeout: 6_000 });
    await expect(popup.getByTestId("dicex-popup-row")).toHaveCount(1);
    await expect(popup.getByTestId("dicex-popup-row")).toContainText("Mira");
    await expect(popup.getByTestId("dicex-popup-total")).toHaveText(/^\d+$/);
    await expect(popup.getByTestId("dicex-popup-pip")).toHaveAttribute(
      "data-mode",
      webgl ? "handoff" : "chips",
    );
  }

  // Placement: players bottom-right, the DM top-centre; at 1280×800 no window under the popup.
  const box = async (page: Page) => {
    const b = await popupOf(page, entryId).boundingBox();
    if (!b) throw new Error("no popup box");
    return b;
  };
  const vp2 = p2.viewportSize() ?? { width: 0, height: 0 };
  expect(vp2).toEqual({ width: 1280, height: 800 });
  const b2 = await box(p2);
  expect(b2.x + b2.width).toBeGreaterThan(vp2.width - 40);
  expect(b2.y).toBeGreaterThan(vp2.height / 2);
  const bdm = await box(dm);
  expect(Math.abs(bdm.x + bdm.width / 2 - 1440 / 2)).toBeLessThan(2);
  expect(bdm.y).toBeLessThan(200);
  const overlaps = await p2.evaluate((id) => {
    const p = document
      .querySelector(`[data-testid="dicex-popup"][data-record-id="${id}"]`)
      ?.getBoundingClientRect();
    if (!p) return ["no popup"];
    return [...document.querySelectorAll<HTMLElement>('[data-testid="ui-window"]')]
      .filter((w) => {
        const r = w.getBoundingClientRect();
        return r.left < p.right && p.left < r.right && r.top < p.bottom && p.top < r.bottom;
      })
      .map((w) => w.dataset.recordId ?? "?");
  }, entryId);
  expect(overlaps).toEqual([]);

  // Hover keeps it past its 6 s; a click fronts the Game log at the entry, highlighted.
  const popup2 = popupOf(p2, entryId);
  await popup2.hover();
  await p2.waitForTimeout(6_500);
  await expect(popup2).toHaveAttribute("data-state", "rest");
  await popup2.getByTestId("dicex-popup-row").click();
  const log2 = p2.locator('[data-testid="ui-window"][data-record-id="dice.log:main"]');
  await expect(log2).toBeVisible();
  await expect(
    log2.locator(`[data-testid="dice-log-entry"][data-record-id="${entryId}"]`),
  ).toHaveAttribute("data-focused", "true");

  for (const page of [p1, p2, dm]) await page.context().close();
});

test("FR-DICEX-38 the DM's hidden roll pops only on the DM's side, eye-off, never big; players get nothing", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const frames: string[] = [];
  const p1 = await rolePage(browser);
  p1.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await p1.goto(link("Player 1"));
  await live(p1);

  const log = await openWindow(dm, "dice.log");
  const pub = log.getByTestId("dice-roll-public");
  if ((await pub.getAttribute("data-state")) !== "hidden") await pub.click();
  await expect(pub).toHaveAttribute("data-state", "hidden");
  await log.getByTestId("dice-roll-options").click();
  await log.getByTestId("dice-roll-label").fill("DM-SECRET-DICE");
  await log.getByTestId("dice-roll-expression").fill("1d20");
  await log.getByTestId("dice-roll-expression").press("Enter");
  const line = log.getByTestId("dice-log-entry").filter({ hasText: "DM-SECRET-DICE" });
  const id = (await line.getAttribute("data-record-id")) as string;

  const popup = popupOf(dm, id);
  await expect(popup).toHaveAttribute("data-hidden", "true");
  await expect(popup).toHaveAttribute("data-dice", "1");
  await expect(popup.getByTestId("dicex-popup-row")).toContainText("DM-SECRET-DICE");
  await expect(popup.getByLabel("Hidden from players")).toBeVisible();
  // Never big: the PiP plays it (WebGL) or shows chips.
  await expect(popup.getByTestId("dicex-popup-pip")).toHaveAttribute(
    "data-mode",
    (await hasWebgl(dm)) ? /play|chips/ : "chips",
  );
  await expect(dm.locator(`[data-testid="dicex-throw"][data-record-id="${id}"]`)).toHaveCount(0);
  await expect(popup).toHaveAttribute("data-state", "rest", { timeout: 6_000 });

  await p1.waitForTimeout(500);
  await expect(p1.getByTestId("dicex-popup")).toHaveCount(0);
  const wire = frames.join(" ");
  expect(wire).not.toContain("DM-SECRET-DICE");
  expect(wire).not.toContain(id);

  for (const page of [p1, dm]) await page.context().close();
});
