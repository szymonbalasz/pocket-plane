// e2e-bundle: uses-negative
// A sheet name over its limit never goes silently: the field says so as soon as it is over, and
// leaving edit mode with it still over says the text was not saved (FR-CHARX-27).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";
import { resizeTo } from "./support/text-fit";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-CHARX-27 an over-limit name says so while typing and when edit mode closes", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, recordId("char-mira", "entity"));
  await win.getByTestId("charx-edit-toggle").click();
  await win.locator('[data-testid="charx-tab"][data-value="actions"]').click();

  const name = win
    .locator('[data-testid="charx-field"][data-value^="attacks."][data-value$=".name"]')
    .first();
  const before = await name.inputValue();
  const long = "A".repeat(56);
  await name.fill(long);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(win.getByTestId("charx-field-error")).toHaveText("At most 40 characters");
  await name.blur();
  await expect(name).toHaveValue(long);
  await expect(win.getByTestId("charx-field-error")).toHaveText("At most 40 characters");

  await win.getByTestId("charx-edit-toggle").click();
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-editing", "false");
  await expect(dm.getByText("Attack name not saved: At most 40 characters")).toBeVisible();
  await expect(win).toContainText(before);
  await expect(win).not.toContainText(long);
});

test("FR-KIT-85 the level line wraps between parts with no dot at the start or end of a line", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, recordId("char-mira", "entity"));
  await resizeTo(dm, win, 280);
  const level = win.getByTestId("char-sheet-level");
  const facts = await level.evaluate((line) => {
    // A long species, as the sheet would draw it: real element, real CSS.
    const parts = [...line.querySelectorAll<HTMLElement>("span.relative")];
    const last = parts.at(-1);
    if (!last?.lastChild) throw new Error("no later part");
    last.lastChild.textContent = "Stormborn Descendant of the Far Isles";
    const edge = line.getBoundingClientRect().left;
    return {
      text: line.textContent,
      parts: parts.map((p) => {
        const dot = p.querySelector("span")?.getBoundingClientRect();
        const box = p.getBoundingClientRect();
        return { top: box.top, left: box.left - edge, dotRight: dot ? dot.right - edge : null };
      }),
    };
  });
  await level.screenshot({ path: test.info().outputPath("level-280.png") });
  const [first, second] = facts.parts;
  if (!first || !second) throw new Error("two parts expected");
  // The species took its own line, flush with the column, its dot clipped outside the line.
  expect(second.top).toBeGreaterThan(first.top);
  expect(Math.abs(second.left)).toBeLessThanOrEqual(1);
  expect(second.dotRight).toBeLessThanOrEqual(1);
  expect(Math.abs(first.left)).toBeLessThanOrEqual(1);
  expect(facts.text).toContain("· Stormborn");
});
