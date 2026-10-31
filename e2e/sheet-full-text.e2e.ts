// e2e-bundle: uses-negative
// Full text on the sheet (FR-CHARX-114, the DM's Hexblade report): Mira gets a feature with a long
// unbroken name and several lines of text (one very long word) and an item with a long name and
// notes. At the 280-px minimum every tab wraps it with nothing overflowing sideways; enlarged, wide
// Main's Limited uses box shows the whole text, all lines, the dice rollable, no Tooltip needed.
// Markup per viewer and the rest of the scan: bun test (`print-sheet.test.tsx`, `full-text.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const NAME = "Accursed-Specter-Of-The-Very-Long-Unbroken-Feature-Name-Here";
const WORD = "Hexbladecursedsoulboundspectralshadowarmourofthedarkfathom";
const LINES = [
  "Bonus action: curse one creature you can see within 30 feet for one minute.",
  `On a hit add 1d6 necrotic to the damage. ${WORD} is the word that must still wrap.`,
  "Ends early when the target dies or you are incapacitated. Regain hit points on its death.",
];
const BODY = LINES.join("\n");
const ITEM = "Dark Fathom Armor of the Very Long Name";
const NOTES = "Worn under the robes; it hums near water and the wearer swims at full speed.";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const tab = (sheet: Locator, value: string) =>
  sheet.locator(`[data-testid="charx-tab"][data-value="${value}"]`).click();

/** The last field whose path ends `.<key>` in `list` (the row just added). */
const newField = (sheet: Locator, list: string, key: string) =>
  sheet
    .locator(`[data-testid="charx-field"][data-value^="${list}."][data-value$=".${key}"]`)
    .last();

async function setText(field: Locator, value: string) {
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
}

async function resizeTo(page: Page, win: Locator, w: number) {
  const now = (await win.boundingBox())?.width ?? 0;
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!handle) throw new Error("no resize handle");
  const y = handle.y + handle.height / 2;
  const x = handle.x + handle.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (w - now) / 2, y, { steps: 4 });
  await page.mouse.move(x + (w - now), y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await win.boundingBox())?.width ?? 0)).toBe(w);
}

async function moveTo(page: Page, win: Locator, x: number, y: number) {
  const t = await win.getByTestId("ui-window-title").boundingBox();
  const b = await win.boundingBox();
  if (!t || !b) throw new Error("no title bar");
  await page.mouse.move(t.x + 40, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 40 + (t.x - b.x), y + t.height / 2 + (t.y - b.y), { steps: 5 });
  await page.mouse.up();
}

/** Sideways overflow of the tab's content and of any element inside it. */
const overflow = (win: Locator) =>
  win.getByTestId("charx-content").evaluate((c) => {
    const box = c.getBoundingClientRect();
    const out = [...c.querySelectorAll<HTMLElement>("*")].filter(
      (e) => e.getClientRects().length > 0 && e.getBoundingClientRect().right > box.right + 1,
    );
    return {
      scroll: c.scrollWidth - c.clientWidth,
      past: out.slice(0, 5).map((e) => e.dataset.testid ?? e.tagName),
    };
  });

/** A paragraph's real look: all its text, its line count, and nothing clipped or ellipsed. */
const para = (p: Locator) =>
  p.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      text: e.textContent,
      lines: Math.round(e.getBoundingClientRect().height / Number.parseFloat(s.lineHeight)),
      clipped: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1,
      ellipsis: s.textOverflow === "ellipsis",
    };
  });

test("FR-CHARX-114 FR-CHARX-118 full text: long feature and item text wraps at 280 px with no sideways overflow; wide Main's Limited uses shows every line", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, recordId("char-mira", "entity"));

  // The long feature and item, typed in as the DM would.
  await win.getByTestId("charx-edit-toggle").click();
  await tab(win, "features");
  await win.locator('[data-testid="charx-row-add"][data-value="features"]').click();
  await expect(newField(win, "features", "name")).toHaveValue("New feature");
  await setText(newField(win, "features", "name"), NAME);
  await setText(newField(win, "features", "usesMax"), "2");
  const text = newField(win, "features", "text");
  await text.fill(BODY);
  const path = await text.getAttribute("data-value");
  await win.locator(`[data-testid="charx-field-save"][data-value="${path}"]`).click();
  await expect(
    win.locator(`[data-testid="charx-field-save"][data-value="${path}"]`),
  ).toBeDisabled();
  await tab(win, "inventory");
  await win.locator('[data-testid="charx-row-add"][data-value="items"]').click();
  await expect(newField(win, "items", "name")).toHaveValue("New item");
  await setText(newField(win, "items", "name"), ITEM);
  await setText(newField(win, "items", "notes"), NOTES);
  await win.getByTestId("charx-edit-toggle").click();
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-editing", "false");

  // 280 px, the sheet's minimum: every tab wraps, nothing runs past the content's right edge.
  await resizeTo(dm, win, 280);
  for (const key of ["main", "actions", "features", "inventory"]) {
    await tab(win, key);
    expect({ key, ...(await overflow(win)) }).toEqual({ key, scroll: 0, past: [] });
  }
  await tab(win, "features");
  const row = win.getByTestId("charx-feature").filter({ hasText: NAME });
  await expect(row).toContainText(WORD);
  await win.screenshot({ path: ".verify/sheet-full-text/features-280.png" });
  const narrow = await para(row.locator("p"));
  expect(narrow.text).toBe(BODY);
  expect(narrow.lines).toBeGreaterThan(LINES.length);
  expect(narrow.clipped).toBe(false);
  await tab(win, "inventory");
  const item = win.getByTestId("charx-item").filter({ hasText: ITEM });
  await expect(item).toContainText(NOTES);

  // Wide Main: the Limited uses row carries the same whole text, not one cut line.
  await tab(win, "main");
  await moveTo(dm, win, 300, 70);
  await resizeTo(dm, win, 680);
  const uses = win.locator('[data-testid="charx-box"][data-value="uses"][data-scope="main"]');
  await expect(uses).toBeVisible();
  const main = uses.locator('[data-testid="charx-feature"]').filter({ hasText: NAME });
  const wide = await para(main.locator("p"));
  expect(wide.text).toBe(BODY);
  expect(wide.lines).toBeGreaterThanOrEqual(LINES.length);
  expect(wide.clipped).toBe(false);
  expect(wide.ellipsis).toBe(false);
  await uses.scrollIntoViewIfNeeded();
  await win.screenshot({ path: ".verify/sheet-full-text/limited-uses-680.png" });
  await expect(main.getByTestId("dicex-notation").first()).toHaveAttribute("data-value", "1d6");
  expect(await overflow(win)).toEqual({ scroll: 0, past: [] });
});
