// e2e-bundle: notifications
// FR-SHELL-01: one toast region per client. An alert Toast and a notification toast shown at the
// same time stack in the region; neither covers the other (DM top-centre, player bottom-right).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function rect(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

/** Alert while the pending summary toast is up: both fully visible, no overlap. */
async function alertBesideNotification(page: Page) {
  const note = page.getByTestId("note-toast-pending-summary");
  await expect(note).toBeVisible();
  const win = await openWindow(page, "shell.test");
  await win.getByTestId("shell-test-alert").click();
  const alert = page.getByTestId("ui-alert-toast");
  await expect(alert).toHaveText("Test alert");
  await expect(note).toBeVisible();
  // Let sonner's enter transition settle before measuring.
  await expect(alert).toHaveAttribute("data-mounted", "true");
  await page.waitForTimeout(500);
  const a = await rect(alert);
  const n = await rect(note);
  const apart = a.y >= n.y + n.height || n.y >= a.y + a.height;
  expect(apart, `alert ${JSON.stringify(a)} overlaps note ${JSON.stringify(n)}`).toBe(true);
  return { a, n };
}

test("FR-SHELL-01 player: alert Toast and notification toast stack bottom-right, both visible", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p = await rolePage(browser);
  await p.goto(link("Player 1"));
  const { a, n } = await alertBesideNotification(p);
  const vw = p.viewportSize()?.width ?? 0;
  expect(a.x + a.width).toBeGreaterThan(vw - 40); // right edge
  expect(n.x + n.width).toBeGreaterThan(vw - 40);
  await p.context().close();
});

test("FR-SHELL-01 DM: alert Toast and notification toast stack top-centre, both visible", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  const { a, n } = await alertBesideNotification(dm);
  const mid = (dm.viewportSize()?.width ?? 0) / 2;
  expect(Math.abs(a.x + a.width / 2 - mid)).toBeLessThan(4); // centred
  expect(Math.abs(n.x + n.width / 2 - mid)).toBeLessThan(4);
  expect(Math.min(a.y, n.y)).toBeGreaterThanOrEqual(48); // below the top bar
  await dm.context().close();
});
