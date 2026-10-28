// e2e-bundle: s14-kit-e2e
// Thin sprint 14 F3 flows (kit nits; BL-138, BL-139, BL-141). The DM with sim-12's pending rows
// (the "N pending actions" summary) at 1280×720 opens the Compendium's modal homebrew dialog over
// the home column (F2 walkthrough side finding: the summary sat on its Name field): the summary
// goes compact (FR-NOTE-79) left of the dialog, off it, and the Name field takes the click.
// Placement rules: bun test (`keep-out-compact.test.ts`).
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

/** The element at `l`'s centre is `l` (or inside it): nothing drawn over it. */
const onTop = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!at && (el === at || el.contains(at));
  });

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

test("FR-NOTE-79 FR-NOTE-76 F2 side finding DM 1280×720: the modal homebrew dialog over the home column → the summary goes compact, left of the dialog, off its Name field", async ({
  browser,
}) => {
  const dm = await dmAt(browser, 1280, 720);
  const win = await openWindow(dm, "cmp.compendium");
  await win.getByTestId("cmp-new").click();
  const form = dm.getByTestId("cmp-form");
  await expect(form).toBeVisible();
  const stack = dm.getByTestId("note-toasts");
  const summary = dm.getByTestId("note-toast-pending-summary");
  await expect(summary).toHaveAttribute("data-compact", "true");
  await expect(stack).toHaveAttribute("data-settled", "true");
  await expect
    .poll(async () => overlaps(await box(stack), await box(form)), { timeout: 3_000 })
    .toBe(false);
  const s = await box(stack);
  const f = await box(form);
  expect(s.x + s.w).toBeLessThanOrEqual(f.x);
  expect(s.x).toBeGreaterThanOrEqual(80);
  // One short line, with Open still one click away.
  expect(s.h).toBeLessThanOrEqual(44);
  await expect(summary.getByTestId("note-toast-open")).toBeVisible();
  const name = form.getByTestId("cmp-form-name");
  expect(await onTop(name)).toBe(true);
  await name.click();
  await name.fill("Lamp 7");
  await expect(name).toHaveValue("Lamp 7");
});
