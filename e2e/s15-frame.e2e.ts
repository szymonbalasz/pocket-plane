// e2e-bundle: s15-frame-e2e
// Sprint 15 frame (session-sim-17 glitches 1, 3, 4): Attack on a stat block keeps it open (BL-174);
// a player's map comes back after the Dice tray (BL-176); the reconnect banner blocks nothing
// (BL-164, BL-171). The rects in detail: `s15-frame.test.ts`, `ConnectionStatus.test.tsx`.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { footprintsOf } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** The DM on Goblin Ambush, shown to the players too (the fight of sim-17's rects). */
async function dmOnAmbush(browser: Browser) {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const scenes = await showToPlayers(dm, "Goblin Ambush");
  await scenes
    .locator(
      `[data-testid="map-scene-row"][data-record-id="${recordId("battlemap", "scene")}"] button`,
    )
    .first()
    .click();
  await scenes.getByTestId("ui-window-close").click();
  return dm;
}

/** Player 1 on this bundle first sees a shared handout (a dialog): out of the way. */
async function player(page: Page, url: string) {
  await page.goto(url);
  await live(page);
  const handout = page.getByRole("dialog");
  const up = await handout.waitFor({ timeout: 5_000 }).then(
    () => true,
    () => false,
  );
  if (up) await page.keyboard.press("Escape");
  await expect(handout).toHaveCount(0);
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

/** Where a token draws now, once the camera has stopped. */
async function tokenAt(page: Page, name: string) {
  const find = async () => {
    const [t] = await footprintsOf(page, [name]);
    return t ? { x: Math.round(t.x), y: Math.round(t.y) } : null;
  };
  let last = await find();
  await expect
    .poll(async () => {
      const now = await find();
      const still = now !== null && now.x === last?.x && now.y === last?.y;
      last = now;
      return still;
    })
    .toBe(true);
  return last as { x: number; y: number };
}

/** The element a press at the centre of `l` lands on is `l` or inside it. */
async function pressReaches(page: Page, l: Locator) {
  const b = await box(l);
  const handle = await l.elementHandle();
  return page.evaluate(
    ([x, y, el]) => {
      const at = document.elementFromPoint(x as number, y as number);
      return at !== null && ((el as Element) === at || (el as Element).contains(at));
    },
    [b.x + b.w / 2, b.y + b.h / 2, handle] as const,
  );
}

test("FR-SHELL-210 DM 1440×900: Attack on a stat block opens the Dice tray beside it; it stays open and unmoved, also after the tray closes", async ({
  browser,
}) => {
  const dm = await dmOnAmbush(browser);
  await dm.getByTestId("map-tool-fit").click();
  const init = await openWindow(dm, "cbt.initiative");
  const row = init.getByTestId("cbt-init-row").first();
  await row.hover();
  await row.getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-statblock").click();
  const sb = shellWindow(dm, "ent.statblock");
  await expect(sb).toHaveAttribute("data-state", "open");
  const at = await box(sb);

  await sb.getByTestId("ent-statblock-roll-attack").first().click();
  const tray = shellWindow(dm, "dicex.tray");
  await expect(tray).toHaveAttribute("data-state", "open");
  await expect(sb).toHaveAttribute("data-state", "open");
  expect(await box(sb)).toEqual(at);
  const t = await box(tray);
  expect(t.x + t.w <= at.x || at.x + at.w <= t.x || t.y + t.h <= at.y || at.y + at.h <= t.y).toBe(
    true,
  );

  await tray.getByTestId("ui-window-close").click();
  await expect(tray).toHaveCount(0);
  await expect(sb).toHaveAttribute("data-state", "open");
  expect(await box(sb)).toEqual(at);
  // Damage is one click away.
  await expect(sb.getByTestId("ent-statblock-roll-damage").first()).toBeVisible();
});

test("FR-MAP-125 FR-MAP-126 player 1280×720: the map the Dice tray pushed comes back when it closes; a camera the player moved stays", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  await dmOnAmbush(browser);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 720 });
  await player(p1, link("Player 1"));
  const canvas = p1.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  await p1.getByTestId("map-tool-fit").click();
  const before = await tokenAt(p1, "Mira");

  const tray = await openWindow(p1, "dicex.tray");
  await expect(tray).toHaveAttribute("data-state", "open");
  await expect(canvas).toHaveAttribute("data-fit-reason", "window");
  const pushed = await tokenAt(p1, "Mira");
  expect(pushed).not.toEqual(before);

  await tray.getByTestId("ui-window-close").click();
  await expect.poll(() => tokenAt(p1, "Mira")).toEqual(before);
  await expect(canvas).toHaveAttribute("data-camera", "fitted");

  // The player zooms while the tray is open: the tray's closing leaves their camera alone.
  const again = await openWindow(p1, "dicex.tray");
  await expect(canvas).toHaveAttribute("data-fit-reason", "window");
  const c = await box(canvas);
  await p1.mouse.move(c.x + c.w / 2, c.y + c.h - 40);
  await p1.mouse.wheel(0, -120);
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  const mine = await tokenAt(p1, "Mira");
  await again.getByTestId("ui-window-close").click();
  await expect(again).toHaveCount(0);
  expect(await tokenAt(p1, "Mira")).toEqual(mine);
});

test("FR-SYNC-41 offline: the banner shows, Select and a close button under it still take the press", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await player(p1, link("Player 1"));
  const select = p1.getByTestId("map-tool-select");
  await expect(select).toBeVisible();
  // A window whose close button sits right under the banner: its title bar at the centre, top.
  const win = await openWindow(p1, "stats.board");
  const title = await box(win.getByTestId("ui-window-title"));
  const close = await box(win.getByTestId("ui-window-close"));
  await p1.mouse.move(title.x + 20, title.y + title.h / 2);
  await p1.mouse.down();
  await p1.mouse.move(640 - (close.x - title.x) - close.w / 2 + 20, 70, { steps: 5 });
  await p1.mouse.up();

  await p1.context().setOffline(true);
  const banner = p1.getByTestId("sync-reconnect-banner");
  await expect(banner).toBeVisible();
  const b = await box(banner);
  const s = await box(select);
  // Off the rail, a pill: not the full-width bar b10 shows.
  expect(s.x + s.w <= b.x).toBe(true);
  expect(b.w).toBeLessThan(600);
  expect(await pressReaches(p1, select)).toBe(true);
  // The close button really is under the banner, and the press gets to it.
  const cb = win.getByTestId("ui-window-close");
  const c = await box(cb);
  expect(c.x < b.x + b.w && b.x < c.x + c.w && c.y < b.y + b.h && b.y < c.y + c.h).toBe(true);
  expect(await pressReaches(p1, cb)).toBe(true);
  await cb.click();
  await expect(win).toHaveCount(0);
  await p1.context().setOffline(false);
  await live(p1);
  await expect(banner).toHaveCount(0);
});
