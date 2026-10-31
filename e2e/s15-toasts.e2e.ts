// e2e-bundle: s15-toasts-e2e
// Thin sprint-15 flows on session-sim-13 (a started fight, the PCs on the battle map). BL-151: a
// player's sticky card with the sheet remembered at 600 × 598 at 1280×720 (sim-17 b08) sits on no
// sheet button. BL-175: the DM's damage-card popup, and the tray's roll popup with Party Manager +
// tray open at 1440×900 (sim-17 v12, b02), sit on no PC where a clear spot exists.
// Rules: bun test (`keep-out-player.test.ts`, `keep-out-s15.test.ts`, `popup-place.test.ts`,
// combat-tracker `popup-placement-s15.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { footprintsOf, overlaps, tokenFootprints } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { rollNow } from "./support/rolls";
import { pickSelect } from "./support/select";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

async function dragBy(page: Page, handle: Locator, dx: number, dy: number) {
  const t = await box(handle);
  const grab = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 6 });
  await page.mouse.up();
}

async function placeWindow(page: Page, win: Locator, x: number, y: number, w?: number, h?: number) {
  const at = await box(win);
  await dragBy(page, win.getByTestId("ui-window-title"), x - at.x, y - at.y);
  await expect.poll(async () => Math.round((await box(win)).x)).toBe(x);
  if (w === undefined || h === undefined) return;
  const now = await box(win);
  await dragBy(page, win.getByTestId("ui-window-resize"), w - now.w, h - now.h);
  await expect.poll(async () => Math.round((await box(win)).h)).toBe(h);
}

async function closePresent(page: Page) {
  const present = page.getByTestId("party-present-popup");
  const shown = await present.waitFor({ timeout: 3_000 }).then(
    () => true,
    () => false,
  );
  if (shown) {
    await present.getByTestId("party-present-close").click();
    await expect(present).toHaveCount(0);
  }
}

/** The stack holds still: the same rect for 400 ms. */
async function settled(page: Page, l: Locator) {
  await expect
    .poll(async () => {
      const a = await box(l);
      await page.waitForTimeout(400);
      const b = await box(l);
      return a.x === b.x && a.y === b.y && a.h === b.h;
    })
    .toBe(true);
}

/** Buttons and inputs in `win`'s body as drawn (cut by the body), each named. */
async function drawnControls(win: Locator): Promise<(Box & { name: string })[]> {
  return win.getByTestId("ui-window-body").evaluate((body) => {
    const b = body.getBoundingClientRect();
    const out: { x: number; y: number; w: number; h: number; name: string }[] = [];
    for (const el of body.querySelectorAll('button, input, [role="button"], [role="tab"]')) {
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, b.top);
      const bottom = Math.min(r.bottom, b.bottom);
      if (r.width < 4 || bottom - top < 4) continue;
      out.push({
        x: r.left,
        y: top,
        w: r.width,
        h: bottom - top,
        name: el.getAttribute("data-testid") ?? el.textContent ?? "",
      });
    }
    return out;
  });
}

test("FR-NOTE-83 BL-151 sim-17 b08 Player 1 at 1280×720, the sheet at 650, 60, 600 × 598: the sticky card sits on no sheet button; home again once the sheet moves off the corner", async ({
  browser,
}) => {
  const env = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, env.secret);
  await live(dm);
  const player = await rolePage(browser);
  await player.setViewportSize({ width: 1280, height: 720 });
  await player.goto(env.link("Player 1"));
  await live(player);
  await closePresent(player);
  const sheet = await openWindow(player, "char.sheet");
  await placeWindow(player, sheet, 650, 60, 600, 598);

  const requests = await openWindow(dm, "dicex.requests");
  const fold = requests.getByTestId("dicex-request-fold");
  if ((await fold.getAttribute("data-state")) !== "open") await fold.click();
  await pickSelect(requests, "dicex-request-roll", { label: "Perception" });
  await requests.getByTestId("dicex-request-all").click();
  await requests.getByTestId("dicex-request-send").click();

  const stack = player.getByTestId("note-toasts");
  const card = stack.getByTestId("note-toast").first();
  await expect(card).toBeVisible();
  await settled(player, stack);
  const r = await box(stack);
  const underAt = async (at: Box) =>
    (await drawnControls(sheet)).filter((c) => overlaps(at, c)).map((c) => c.name);
  expect(await underAt(r)).toEqual([]);
  // In the viewport, off the sheet's title bar.
  expect(r.y + r.h).toBeLessThanOrEqual(720 - 12);
  expect(r.y).toBeGreaterThan((await box(sheet)).y + 32);
  await expect(stack).toHaveAttribute("data-placement", "bottom-right");
  // Mira and Brakka: two prompts. One answered → the other, exactly b08's one card: on no button
  // at the new height too (the stack re-places when it shrinks).
  await stack.getByRole("button", { name: "Decline" }).first().click();
  await expect(stack.getByTestId("note-toast")).toHaveCount(1);
  await settled(player, stack);
  const one = await box(stack);
  expect(await underAt(one)).toEqual([]);
  expect(one.y + one.h).toBeLessThanOrEqual(720 - 12);
  await expect(stack.getByRole("button", { name: "Roll" })).toBeEnabled();

  // FR-NOTE-51: the sheet leaves the corner → the stack is home again at once.
  await dragBy(player, sheet.getByTestId("ui-window-title"), -500, 0);
  await settled(player, stack);
  const home = await box(stack);
  expect(Math.round(home.x + home.w)).toBe(1280 - 16);
  expect(Math.round(home.y + home.h)).toBe(720 - 20);
  await expect(stack).not.toHaveAttribute("data-left");
  await player.context().close();
  await dm.context().close();
});

