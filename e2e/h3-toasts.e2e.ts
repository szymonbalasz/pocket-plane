// e2e-bundle: h3-toasts-e2e
// Thin H3 flows (sprint 10, BL-101; FR-NOTE-75–77): the DM with sim-12's pending rows (the
// "N pending actions" summary), plus test cards the DM sends itself (owner: the DM, like damage
// cards). At 1280×720 Scenes at 400, 112 (sim-13 h07) → the stack keeps left 480 and covers none
// of Scenes' rows; the Start dialog over the home column (b07) → the stack left of it; Escape with
// Encounters at 68, 60 (walkthrough H3 4) → next to home, on neither Encounters nor the Game log.
// At 1440×900 with the Fog bar, Scenes at 400, 222 (H3 1b) → no scene row under the stack; Rules
// at 430, 212 with cards (H3 2) → no Rules tab or search box under it. Placement rules: bun test
// (`keep-out.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
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

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** Drags a window by its title bar so its top-left lands at (x, y). */
async function dragTo(page: Page, win: Locator, x: number, y: number) {
  const t = await box(win.getByTestId("ui-window-title"));
  const w = await box(win);
  const grab = { x: t.x + 60, y: t.y + t.h / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (x - w.x), grab.y + (y - w.y), { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await box(win)).x)).toBe(x);
}

/** Drags the window's resize corner so it is `w` px wide. */
async function toWidth(page: Page, win: Locator, w: number) {
  const h = await box(win.getByTestId("ui-window-resize"));
  const now = (await box(win)).w;
  const x = h.x + h.w / 2;
  const y = h.y + h.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (w - now), y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await box(win)).w)).toBe(w);
}

/** None of `parts` lies under the stack, and the centre of each hits that part (not a toast). */
async function clearOf(page: Page, parts: Locator) {
  // The stack re-places within a frame of a window move or a content change (and folds).
  await page.waitForTimeout(400);
  const stack = await box(page.getByTestId("note-toasts"));
  const all = await parts.all();
  expect(all.length).toBeGreaterThan(0);
  for (const p of all) {
    const b = await box(p);
    expect(overlaps(stack, b)).toBe(false);
    const hit = await p.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!at && (el === at || el.contains(at));
    });
    expect(hit).toBe(true);
  }
}

async function dmAt(browser: Parameters<typeof rolePage>[0], width: number, height: number) {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width, height });
  await loginDm(dm, secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  return dm;
}

/**
 * The DM sends `n` test cards it owns (like damage cards) from its Notifications window, then
 * closes it: the cards fold while it's open and toast back on close (FR-NOTE-72).
 */
async function sendCards(dm: Page, n: number, tag: string) {
  const win = await openWindow(dm, "note.history");
  for (let i = 1; i <= n; i++) {
    await win.getByTestId("note-test-text").fill(`H3 ${tag} card ${i}: 6 slashing`);
    await win.getByTestId("note-test-audience").selectOption("dm");
    await win.getByTestId("note-test-owner").selectOption("dm");
    await win.getByTestId("note-test-label").fill("Apply");
    await win.getByTestId("note-test-send").click();
    await expect(
      win.getByTestId("note-history-row").filter({ hasText: `H3 ${tag} card ${i}` }),
    ).toHaveCount(1);
  }
  await win.getByTestId("ui-window-close").click();
  await expect(dm.locator('[data-testid="note-toast"][data-class="card"]').first()).toBeVisible();
}

test("FR-NOTE-75 FR-NOTE-76 FR-NOTE-77 H3 DM 1280×720: Scenes at 400, 112 → no scene row under the stack (left 480); the Start dialog → the stack left of it; Escape with Encounters at 68, 60 → beside it, off Encounters and the Game log", async ({
  browser,
}) => {
  const { recordId } = e2eEnv();
  const dm = await dmAt(browser, 1280, 720);
  const stack = dm.getByTestId("note-toasts");

  // h07: Scenes over the home column; the stack stays in its column, off the title and rows.
  const scenes = await openWindow(dm, "map.scenes");
  await dragTo(dm, scenes, 400, 112);
  await expect.poll(async () => Math.round((await box(stack)).x)).toBe(480);
  await clearOf(dm, scenes.getByTestId("ui-window-title"));
  await clearOf(dm, scenes.getByTestId("map-scene-row"));
  await scenes.getByTestId("ui-window-close").click();

  // b07: the Start dialog spans the home column → the stack shifts left of it, never over it.
  const enc = await openWindow(dm, "cbt.encounters");
  await dragTo(dm, enc, 68, 60);
  // As in the walkthrough: 440 wide, so it reaches 28 px into the home column (480..800).
  await toWidth(dm, enc, 440);
  await enc
    .locator(
      `[data-testid="cbt-enc-row"][data-record-id="${recordId("enc-friendly", "encounter")}"]`,
    )
    .click();
  await enc.getByTestId("cbt-enc-start").click();
  const dialog = dm.getByTestId("cbt-enc-start-dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => overlaps(await box(stack), await box(dialog)), { timeout: 3_000 })
    .toBe(false);
  const d = await box(dialog);
  const s = await box(stack);
  // Left of it (12 px gap) when that leaves 12 px to the rail; else above or below it.
  if (Math.round(d.x - 12 - 320) >= 80) expect(Math.round(s.x)).toBe(Math.round(d.x - 12 - 320));

  // H3 4: Escape → the stack leaves the dialog's spot: next to home (Encounters reaches into the
  // home column), never on Encounters or the Game log.
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const log = dm.locator('[data-testid="ui-window"][data-record-id^="dice.log"]');
  await expect.poll(async () => Math.round((await box(stack)).y)).toBe(100);
  const home = await box(stack);
  expect(overlaps(home, await box(enc))).toBe(false);
  if (await log.isVisible()) expect(overlaps(home, await box(log))).toBe(false);
  expect(Math.abs(home.x - 480)).toBeLessThanOrEqual(160);
  // Two live cards join: still off Encounters' rows and the Game log.
  await sendCards(dm, 2, "720");
  await clearOf(dm, enc.getByTestId("cbt-enc-entry-dec"));
  await clearOf(dm, enc.getByTestId("cbt-enc-entry-inc"));
});

test("FR-NOTE-75 FR-NOTE-77 H3 DM 1440×900: Fog bar + Scenes at 400, 222 with cards → no scene row under the stack; Rules at 430, 212 with cards → no Rules tab or search box under it", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1440, 900);
  await sendCards(dm, 3, "900");

  // H3 1b: the Fog bar and Scenes at 400, 222: no room below its rows above the Game log.
  await dm.getByTestId("map-tool-fog").click();
  await expect(dm.getByTestId("fog-bar")).toBeVisible();
  const scenes = await openWindow(dm, "map.scenes");
  await dragTo(dm, scenes, 400, 222);
  await clearOf(dm, scenes.getByTestId("ui-window-title"));
  await clearOf(dm, scenes.getByTestId("map-scene-row"));
  const s = await box(dm.getByTestId("note-toasts"));
  expect(overlaps(s, await box(dm.getByTestId("fog-bar")))).toBe(false);
  await scenes.getByTestId("ui-window-close").click();
  await dm.getByTestId("map-tool-fog").click();

  // H3 2: Rules at 430, 212 with cards pending: its tabs and search box stay clear.
  const rules = await openWindow(dm, "cmp.rules");
  await dragTo(dm, rules, 430, 212);
  await clearOf(dm, rules.getByTestId("ui-window-title"));
  await clearOf(dm, rules.getByTestId("cmp-rules-page"));
  await clearOf(dm, rules.getByTestId("cmp-rules-search"));
});
