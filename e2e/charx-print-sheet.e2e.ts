// e2e-bundle: character-sheet-full
// Printed sheet (CHARX §6.2, §13 E2E): player-1's Mira at 320 × 440: boxes and shield shown,
// nothing overflows sideways; the DEX modifier rolls a check; Stealth's breakdown Tooltip; the
// tab strip's wheel + arrows; resize to 600 → wide layout, back to 320 → narrow; 280 px fits
// (ability cells ≥ 80 px). Layout only: no new records (CON-44 unchanged).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const box = (win: Locator, key: string) =>
  win.locator(`[data-testid="charx-box"][data-value="${key}"]`);

async function drag(page: Page, from: { x: number; y: number }, dx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y, { steps: 4 });
  await page.mouse.up();
}

/** Drags the window's resize handle sideways until the window is `w` px wide. */
async function resizeTo(page: Page, win: Locator, w: number) {
  const now = (await win.boundingBox())?.width ?? 0;
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!handle) throw new Error("no resize handle");
  await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, w - now);
  await expect.poll(async () => Math.round((await win.boundingBox())?.width ?? 0)).toBe(w);
}

/** The real layout: sideways overflow, ability cells' widths and columns, Skills beside them. */
const layout = (win: Locator) =>
  win.evaluate((w) => {
    const q = (s: string) => w.querySelector<HTMLElement>(s);
    const content = q('[data-testid="charx-content"]');
    const cells = [...w.querySelectorAll<HTMLElement>('[data-testid="char-sheet-ability"]')];
    const rects = cells.map((c) => c.getBoundingClientRect());
    const skills = q('[data-testid="charx-box"][data-value="skills"]')?.getBoundingClientRect();
    return {
      overflowX: content ? content.scrollWidth - content.clientWidth : -1,
      minCell: Math.min(...rects.map((r) => r.width)),
      columns: new Set(rects.map((r) => Math.round(r.left))).size,
      skillsBeside: skills ? skills.left >= Math.max(...rects.map((r) => r.right)) : false,
    };
  });

test("FR-CHARX-105 FR-CHARX-106 FR-CHARX-109 FR-CHARX-112 FR-CHARX-113 FR-CHARX-115 FR-CHARX-118 printed sheet: boxes at 320 × 440, check roll, breakdown, tab strip, wide at 600, 280 px fit", async ({
  browser,
}) => {
  const { link, recordId } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const win = await openWindow(p1, "char.sheet");
  // Specs sharing the bundle may add characters that sort before Mira: pick her.
  const miraId = recordId("char-mira", "entity");
  const picker = win.getByTestId("char-sheet-picker");
  if (await picker.count()) await picker.selectOption(miraId);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  // PS1: the default 320 × 440; every box and the shield show, nothing clipped sideways.
  expect(await win.boundingBox()).toMatchObject({ width: 320, height: 440 });
  for (const key of ["ac", "hp", "speed", "init", "prof", "skills", "passives"]) {
    await expect(box(win, key)).toBeVisible();
  }
  await expect(box(win, "ac").locator("svg")).toBeVisible();
  await expect(box(win, "init").getByTestId("char-sheet-roll-init")).toBeVisible();
  const narrow = await layout(win);
  expect(narrow).toMatchObject({ overflowX: 0, columns: 3, skillsBeside: false });
  expect(narrow.minCell).toBeGreaterThanOrEqual(80);

  // PS2: the DEX modifier is the Check button; Save rolls the save.
  await openWindow(p1, "dice.log");
  const dex = win.locator('[data-testid="char-sheet-roll-check"][data-value="dex"]');
  await dex.scrollIntoViewIfNeeded();
  await dex.click();
  await expect(p1.getByTestId("dice-log-entry").filter({ hasText: "Dexterity check" })).toHaveCount(
    1,
  );
  await win.locator('[data-testid="char-sheet-roll-save"][data-value="dex"]').click();
  await expect(p1.getByTestId("dice-log-entry").filter({ hasText: "Dexterity save" })).toHaveCount(
    1,
  );

  // PS3: Stealth's breakdown Tooltip.
  const stealth = win.locator('[data-testid="charx-roll-skill"][data-value="stealth"]');
  await stealth.scrollIntoViewIfNeeded();
  await stealth.hover();
  const tip = p1.locator('[data-testid="charx-breakdown"][data-value="skill.stealth"]');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(/^Stealth [+−]\d+ · DEX [+−]\d+/);
  await p1.mouse.move(0, 0);

  // PS4: the tab strip overflows at 320: the wheel scrolls it sideways, the arrows show.
  const strip = win.getByRole("tablist");
  const scroller = strip.locator("xpath=..");
  await expect(win.getByTestId("charx-tabs-next")).toBeVisible();
  // K11: the slot stays (no shift while scrolling), the arrow hidden while nothing is before.
  await expect(win.getByTestId("charx-tabs-prev")).toBeHidden();
  const s = await strip.boundingBox();
  await p1.mouse.move((s?.x ?? 0) + 40, (s?.y ?? 0) + (s?.height ?? 0) / 2);
  await p1.mouse.wheel(0, 200);
  await expect.poll(() => scroller.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  await expect(win.getByTestId("charx-tabs-prev")).toBeVisible();
  expect(await scroller.evaluate((e) => e.scrollTop)).toBe(0);
  await win.getByTestId("charx-tabs-prev").click();
  await expect.poll(() => scroller.evaluate((e) => e.scrollLeft)).toBeLessThan(200);

  // PS5: 600 px → wide (abilities one column, Skills beside), back to 320 → narrow, live. The
  // window goes left first so it has room to grow.
  const title = await win.getByTestId("ui-window-title").boundingBox();
  if (!title) throw new Error("no title bar");
  await drag(p1, { x: title.x + 40, y: title.y + title.height / 2 }, 200 - title.x);
  await resizeTo(p1, win, 600);
  await expect.poll(async () => (await layout(win)).columns).toBe(1);
  expect(await layout(win)).toMatchObject({ overflowX: 0, skillsBeside: true });
  await resizeTo(p1, win, 320);
  await expect.poll(async () => (await layout(win)).columns).toBe(3);
  expect((await layout(win)).skillsBeside).toBe(false);

  // FR-CHARX-118: the 280 px minimum: nothing overflows sideways, cells ≥ 80 px (2 columns).
  await resizeTo(p1, win, 280);
  const min = await layout(win);
  expect(min).toMatchObject({ overflowX: 0, columns: 2 });
  expect(min.minCell).toBeGreaterThanOrEqual(80);
  await p1.context().close();
});
