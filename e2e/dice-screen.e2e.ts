// e2e-bundle: dice-extras
// Thin full-screen dice flows (D6; DICEX §13 sprint 4 E2E, walkthrough 15, 17, 18, 25): B
// (player-1, Mira) rolls; C (player-2) has the 3D chunk before any roll (idle preload), and the
// first throw of the session flies 3D on the dice layer: portalled to `body`, topmost, no input
// (a point on a window still hits the window), resting on the server's faces. "Tray throw" puts
// the dice in the zone on the same canvas, no caption; the DM's hidden roll never flies big;
// the OS reduced-motion preference changes nothing (#247): the full-screen throw as usual.
// Skipped without WebGL.
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

async function roll(page: Page, expression: string) {
  const log = await openWindow(page, "dice.log");
  await log.getByTestId("dice-roll-expression").fill(expression);
  await log.getByTestId("dice-roll-expression").press("Enter");
  return log;
}

/** Every 3D die of `page`'s throw in `arena` rests on its server value; returns the count. */
async function restsOnServerFaces(page: Page, arena: "screen" | "zone") {
  const thrown = page.locator(
    `[data-testid="dicex-throw"][data-record-id][data-render="3d"][data-arena="${arena}"]`,
  );
  await expect(thrown).toHaveAttribute("data-state", "rest", { timeout: 6_000 });
  const dice = thrown.getByTestId("dicex-throw-die");
  for (const d of await dice.all()) {
    const value = await d.getAttribute("data-value");
    expect(value).toMatch(/^\d+$/);
    await expect(d).toHaveAttribute("data-settled", value as string);
  }
  return dice.count();
}

test("FR-DICEX-33 FR-DICEX-34 FR-DICEX-37 full screen: chunk preloaded, first throw 3D on the topmost layer, no input, server faces", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  test.skip(!(await hasWebgl(p2)), "no WebGL in this headless browser: throws are flat");

  // FR-DICEX-37: the 3D chunk loads at idle, before any roll.
  const layer = p2.getByTestId("dicex-screen");
  await expect(layer).toHaveAttribute("data-chunk", "ready", { timeout: 10_000 });
  await expect(layer).toHaveAttribute("data-state", "idle");
  const log2 = await openWindow(p2, "dice.log");

  // B rolls; C's first throw of the session is 3D on the screen layer (sim-7).
  await roll(p1, "2d20+1d6");
  const thrown = p2.locator('[data-testid="dicex-throw"][data-record-id][data-arena="screen"]');
  await expect(thrown).toHaveAttribute("data-render", "3d");

  // FR-DICEX-33: portalled to body, topmost, no input; a point on a window hits the window.
  const facts = await p2.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='dicex-screen']");
    const win = document.querySelector<HTMLElement>("[data-testid='ui-window']");
    const r = win?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    const style = el ? getComputedStyle(el) : null;
    return {
      parentIsBody: el?.parentElement === document.body,
      z: style?.zIndex,
      pointer: style?.pointerEvents,
      position: style?.position,
      hidden: el?.getAttribute("aria-hidden"),
      hitsWindow: hit ? win?.contains(hit) === true : false,
      canvases: el?.querySelectorAll("canvas").length ?? 0,
      caption: el?.textContent?.includes("Mira") ?? true,
    };
  });
  expect(facts).toEqual({
    parentIsBody: true,
    z: "2147483647",
    pointer: "none",
    position: "fixed",
    hidden: "true",
    hitsWindow: true,
    canvases: 1,
    caption: false,
  });
  await expect(log2.getByTestId("dice-roll-expression")).toBeEditable();

  // FR-DICEX-34: every die rests on the server's face (2 d20 + 1 d6), within the budget.
  expect(await restsOnServerFaces(p2, "screen")).toBe(3);
  expect(await restsOnServerFaces(p1, "screen")).toBe(3);
  // FR-DICEX-35: rest 1 s, hand-off 0.4 s, then the layer is clear again (or gone: software GL
  // in headless Chromium is slow, so auto-flat may turn this device flat after the throw).
  await expect(thrown).toHaveCount(0, { timeout: 4_000 });
  await expect(
    p2.locator('[data-testid="dicex-screen"]:is([data-state="moving"], [data-state="rest"])'),
  ).toHaveCount(0);

  for (const page of [p1, p2]) await page.context().close();
});

