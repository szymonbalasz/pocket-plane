// Thin play-shell flows (SHELL §13): DM frame + defaults; player move / resize / reload restore;
// per-owner keys; no layout on the wire; launcher toggle; clamp is render-only; key + drop
// routing to the base layer. Bundle: sync-probe (test mode on).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

async function box(page: Page, kind: string) {
  const b = await shellWindow(page, kind).boundingBox();
  if (!b) throw new Error(`${kind} not visible`);
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Drag a window by its title bar. */
async function moveWindow(page: Page, kind: string, dx: number, dy: number) {
  const t = await shellWindow(page, kind).getByTestId("ui-window-title").boundingBox();
  if (!t) throw new Error("no title bar");
  await drag(page, { x: t.x + 40, y: t.y + t.height / 2 }, dx, dy);
}

async function resizeWindow(page: Page, kind: string, dx: number, dy: number) {
  const r = await shellWindow(page, kind).getByTestId("ui-window-resize").boundingBox();
  if (!r) throw new Error("no resize handle");
  await drag(page, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, dx, dy);
}

/** Resize, then wait until the shell has re-rendered for the new size (resize → React). */
async function resizeViewport(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction((w) => window.innerWidth === w, width);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

/** Open window keys (`kind:instance`), sorted: the layout as rendered (minimised ones are parked). */
const openKeys = async (page: Page) =>
  (
    await page
      .locator('[data-testid="ui-window"][data-state="open"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id") ?? ""))
  ).sort();

const TEST_WINDOWS = ["shell.test:main", "sync.probes:main"];

const zOf = (page: Page, kind: string) =>
  shellWindow(page, kind).evaluate((el) => Number((el as HTMLElement).style.zIndex));

test("FR-SHELL-01/02/05/06/21 DM frame: top bar, presence badge, Players window (map-first: closed; empty Initiative minimised → right edge; 1440×900 right edge below a restored Initiative), base empty state", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("ui-topbar")).toBeVisible();
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  // Earlier specs' player pages may still be connected: assert the shape, not the count.
  await expect(dm.getByTestId("ui-presence-badge")).toHaveText(/^[0-2]\/2 online$/);
  await expect(dm.getByTestId("ui-base-empty")).toHaveText("No scenes yet");
  // Map-first (#162): Players starts closed; the presence badge opens it (FR-SHELL-06).
  const players = shellWindow(dm, "camp.players");
  await expect(players).toHaveCount(0);
  await expect(launcherButton(dm, "camp.players")).toHaveAttribute("data-state", "closed");
  await dm.getByTestId("ui-presence-badge").click();
  await expect(players).toHaveAttribute("data-state", "open");
  await expect(players.getByRole("heading", { name: "Players" })).toBeHidden(); // title bar only
  // P3 glitch 3: no encounter running → the empty Initiative opened minimised, so Players takes
  // its default bottom-right spot (with Initiative open at 1280×720 it would go to the left edge).
  await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "minimised");
  const b = await box(dm, "camp.players");
  expect(b.x + b.w).toBeGreaterThan(1280 - 40); // right edge
  // Close it; the badge opens it again.
  await players.getByTestId("ui-window-close").click();
  await expect(players).toHaveCount(0);
  await dm.getByTestId("ui-presence-badge").click();
  await expect(players).toBeVisible();

  // 1440×900 (the default layout's design size), fresh page and layout: Initiative restored,
  // then Players opens full size (400×340, P3 glitch 5) at an edge, clear of Initiative (#193:
  // a full-size free slot beats a shrunk one below it).
  const wide = await rolePage(browser);
  await wide.setViewportSize({ width: 1440, height: 900 });
  await loginDm(wide, secret);
  await expect(wide.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  // Empty Initiative opened minimised (P3 glitch 3); the DM restores it from the launcher.
  await expect(launcherButton(wide, "cbt.initiative")).toHaveAttribute("data-state", "minimised");
  await launcherButton(wide, "cbt.initiative").click();
  await expect(shellWindow(wide, "cbt.initiative")).toBeVisible();
  await wide.getByTestId("ui-presence-badge").click();
  await expect(shellWindow(wide, "camp.players")).toHaveAttribute("data-state", "open");
  const init = await box(wide, "cbt.initiative");
  const w = await box(wide, "camp.players");
  expect(Math.round(w.h)).toBe(340);
  expect(w.x < 80 || w.x + w.w > 1440 - 40).toBe(true); // an edge
  const clear =
    w.x + w.w <= init.x || init.x + init.w <= w.x || w.y + w.h <= init.y || init.y + init.h <= w.y;
  expect(clear).toBe(true);
  await wide.context().close();
});

test("FR-SHELL-02/08/10/15/16/19 player: move + resize + front, reload restores; other player's key gets defaults; no layout on the wire", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  const frames: string[] = [];
  p1.on("websocket", (ws) => {
    ws.on("framesent", (f) => frames.push(String(f.payload)));
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("camp-player-joined")).toHaveText(
    "Playing as Player 1 in Fixture Campaign",
  );
  await expect(p1.getByTestId("ui-base-empty")).toHaveText("Waiting for the DM to show a scene");
  // Player default = the registry's default-open windows (never a test window).
  await expect(launcherButton(p1, "sync.probes")).toBeVisible();
  const defaults = await openKeys(p1);
  for (const k of TEST_WINDOWS) expect(defaults).not.toContain(k);
  await expect(launcherButton(p1, "sync.probes")).toHaveAttribute("data-state", "closed");
  await expect(launcherButton(p1, "shell.test")).toBeVisible();

  await openWindow(p1, "sync.probes");
  await openWindow(p1, "shell.test");
  await expect(shellWindow(p1, "shell.test").getByTestId("shell-test-key")).toHaveText(
    "shell.test:main",
  );
  const start = await box(p1, "sync.probes");
  await moveWindow(p1, "sync.probes", 150, -120);
  await resizeWindow(p1, "sync.probes", 60, 40);
  const moved = await box(p1, "sync.probes");
  expect(moved).toEqual({ x: start.x + 150, y: start.y - 120, w: start.w + 60, h: start.h + 40 });
  expect(await zOf(p1, "sync.probes")).toBeGreaterThan(await zOf(p1, "shell.test"));
  // Bring Test to front by clicking its title, then Probes again (pointer-down → front).
  await shellWindow(p1, "shell.test").getByTestId("ui-window-title").click();
  expect(await zOf(p1, "shell.test")).toBeGreaterThan(await zOf(p1, "sync.probes"));
  const testBox = await box(p1, "shell.test");

  await p1.reload();
  await expect(shellWindow(p1, "sync.probes")).toBeVisible();
  expect(await box(p1, "sync.probes")).toEqual(moved);
  expect(await box(p1, "shell.test")).toEqual(testBox);
  expect(await zOf(p1, "shell.test")).toBeGreaterThan(await zOf(p1, "sync.probes"));
  await expect(shellWindow(p1, "shell.test")).toHaveAttribute("data-focused", "true");

  // Same browser context, Player 2's link: separate key → default layout.
  await p1.goto(link("Player 2"));
  await expect(p1.getByTestId("camp-player-joined")).toContainText("Player 2");
  await expect(launcherButton(p1, "sync.probes")).toHaveAttribute("data-state", "closed");
  await expect.poll(() => openKeys(p1)).toEqual(defaults);

  expect(frames.length).toBeGreaterThan(0);
  for (const f of frames) expect(f).not.toContain('"windows"');
});

test("FR-SHELL-09/11/12/14 launcher toggle, minimise, reset layout, render-only clamp", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p = await rolePage(browser);
  await p.goto(link("Player 1"));
  await expect(launcherButton(p, "sync.probes")).toBeVisible();
  const defaults = await openKeys(p);
  await openWindow(p, "sync.probes");
  const probesBtn = launcherButton(p, "sync.probes");
  await expect(probesBtn).toHaveAttribute("data-state", "open");
  await probesBtn.click(); // open on top → minimise
  await expect(probesBtn).toHaveAttribute("data-state", "minimised");
  // FR-SHELL-36: parked, not unmounted.
  await expect(shellWindow(p, "sync.probes")).toHaveAttribute("data-state", "minimised");
  await expect(shellWindow(p, "sync.probes")).toBeHidden();
  await probesBtn.click(); // minimised → open
  await expect(shellWindow(p, "sync.probes")).toBeVisible();
  await shellWindow(p, "sync.probes").getByTestId("ui-window-minimise").click();
  await expect(probesBtn).toHaveAttribute("data-state", "minimised");
  await probesBtn.click();

  // Push it mostly off the right edge, shrink the viewport, grow it back.
  await resizeViewport(p, 1600, 900);
  await moveWindow(p, "sync.probes", 1500, 200);
  const stored = await box(p, "sync.probes");
  expect(stored.x).toBe(1600 - 120);
  await resizeViewport(p, 1280, 720);
  const small = await box(p, "sync.probes");
  expect(small.x).toBe(1280 - 120);
  expect(small.y + 32).toBeLessThanOrEqual(720);
  await resizeViewport(p, 1600, 900);
  expect(await box(p, "sync.probes")).toEqual(stored);

  // Focusing something in the off-screen part never scrolls the page (chrome stays put).
  await shellWindow(p, "sync.probes").getByTestId("sync-drop-connection").focus();
  const scrolled = await p.evaluate(() =>
    [document.scrollingElement, ...document.querySelectorAll("[data-testid^='ui-']")].some(
      (el) => el && (el.scrollLeft !== 0 || el.scrollTop !== 0),
    ),
  );
  expect(scrolled).toBe(false);
  expect((await p.getByTestId("ui-topbar").boundingBox())?.x).toBe(0);

  // Reset layout → player default (the registry's default-open windows), and it is written.
  await p.getByTestId("ui-launcher-menu").click();
  await p.getByTestId("ui-launcher-reset").click();
  await expect.poll(() => openKeys(p)).toEqual(defaults);
  await p.reload();
  await expect(launcherButton(p, "sync.probes")).toHaveAttribute("data-state", "closed");
  await expect.poll(() => openKeys(p)).toEqual(defaults);
});

