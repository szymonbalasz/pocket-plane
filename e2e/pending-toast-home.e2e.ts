// e2e-bundle: toast-home-e2e
// Thin sprint-6 toast home (SHELL §13 F5, track WF2; FR-NOTE-42, -43, FR-SHELL-59). Read-only on
// server state: opens windows and map tools, sends no intent. The DM's "1 pending action" summary
// (sim-9's ruled card) stays at its top-centre home with Scenes and a tool bar open, and every
// tool bar control is hit at its centre (sim-9 b01: 6 / 16 Fog bar controls under the summary).
// Placement rules in detail: bun test (`keep-out.test.ts`, `toast-runtime.test.tsx`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

async function resetLayout(page: Page) {
  await page.getByTestId("ui-launcher-menu").click();
  await page.getByTestId("ui-launcher-reset").click();
}

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

/**
 * The tool panel's controls (`selector`) whose centre hits something else (elementFromPoint):
 * "‹control›→‹what is hit›"; and how many controls there are.
 */
const blocked = (page: Page, selector: string) =>
  page.getByTestId("map-tool-panel").evaluate((panel, sel) => {
    const els = [...panel.querySelectorAll<HTMLElement>(sel)].filter(
      (e) => e.getBoundingClientRect().width > 0,
    );
    const out = els.flatMap((e) => {
      const r = e.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      // A disabled control (Redo with nothing to redo) lets the hit through to its own group:
      // nothing covers it either.
      return at && (e.contains(at) || at.contains(e))
        ? []
        : [`${e.dataset.testid}→${at?.closest("[data-testid]")?.getAttribute("data-testid")}`];
    });
    return { count: els.length, out };
  }, selector);

test("FR-NOTE-42 FR-NOTE-43 F5 DM at 1440×900, then 1280×720: with the pending summary showing, Scenes at the top-left and the Fog tool picked, the stack stays at its home and every Fog bar control is hit at its centre; AoE and Structure too", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const stack = dm.getByTestId("note-toasts");
  const summary = dm.getByTestId("note-toast-pending-summary");
  await expect(summary).toBeVisible();

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await dm.setViewportSize(size);
    await resetLayout(dm);
    const home = (size.width - 320) / 2;
    const scenes = await openWindow(dm, "map.scenes");
    await dragTo(dm, scenes, 68, 60);
    await dm.getByTestId("map-tool-fog").click();
    const panel = dm.getByTestId("map-tool-panel");
    await expect(dm.getByTestId("fog-bar")).toBeVisible();
    await expect(scenes).toHaveAttribute("data-placed", "pushed");
    await expect(summary).toBeVisible();
    // FR-NOTE-42: at its home, never x 68 (b01: 68..388 × 100..157).
    await expect(stack).toHaveAttribute("data-left", String(home));
    expect((await box(stack)).x).toBe(home);
    // FR-NOTE-43: off the bar; all 16 Fog bar controls hit at their centre.
    expect(overlaps(await box(stack), await box(panel))).toBe(false);
    const fog = await blocked(dm, 'button[data-testid^="fog-"]');
    expect(fog.out).toEqual([]);
    expect(fog.count).toBe(16);
    // FR-SHELL-59: the stack reports its rendered rect (`ui-toast-corner` `data-shown`).
    const s = await box(stack);
    await expect(dm.getByTestId("ui-toast-corner")).toHaveAttribute(
      "data-shown",
      `${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.w)},${Math.round(s.h)}`,
    );

    for (const tool of ["map-tool-aoe", "map-tool-structure"]) {
      await dm.getByTestId(tool).click();
      await expect(panel).toBeVisible();
      await expect(stack).toHaveAttribute("data-left", String(home));
      expect(overlaps(await box(stack), await box(panel))).toBe(false);
      const controls = await blocked(dm, "button, input, select, [role='combobox']");
      expect(controls.out).toEqual([]);
      expect(controls.count).toBeGreaterThan(0);
    }
    await dm.getByTestId("map-tool-select").click();
    await expect(panel).toHaveCount(0);
  }
  await dm.context().close();
});
