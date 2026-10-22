// e2e-bundle: toast-home-e2e
// Thin sprint-8 toast policy (WF4; FR-NOTE-50, -51; SHELL §13 F8, BL-59). Read-only on server
// state: opens windows and map tools, sends no intent. The DM's "1 pending action" summary drops
// below Scenes while the Fog bar pushes it out of the home band (FR-NOTE-44), and comes home
// (560, 100) as soon as the tool closes and Scenes returns (BL-59: it stayed low until a reload).
// Order, classes, overflow and the callout in detail: bun test (`toast-policy.test.ts`,
// `toast-runtime.test.tsx`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function resetLayout(page: Page) {
  await page.getByTestId("ui-launcher-menu").click();
  await page.getByTestId("ui-launcher-reset").click();
}

/** Drags a window by its title bar so its top-left lands at (x, y). */
async function dragTo(page: Page, win: Locator, x: number, y: number) {
  const t = await win.getByTestId("ui-window-title").boundingBox();
  const w = await win.boundingBox();
  if (!t || !w) throw new Error("window not shown");
  const grab = { x: t.x + 60, y: t.y + t.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (x - w.x), grab.y + (y - w.y), { steps: 6 });
  await page.mouse.up();
}

test("FR-NOTE-51 stack returns home (BL-59) F8 DM at 1440×900: the Fog bar pushes Scenes into the home band, the stack drops below its first row; the tool closes → Scenes returns and the stack is home (560, 100) within 1 s", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await resetLayout(dm);
  const stack = dm.getByTestId("note-toasts");
  await expect(dm.getByTestId("note-toast-pending-summary")).toBeVisible();
  await expect(stack).toHaveAttribute("data-top", "100");
  await expect(stack).toHaveAttribute("data-left", "560");

  // Scenes at the top-left: the Fog bar pushes it right, into the home band (sim-10 b05).
  const scenes = await openWindow(dm, "map.scenes");
  await dragTo(dm, scenes, 68, 60);
  await dm.getByTestId("map-tool-fog").click();
  await expect(dm.getByTestId("fog-bar")).toBeVisible();
  await expect(scenes).toHaveAttribute("data-placed", "pushed");
  const pushed = await scenes.boundingBox();
  if (!pushed) throw new Error("Scenes not shown");
  // Under the home row: the stack can't stay at (560, 100).
  expect(pushed.x).toBeLessThan(560 + 320);
  expect(pushed.x + pushed.width).toBeGreaterThan(560);
  // FR-NOTE-44: never on the pushed window's title bar + 40 px of body.
  await expect
    .poll(async () => Number(await stack.getAttribute("data-top")))
    .toBeGreaterThanOrEqual(Math.round(pushed.y) + 32 + 40);

  // The tool closes: Scenes returns, the stack is home at once.
  await dm.getByTestId("map-tool-select").click();
  await expect(dm.getByTestId("fog-bar")).toHaveCount(0);
  await expect(stack).toHaveAttribute("data-top", "100", { timeout: 1000 });
  await expect(stack).toHaveAttribute("data-left", "560");
  const b = await stack.boundingBox();
  expect(b && [Math.round(b.x), Math.round(b.y)]).toEqual([560, 100]);
  // FR-NOTE-50: the summary is the home item; the stack holds nothing else here.
  await expect(stack.locator("[data-testid='note-callout']")).toHaveCount(0);
  await dm.context().close();
});