test("FR-SHELL-13 keys from windows never reach the base; window drags drop on the base", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p = await rolePage(browser);
  await p.goto(link("Player 1"));
  const win = await openWindow(p, "shell.test");
  const base = p.getByTestId("ui-base");
  await win.getByTestId("shell-test-input").click();
  await p.keyboard.press("Control+d");
  await p.keyboard.type("x");
  await expect(base).toHaveAttribute("data-test-last-key", "");
  await win.getByTestId("ui-window-title").click();
  await p.keyboard.press("Delete");
  await expect(base).toHaveAttribute("data-test-last-key", "");
  await p.getByTestId("ui-base-empty").click();
  await p.keyboard.press("Delete");
  await expect(base).toHaveAttribute("data-test-last-key", "Delete");

  await win.getByTestId("shell-test-drag").dragTo(p.getByTestId("ui-base-empty"));
  await expect(base).toHaveAttribute("data-test-last-drop", "shell.test:main");
});
test("FR-SHELL-22/24/25/27/73 Test window Alert: flash + Toast + ping; mute and volume (Preferences' Sound section) persist per player; the DM has no sound state", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const p = await rolePage(browser);
  await p.goto(link("Player 1"));
  const topbar = p.getByTestId("ui-topbar");
  const chip = p.getByTestId("ui-prefs-open");
  await expect(chip).toHaveAttribute("data-sound-state", "locked"); // no interaction yet
  await expect(topbar).toHaveAttribute("data-test-last-sound", "");

  const win = await openWindow(p, "shell.test"); // the launcher click unlocks audio
  await expect(chip).toHaveAttribute("data-sound-state", "on");
  await win.getByTestId("shell-test-alert").click();
  const flash = p.getByTestId("ui-alert-flash");
  await expect(flash).toHaveAttribute("data-alert-id", "shell.test");
  await expect(p.getByTestId("ui-alert-toast")).toHaveText("Test alert");
  await expect(topbar).toHaveAttribute("data-test-last-sound", "ping:played:1");
  await expect(flash).toHaveCount(0); // ends by itself (≈ 1.2 s)

  // Volume 40 + mute, reload: settings restored from this player's entry; alert stays silent.
  await chip.click();
  await expect(shellWindow(p, "shell.prefs")).toBeVisible();
  const thumb = p.getByTestId("ui-sound-volume").getByRole("slider");
  await thumb.focus();
  await thumb.press("Home");
  for (let i = 0; i < 4; i++) await thumb.press("PageUp");
  await expect(p.getByTestId("ui-sound-volume")).toHaveAttribute("data-value", "40");
  await p.getByTestId("ui-sound-mute").click();
  await expect(chip).toHaveAttribute("data-sound-state", "muted");
  await expect(chip.getByTestId("ui-prefs-chip-sound")).toBeVisible();
  await p.reload();
  await expect(chip).toHaveAttribute("data-sound-state", "muted");
  await expect(chip).toHaveAttribute("data-state", "closed"); // FR-SHELL-71: loads closed
  await chip.click();
  await expect(p.getByTestId("ui-sound-volume")).toHaveAttribute("data-value", "40");
  await chip.click(); // on top → closed
  await expect(chip).toHaveAttribute("data-state", "closed");
  await openWindow(p, "shell.test");
  await shellWindow(p, "shell.test").getByTestId("shell-test-alert").click();
  await expect(topbar).toHaveAttribute("data-test-last-sound", "ping:muted:1");

  // Another player's entry is separate (defaults); the DM has no sound state or section (#154).
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await expect(p2.getByTestId("ui-prefs-open")).toHaveAttribute("data-sound-state", "locked");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  const dmChip = dm.getByTestId("ui-prefs-open");
  await expect(dmChip).toBeVisible();
  await expect(dmChip).not.toHaveAttribute("data-sound-state", /.*/);
  await dmChip.click();
  await expect(dm.getByTestId("ui-prefs-window")).toBeVisible();
  await expect(dm.getByTestId("ui-sound-mute")).toHaveCount(0);
  await expect(dm.getByTestId("ui-sound-button")).toHaveCount(0);
});

