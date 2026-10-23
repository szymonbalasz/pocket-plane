// e2e-bundle: fx-toasts-e2e
// Thin FX1 flows (NOTE §13 FX1, sprint 9; FR-NOTE-70, -72): the DM at 1280×720 with sim-12's
// pending cards. Scenes dragged to 400, 112 over the home column (sim-12 c01) → the stack stays at
// left 480 (never 68), drawn where it says (`data-left` / `data-top`, the FR-SHELL-59 report).
// The Notifications window opened at the home (r03) → no toast box over it and no card or summary
// toast while it's open; closing it brings the summary back. Placement rules, the fold model and
// the callout node: bun test (`keep-out.test.ts`, `toast-runtime.test.tsx`).
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
}

test("FR-NOTE-70 FR-NOTE-72 FX1 DM 1280×720: Scenes dragged to 400, 112 → the stack stays at left 480, drawn where it says; Notifications opened at the home → no toast over it, cards folded, back on close", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  const stack = dm.getByTestId("note-toasts");
  const summary = dm.getByTestId("note-toast-pending-summary");
  await expect(summary).toBeVisible();

  // FR-NOTE-70 (c01): Scenes over the home column → home left 480, never 68 or beside Scenes.
  const scenes = await openWindow(dm, "map.scenes");
  await dragTo(dm, scenes, 400, 112);
  await expect.poll(async () => Math.round((await box(scenes)).x)).toBe(400);
  await expect.poll(async () => Math.round((await box(stack)).x)).toBe(480);
  // The drawn rect is the computed one (within 1 px) and the one reported for the Fit.
  const s = await box(stack);
  expect(Math.abs(s.x - Number(await stack.getAttribute("data-left")))).toBeLessThanOrEqual(1);
  expect(Math.abs(s.y - Number(await stack.getAttribute("data-top")))).toBeLessThanOrEqual(1);
  await expect(dm.getByTestId("ui-toast-corner")).toHaveAttribute(
    "data-shown",
    `${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.w)},${Math.round(s.h)}`,
  );
  // Never on Scenes' title bar.
  const title = await box(scenes.getByTestId("ui-window-title"));
  expect(overlaps(s, title)).toBe(false);

  // FR-NOTE-72 (r03): the Notifications window at the home → no toast box intersects it; the
  // cards and the summary fold into it while it's open.
  await scenes.getByTestId("ui-window-close").click();
  const notes = await openWindow(dm, "note.history");
  await dragTo(dm, notes, 480, 60);
  await expect.poll(async () => Math.round((await box(notes)).x)).toBe(480);
  await expect(summary).toHaveCount(0);
  await expect(dm.locator('[data-testid="note-toast"][data-class="card"]')).toHaveCount(0);
  const n = await box(notes);
  for (const t of await dm.getByTestId("note-toast").all()) {
    expect(overlaps(await box(t), n)).toBe(false);
  }
  // Closed → the summary is back (silently), at its home.
  await notes.getByTestId("ui-window-close").click();
  await expect(summary).toBeVisible();
  await expect.poll(async () => Math.round((await box(stack)).x)).toBe(480);
});
