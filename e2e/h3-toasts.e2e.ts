// e2e-bundle: h3-toasts-e2e
// Thin H3 flows (sprint 10, BL-101; FR-NOTE-75, -76): the DM with sim-12's pending cards (the
// "N pending actions" summary). At 1280×720 Scenes dragged to 400, 112 over the home column
// (sim-13 h07) → the stack keeps left 480 and covers none of Scenes' rows; the Start dialog over
// the home column (b07) → the stack shifts left of it, never over it, and comes home when it
// closes. At 1440×900 Scenes and Rules over the home spot (h08, f04) → no scene row, Rules tab or
// search box under the stack. Placement rules: bun test (`keep-out.test.ts`).
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

/** None of `parts` lies under the stack, and the centre of each hits that part (not a toast). */
async function clearOf(page: Page, parts: Locator) {
  // The stack re-places within a frame of a window move or a content change.
  await page.waitForTimeout(300);
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

test("FR-NOTE-75 FR-NOTE-76 H3 DM 1280×720: Scenes at 400, 112 → no scene row under the stack (left 480); the Start dialog over the home column → the stack left of it, home again after Cancel", async ({
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
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await enc.getByTestId("ui-window-close").click();
  await expect.poll(async () => Math.round((await box(stack)).x)).toBe(480);
});

test("FR-NOTE-75 H3 DM 1440×900: Scenes and Rules over the home spot → no scene row, Rules tab or search box under the stack", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1440, 900);
  const stack = dm.getByTestId("note-toasts");

  // h08: Scenes over the home spot.
  const scenes = await openWindow(dm, "map.scenes");
  await dragTo(dm, scenes, 500, 90);
  await expect.poll(async () => Math.round((await box(stack)).x)).toBe(560);
  await clearOf(dm, scenes.getByTestId("ui-window-title"));
  await clearOf(dm, scenes.getByTestId("map-scene-row"));
  await scenes.getByTestId("ui-window-close").click();

  // f04: Rules over the home spot: its tabs and search box stay clear.
  const rules = await openWindow(dm, "cmp.rules");
  await dragTo(dm, rules, 430, 90);
  await clearOf(dm, rules.getByTestId("ui-window-title"));
  await clearOf(dm, rules.getByTestId("cmp-rules-page"));
  await clearOf(dm, rules.getByTestId("cmp-rules-search"));
});