test("FR-SHELL-25/70 chip: the first click on a fresh page unlocks audio and opens Preferences", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p = await rolePage(browser);
  await p.goto(link("Player 2"));
  const chip = p.getByTestId("ui-prefs-open");
  await expect(chip).toHaveAttribute("data-sound-state", "locked");
  await chip.click();
  await expect(chip).toHaveAttribute("data-sound-state", "on");
  await expect(chip).toHaveAttribute("data-state", "open");
  await expect(p.getByTestId("ui-sound-mute")).toBeVisible();
  await p.context().close();
});

/** `playersOnline`: the switch dialog asks first when players are online (CAMP §7). */
async function switchCampaign(dm: Page, name: string, playersOnline: boolean) {
  await dm.getByTestId("camp-campaign-switcher").click();
  await dm.getByTestId("camp-campaign-option").filter({ hasText: name }).click();
  if (playersOnline) await dm.getByTestId("camp-switch-confirm").click();
  await expect(dm.getByTestId("camp-campaign-name")).toHaveText(name);
}

// Runs last: switches the active campaign and back.
test("FR-SHELL-04/16 campaign switch: DM layout per campaign; player waits, then windows as before", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  const p = await rolePage(browser);
  await loginDm(dm, secret);
  await p.goto(link("Player 1"));
  await openWindow(p, "sync.probes");
  await moveWindow(p, "sync.probes", 200, 100);
  const pBox = await box(p, "sync.probes");

  await openWindow(dm, "camp.players");
  // A spot clear of Initiative's and the Game log's zones (FR-SHELL-99: a user spot in a zone
  // moves out when the layout is applied).
  const at = await box(dm, "camp.players");
  await moveWindow(dm, "camp.players", 300 - at.x, 70 - at.y);
  const dmBox = await box(dm, "camp.players");

  await switchCampaign(dm, "Second Campaign", true);
  await expect(p.getByTestId("camp-waiting")).toBeVisible();
  await expect(p.getByTestId("ui-topbar")).toHaveCount(0);
  await expect(dm.getByTestId("ui-topbar")).toBeVisible();
  await expect(shellWindow(dm, "camp.players")).toHaveCount(0); // new campaign → DM default (closed)

  await switchCampaign(dm, "Fixture Campaign", false);
  await expect(shellWindow(dm, "camp.players")).toBeVisible();
  await expect.poll(() => box(dm, "camp.players")).toEqual(dmBox);
  await expect(shellWindow(p, "sync.probes")).toBeVisible({ timeout: 15_000 });
  expect(await box(p, "sync.probes")).toEqual(pBox);
});