test("FR-DICEX-32 FR-DICEX-36 Tray throw: zone dice on the one canvas, no caption; kept after reload", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  test.skip(!(await hasWebgl(p2)), "no WebGL in this headless browser: throws are flat");

  // C: tray gear → Display "Tray throw".
  const tray = await openWindow(p2, "dicex.tray");
  await tray.getByTestId("dicex-settings-open").click();
  await p2.locator('[data-testid="dicex-settings-display"][data-value="zone"]').click();
  await expect(
    p2.locator('[data-testid="dicex-settings-display"][data-value="zone"]'),
  ).toHaveAttribute("data-state", "on");
  await p2.keyboard.press("Escape");
  // FR-DICEX-36: the device setting survives a reload (browser storage, v2 key).
  await p2.reload();
  await live(p2);
  const stored = await p2.evaluate(() =>
    Object.entries(localStorage).filter(([k]) => k.startsWith("pp.dicex.v2.")),
  );
  expect(stored.map(([, v]) => JSON.parse(v).display)).toEqual(["zone"]);
  await expect(p2.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
    timeout: 10_000,
  });

  await roll(p1, "1d20+3");
  // C: the zone, 3D on the layer's one canvas, no caption (popups on: the name is the popup's).
  expect(await restsOnServerFaces(p2, "zone")).toBe(1);
  const zone = p2.getByTestId("dicex-throw-zone");
  await expect(zone).not.toContainText("Mira");
  await expect(p2.getByTestId("dicex-screen").locator("canvas")).toHaveCount(1);
  await expect(zone.locator("canvas")).toHaveCount(0);
  // B (Full screen): the screen layer.
  expect(await restsOnServerFaces(p1, "screen")).toBe(1);

  for (const page of [p1, p2]) await page.context().close();
});

test("FR-DICEX-38 FR-DICEX-45 the DM's hidden roll never flies big; reduced motion is ignored (#247): full-screen throw, 3D chunk, nothing greyed out", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  // Every frame the players receive, from the first load.
  const frames: string[] = [];
  const p1 = await rolePage(browser);
  const p2 = await rolePage(browser);
  for (const p of [p1, p2]) {
    p.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  }
  await p1.goto(link("Player 1"));
  await live(p1);
  await p2.emulateMedia({ reducedMotion: "reduce" });
  await p2.goto(link("Player 2"));
  await live(p2);
  test.skip(!(await hasWebgl(dm)), "no WebGL in this headless browser: throws are flat");
  await expect(dm.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
    timeout: 10_000,
  });

  // A: eye off, roll 1d20 "DM-SECRET-DICE" → the line (DM only), no big dice anywhere.
  const log = await openWindow(dm, "dice.log");
  const pub = log.getByTestId("dice-roll-public");
  if ((await pub.getAttribute("data-state")) !== "hidden") await pub.click();
  await expect(pub).toHaveAttribute("data-state", "hidden");
  await log.getByTestId("dice-roll-options").click();
  await log.getByTestId("dice-roll-label").fill("DM-SECRET-DICE");
  await log.getByTestId("dice-roll-expression").fill("1d20");
  await log.getByTestId("dice-roll-expression").press("Enter");
  const line = log.getByTestId("dice-log-entry").filter({ hasText: "DM-SECRET-DICE" });
  await expect(line).toHaveAttribute("data-public", "false");
  await dm.waitForTimeout(800);
  await expect(dm.locator('[data-testid="dicex-throw"][data-record-id]')).toHaveCount(0);
  await expect(dm.getByTestId("dicex-screen")).toHaveAttribute("data-state", "idle");
  for (const p of [p1, p2]) {
    await expect(p.locator('[data-testid="dicex-throw"][data-record-id]')).toHaveCount(0);
  }
  const hiddenId = await line.getAttribute("data-record-id");
  expect(hiddenId).toBeTruthy();
  const wire = frames.join(" ");
  expect(wire).not.toContain("DM-SECRET-DICE");
  expect(wire).not.toContain(hiddenId as string);

  // C (reduced motion emulated): the same as without it (#247): chunk preloaded, B's roll flies
  // full screen and rests on the server's face, its popup takes the hand-off.
  await expect(p2.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
    timeout: 10_000,
  });
  await roll(p1, "1d8");
  expect(await restsOnServerFaces(p2, "screen")).toBe(1);
  const popup = p2.locator('[data-testid="dicex-popup"][data-record-id]');
  await expect(popup.getByTestId("dicex-popup-pip")).toHaveAttribute("data-mode", "handoff");
  // No reduced-motion hint; Full screen / Tray throw stay pickable.
  const tray = await openWindow(p2, "dicex.tray");
  await tray.getByTestId("dicex-settings-open").click();
  await expect(p2.getByTestId("dicex-settings-3d-hint")).toHaveCount(0);
  for (const d of ["screen", "zone"]) {
    await expect(
      p2.locator(`[data-testid="dicex-settings-display"][data-value="${d}"]`),
    ).toBeEnabled();
  }
  await p2.keyboard.press("Escape");
  // The lazy 3D chunk (`dice3d-*.js`): fetched by A and C alike.
  const chunk3d = (page: Page) =>
    page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((r) => new URL(r.name).pathname)
        .filter((p) => /\/dice3d-[\w-]+\.js$/.test(p)),
    );
  expect(await chunk3d(dm)).toHaveLength(1);
  expect(await chunk3d(p2)).toHaveLength(1);

  for (const page of [p1, p2, dm]) await page.context().close();
});
