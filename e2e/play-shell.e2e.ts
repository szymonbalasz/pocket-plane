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

const zOf = (page: Page, kind: string) =>
  shellWindow(page, kind).evaluate((el) => Number((el as HTMLElement).style.zIndex));

test("DM frame: top bar, presence badge, Players window top-right, base empty state", async ({
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
  const players = shellWindow(dm, "camp.players");
  await expect(players).toHaveAttribute("data-state", "open");
  const b = await box(dm, "camp.players");
  expect(b.x + b.w).toBeGreaterThan(1280 - 40); // top-right
  expect(b.y).toBeLessThan(100);
  // Close it; the presence badge reopens it (FR-SHELL-06).
  await players.getByTestId("ui-window-close").click();
  await expect(players).toHaveCount(0);
  await expect(launcherButton(dm, "camp.players")).toHaveAttribute("data-state", "closed");
  await dm.getByTestId("ui-presence-badge").click();
  await expect(players).toBeVisible();
});

test("player: move + resize + front, reload restores; other player's key gets defaults; no layout on the wire", async ({
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
  await expect(p1.getByTestId("ui-window")).toHaveCount(0); // player default: none open
  await expect(launcherButton(p1, "sync.probes")).toHaveAttribute("data-state", "closed");
  await expect(launcherButton(p1, "shell.test")).toBeVisible();

  await openWindow(p1, "sync.probes");
  await openWindow(p1, "shell.test");
  await expect(shellWindow(p1, "shell.test").getByTestId("shell-test-key")).toHaveText(
    "shell.test:main",
  );
  const start = await box(p1, "sync.probes");
  await moveWindow(p1, "sync.probes", 150, 120);
  await resizeWindow(p1, "sync.probes", 60, 40);
  const moved = await box(p1, "sync.probes");
  expect(moved).toEqual({ x: start.x + 150, y: start.y + 120, w: start.w + 60, h: start.h + 40 });
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
  await expect(p1.getByTestId("ui-window")).toHaveCount(0);

  expect(frames.length).toBeGreaterThan(0);
  for (const f of frames) expect(f).not.toContain('"windows"');
});

test("launcher toggle, minimise, reset layout, render-only clamp", async ({ browser }) => {
  const { link } = e2eEnv();
  const p = await rolePage(browser);
  await p.goto(link("Player 1"));
  await openWindow(p, "sync.probes");
  const probesBtn = launcherButton(p, "sync.probes");
  await expect(probesBtn).toHaveAttribute("data-state", "open");
  await probesBtn.click(); // open on top → minimise
  await expect(probesBtn).toHaveAttribute("data-state", "minimised");
  await expect(shellWindow(p, "sync.probes")).toHaveCount(0);
  await probesBtn.click(); // minimised → open
  await expect(shellWindow(p, "sync.probes")).toBeVisible();
  await shellWindow(p, "sync.probes").getByTestId("ui-window-minimise").click();
  await expect(probesBtn).toHaveAttribute("data-state", "minimised");
  await probesBtn.click();

  // Push it mostly off the right edge, shrink the viewport, grow it back.
  await p.setViewportSize({ width: 1600, height: 900 });
  await moveWindow(p, "sync.probes", 900, 300);
  const stored = await box(p, "sync.probes");
  await p.setViewportSize({ width: 1280, height: 720 });
  const small = await box(p, "sync.probes");
  expect(small.x).toBeLessThanOrEqual(1280 - 120);
  expect(small.y + 32).toBeLessThanOrEqual(720);
  await p.setViewportSize({ width: 1600, height: 900 });
  expect(await box(p, "sync.probes")).toEqual(stored);

  // Reset layout → player default (nothing open), and it is written.
  await p.getByTestId("ui-launcher-menu").click();
  await p.getByTestId("ui-launcher-reset").click();
  await expect(p.getByTestId("ui-window")).toHaveCount(0);
  await p.reload();
  await expect(launcherButton(p, "sync.probes")).toHaveAttribute("data-state", "closed");
  await expect(p.getByTestId("ui-window")).toHaveCount(0);
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
