// Play-shell helpers (SHELL §7 test IDs).
import type { Locator, Page } from "@playwright/test";

export const launcherButton = (page: Page, kind: string): Locator =>
  page.locator(`[data-testid="ui-launcher-button"][data-record-id="${kind}"]`);

export const shellWindow = (page: Page, kind: string, instance = "main"): Locator =>
  page.locator(`[data-testid="ui-window"][data-record-id="${kind}:${instance}"]`);

/**
 * Opens a window via its launcher button unless it is already open; a button the bar moved into
 * the "⋯" menu (FR-SHELL-43: narrow viewports, more launcher entries) is picked there. The
 * launcher toggles (FR-SHELL-09), so after an action that opens the window itself (e.g. Start,
 * FR-CBT-60) wait for that first: a click landing just after it would minimise the window again.
 */
export async function openWindow(page: Page, kind: string): Promise<Locator> {
  const win = shellWindow(page, kind);
  if (!(await win.isVisible())) {
    // The bar may still be rendering (a test-mode window appears with the snapshot): wait for the
    // button a while before looking in the menu. Only its presence decides bar or menu: a click
    // can wait on a page that isn't painting (BL-148: right after a resize under CI load, both
    // pages paint nothing for 4–7 s), and that is no reason to look in the menu.
    const button = launcherButton(page, kind);
    const inBar = await button.waitFor({ state: "attached", timeout: 5_000 }).then(
      () => true,
      () => false,
    );
    if (inBar) {
      await button.click({ timeout: 20_000 }).catch(async (err: Error) => {
        const why = `openWindow(${kind}): in the bar, can't click it: ${await hitAt(button)}`;
        throw new Error(`${why}\n${err.message}`);
      });
    } else {
      await page.getByTestId("ui-launcher-menu").click();
      const item = page.locator(
        `[data-testid="ui-launcher-overflow-item"][data-record-id="${kind}"]`,
      );
      // Fail in seconds with what the bar does show, not at the test's timeout.
      await item.click({ timeout: 10_000 }).catch(async (err: Error) => {
        const ids = (testid: string) =>
          page
            .locator(`[data-testid="${testid}"]`)
            .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));
        const [bar, menu] = await Promise.all([
          ids("ui-launcher-button"),
          ids("ui-launcher-overflow-item"),
        ]);
        const why = `openWindow(${kind}): not in the launcher. Bar: ${bar.join(", ")}. Menu: ${menu.join(", ") || "(none)"}`;
        throw new Error(`${why}\n${err.message}`);
      });
    }
  }
  await win.waitFor({ state: "visible" });
  return win;
}

/** What takes a click at the centre of `el` now: the element on top, or why nothing covers it. */
async function hitAt(el: Locator): Promise<string> {
  return el
    .evaluate((node) => {
      const r = node.getBoundingClientRect();
      const box = `box ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`;
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!top) return `${box}, its centre is off the page`;
      if (node.contains(top)) {
        return `${box}, nothing covers it (still moving, or the page isn't painting)`;
      }
      const hit = top.closest("[data-testid]") ?? top;
      const id = (a: string) => hit.getAttribute(a) ?? "";
      return `${box}, covered by <${hit.tagName.toLowerCase()} data-testid="${id("data-testid")}" data-record-id="${id("data-record-id")}" aria-label="${id("aria-label")}">`;
    })
    .catch((e: Error) => `(no answer from the page: ${e.message.split("\n")[0]})`);
}
