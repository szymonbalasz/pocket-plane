// e2e-bundle: dice-log
// FR-SHELL-30 shared Tooltip vs Radix's `tooltip.open` document event (#387): Radix fires it
// whenever one of its tooltips opens (its own delayed-open timer, a trigger's focus). Landing
// just after ours opened, it used to close ours under a resting pointer. Game log rows are the
// probe's triggers: hovering a row's text opens its Tooltip with the full line.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

/** A row's Tooltip trigger; Radix mirrors our open state on it (`delayed-open` / `instant-open`). */
const text = (entry: Locator) => entry.getByTestId("dice-log-entry-text");
const OPEN = /^(delayed|instant)-open$/;

/** Dispatches Radix's event, then lets React commit and paint whatever it caused. */
async function strayTooltipOpen(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        document.dispatchEvent(new CustomEvent("tooltip.open"));
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
}

test("FR-SHELL-30 a stray Radix tooltip.open keeps an open Tooltip open; moving to another trigger hands over", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await openWindow(dm, "dice.log");
  const entries = dm.getByTestId("dice-log-entry");
  // The bundle's four rows, plus any an earlier spec on this server rolled.
  const [a, b] = [entries.nth(0), entries.nth(1)];
  for (const e of [a, b]) await expect(e).toHaveAttribute("data-landed", "true");
  // The open bubble (a closing one stays in the DOM with `data-state="closed"`).
  const allOpen = dm.locator('[data-testid="ui-tooltip"]:not([data-state="closed"])');
  const isOpen = async (e: Locator) => {
    await expect(text(e)).toHaveAttribute("data-state", OPEN);
    await expect(allOpen).toHaveCount(1);
    await expect(allOpen.getByTestId("dice-log-entry-details")).toBeVisible();
  };

  // Pointer rests on row A's text: its Tooltip opens; the stray event leaves it open.
  await text(a).hover();
  await isOpen(a);
  await strayTooltipOpen(dm);
  await isOpen(a);
  await strayTooltipOpen(dm);
  await isOpen(a);

  // Hand-over: onto row B, B's opens (skip window) and A's closes; one open at a time.
  await text(b).hover();
  await isOpen(b);
  await expect(text(a)).toHaveAttribute("data-state", "closed");
  await strayTooltipOpen(dm);
  await isOpen(b);

  // Real closes still apply: Escape, then leaving the trigger.
  await dm.keyboard.press("Escape");
  await expect(text(b)).toHaveAttribute("data-state", "closed");
  await expect(allOpen).toHaveCount(0);
  await dm.mouse.move(0, 0);
  await text(a).hover();
  await isOpen(a);
  await dm.mouse.move(0, 0);
  await expect(text(a)).toHaveAttribute("data-state", "closed");
  await expect(allOpen).toHaveCount(0);
});