test("FR-NOTE-81 FR-NOTE-82 BL-175 sim-17 v12, b02 DM 1440×900: the damage-card popup, opened with no target and then given a row, and the tray's roll popup with Party Manager + tray open, sit on no PC", async ({
  browser,
}) => {
  const env = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, env.secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  const player = await rolePage(browser);
  await player.setViewportSize({ width: 1280, height: 720 });
  await player.goto(env.link("Player 1"));
  await live(player);
  await closePresent(player);
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();

  // v12: a card from Player 1, opened from Initiative's Pending list.
  const init = await openWindow(dm, "cbt.initiative");
  const cards = init.getByTestId("cbt-init-card");
  const before = await cards.count();
  await rollNow(sheet.getByTestId("charx-roll-attack").first());
  await expect(cards).toHaveCount(before + 1);
  await cards.last().click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await settled(dm, popup);
  const pcs = await footprintsOf(dm, ["Mira", "Brakka", "Thorn"]);
  expect(pcs.length).toBeGreaterThan(0);
  const openAt = await box(popup);
  // Where a clear spot exists: with the room for a target row (FR-NOTE-81's reserve).
  const grown = { ...openAt, h: openAt.h + 84 };
  expect(pcs.filter((p) => overlaps(grown, p)).map((p) => p.label)).toEqual([]);
  await popup.getByTestId("cbt-popup-later").click();
  await expect(popup).toHaveCount(0);

  // b02: Party Manager + Dice tray open, the DM's tray roll.
  const board = await openWindow(dm, "party.board");
  await placeWindow(dm, board, 580, 148);
  const tray = await openWindow(dm, "dicex.tray");
  await placeWindow(dm, tray, 618, 460);
  // The attack's popup ends first: b02 is one card (two have no clear spot here: the rules before
  // stand, FR-NOTE-82).
  const closePopup = dm.locator(
    '[data-testid="dicex-popup"]:not([data-state="closing"]) [data-testid="dicex-popup-close"]',
  );
  while ((await closePopup.count()) > 0) await closePopup.first().click();
  await expect(dm.getByTestId("dicex-popup")).toHaveCount(0);
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="20"]').click();
  // FR-NOTE-85: the column's spot in every frame from its first; the camera's refit done first.
  await dm.waitForTimeout(500);
  await dm.evaluate(() => {
    const out: string[] = [];
    (window as unknown as { columnSpots: string[] }).columnSpots = out;
    const sample = () => {
      const p = document.querySelector('[data-testid="dicex-popup"]')?.parentElement;
      if (p) {
        const r = p.getBoundingClientRect();
        const at = `${Math.round(r.x)},${Math.round(r.y)}`;
        if (out[out.length - 1] !== at) out.push(at);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await tray.getByTestId("dicex-tray-roll").click();
  const roll = dm.getByTestId("dicex-popup").first();
  await expect(roll).toBeVisible();
  await expect(roll).not.toContainText("Rolling", { timeout: 5_000 });
  const spots = await dm.evaluate(
    () => (window as unknown as { columnSpots: string[] }).columnSpots,
  );
  expect(spots).toHaveLength(1);
  // The tray's move refits the camera; the column follows once the map settled.
  await expect
    .poll(
      async () => {
        const after = await footprintsOf(dm, ["Mira", "Brakka", "Thorn"]);
        const at = await box(roll);
        return after.filter((p) => overlaps(at, p)).map((p) => p.label);
      },
      { timeout: 3_000 },
    )
    .toEqual([]);
  await player.context().close();
  await dm.context().close();
});

test("FR-NOTE-86 walkthrough step F Player 1 at 1280×720, the sheet at 650, 60, 600 × 598: scrolling the Actions tab moves the sticky card once, after the scroll, onto no button; a tab switch re-places it too", async ({
  browser,
}) => {
  const env = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, env.secret);
  await live(dm);
  const player = await rolePage(browser);
  await player.setViewportSize({ width: 1280, height: 720 });
  await player.goto(env.link("Player 1"));
  await live(player);
  await closePresent(player);
  const sheet = await openWindow(player, "char.sheet");
  await placeWindow(player, sheet, 650, 60, 600, 598);
  const requests = await openWindow(dm, "dicex.requests");
  const fold = requests.getByTestId("dicex-request-fold");
  if ((await fold.getAttribute("data-state")) !== "open") await fold.click();
  await pickSelect(requests, "dicex-request-roll", { label: "Insight" });
  await requests.getByTestId("dicex-request-all").click();
  await requests.getByTestId("dicex-request-send").click();
  const stack = player.getByTestId("note-toasts");
  await expect(stack.getByTestId("note-toast").first()).toBeVisible();
  while ((await stack.getByTestId("note-toast").count()) > 1) {
    const n = await stack.getByTestId("note-toast").count();
    await stack.getByRole("button", { name: "Decline" }).first().click();
    await expect(stack.getByTestId("note-toast")).toHaveCount(n - 1);
  }
  const clearOfButtons = async () => {
    await settled(player, stack);
    const at = await box(stack);
    expect((await drawnControls(sheet)).filter((c) => overlaps(at, c)).map((c) => c.name)).toEqual(
      [],
    );
    return at;
  };

  // The tab switch, on Mira's sheet (her spell rows scroll).
  await pickSheet(sheet, { label: "Mira" });
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await clearOfButtons();

  // The scroll, frame by frame: the card holds while it runs, then moves at most once.
  const trace = await sheet.getByTestId("charx-content").evaluate(async (content) => {
    // The sheet's scroller: the content itself, or the nearest scrolling box around it.
    let el: HTMLElement = content as HTMLElement;
    while (el.scrollHeight <= el.clientHeight + 1 && el.parentElement) el = el.parentElement;
    const tops: { t: number; at: string }[] = [];
    const note = document.querySelector('[data-testid="note-toasts"]') as HTMLElement;
    let on = true;
    const sample = () => {
      const r = note.getBoundingClientRect();
      const at = `${Math.round(r.x)},${Math.round(r.y)}`;
      if (tops[tops.length - 1]?.at !== at) tops.push({ t: performance.now(), at });
      if (on) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const max = el.scrollHeight - el.clientHeight;
    for (let i = 1; i <= 12; i++) {
      el.scrollTop = (max * i) / 12;
      await new Promise((go) => setTimeout(go, 40));
    }
    const end = performance.now();
    await new Promise((go) => setTimeout(go, 700));
    on = false;
    return { tops, end, max };
  });
  expect(trace.max, "her Actions tab scrolls").toBeGreaterThan(100);
  expect(trace.tops.length, JSON.stringify(trace)).toBeLessThanOrEqual(2);
  if (trace.tops[1]) expect(trace.tops[1].t).toBeGreaterThan(trace.end);
  await clearOfButtons();

  // Back to Main: re-placed for what it draws.
  await sheet.locator('[data-testid="charx-tab"][data-value="main"]').click();
  await clearOfButtons();
  await player.context().close();
  await dm.context().close();
});

test("FR-NOTE-84 walkthrough step E DM 1280×720: the card from Pending sits on no PC, giving up Initiative's gap if it must, never on Initiative", async ({
  browser,
}) => {
  const env = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, env.secret);
  await live(dm);
  // At 1280 the PCs' labels are cut past matching: their ids from 1440.
  await expect
    .poll(async () => (await footprintsOf(dm, ["Mira", "Brakka", "Thorn"])).length)
    .toBeGreaterThan(0);
  const ids = (await footprintsOf(dm, ["Mira", "Brakka", "Thorn"])).map((p) => p.id);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  const player = await rolePage(browser);
  await player.setViewportSize({ width: 1280, height: 720 });
  await player.goto(env.link("Player 1"));
  await live(player);
  await closePresent(player);
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const init = await openWindow(dm, "cbt.initiative");
  const cards = init.getByTestId("cbt-init-card");
  const before = await cards.count();
  await rollNow(sheet.getByTestId("charx-roll-attack").first());
  await expect(cards).toHaveCount(before + 1);
  await dm.waitForTimeout(500);
  await cards.last().click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await settled(dm, popup);
  const at = await box(popup);
  const pcs = (await tokenFootprints(dm)).filter((t) => ids.includes(t.id));
  expect(pcs.filter((p) => overlaps(at, p)).map((p) => p.id)).toEqual([]);
  const initBox = await box(init);
  expect(at.x + at.w).toBeLessThanOrEqual(initBox.x - 4);
  await popup.getByTestId("cbt-popup-later").click();
  await player.context().close();
  await dm.context().close();
});
