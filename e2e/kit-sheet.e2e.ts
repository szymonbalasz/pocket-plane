// e2e-bundle: kit-parity
// Thin kit-parity K11 flow (character sheet parity, DM #361): the DM's sheet on Mira mid-fight and
// player-1's own sheet, each at the default 320 × 440 and enlarged to the kit's 680 wide, under
// Gilt & Stone (a fresh browser's theme). The stat row is the first thing on Main for both (the
// DM's report: it was missing), the HP control sits under it, Main opens at its top after another
// tab was scrolled, and nothing overflows sideways. Screenshots go to `.verify/k11-shots/` next to
// the kit page's two sheet windows. Markup, test IDs and every FR detail: bun test
// (`print-sheet.test.tsx`, `sheet-render.test.tsx`).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const SHOTS = resolve(".verify/k11-shots");
const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Drags the window's resize grip until the window is `w × h`. */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const box = await win.boundingBox();
  const grip = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !grip) throw new Error("window not shown");
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++)
    await page.mouse.move(x + ((w - box.width) * i) / 5, y + ((h - box.height) * i) / 5);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = await win.boundingBox();
      return b && [Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([w, h]);
}

/** Moves the window by its title bar so its top-left lands near (x, y). */
async function moveTo(page: Page, win: Locator, x: number, y: number) {
  const t = await win.getByTestId("ui-window-title").boundingBox();
  const b = await win.boundingBox();
  if (!t || !b) throw new Error("no title bar");
  await page.mouse.move(t.x + 40, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 40 + (t.x - b.x), y + t.height / 2 + (t.y - b.y), { steps: 5 });
  await page.mouse.up();
}

/** Main's first block is the stat row, the HP control under it; no sideways overflow. */
async function statRowFirst(win: Locator) {
  const m = await win.evaluate((w) => {
    const q = (s: string) => w.querySelector<HTMLElement>(s)?.getBoundingClientRect() ?? null;
    const content = w.querySelector<HTMLElement>('[data-testid="charx-content"]');
    const rest = w.querySelector<HTMLElement>('[data-testid="charx-header-rest"]');
    return {
      hp: q('[data-testid="charx-box"][data-value="hp"]'),
      ac: q('[data-testid="charx-box"][data-value="ac"]'),
      control: q('[data-testid="charx-hp-control"]'),
      top: (content?.getBoundingClientRect().top ?? 0) + (rest ? rest.offsetHeight + 8 : 0),
      scrollTop: content?.scrollTop ?? -1,
      overflowX: content ? content.scrollWidth - content.clientWidth : -1,
    };
  });
  // K11: the whole header stays pinned (chips line included) at the default size too, also when
  // the sheet opened before the theme's fonts loaded (the player's, open at load).
  await expect(win.getByTestId("charx-header")).toHaveAttribute("data-pinned-part", "full");
  expect(m.scrollTop).toBe(0);
  expect(m.overflowX).toBe(0);
  if (!m.hp || !m.ac) throw new Error("stat row missing");
  expect(m.ac.top - m.top).toBeLessThan(16);
  expect(m.hp.top - m.top).toBeLessThan(16);
  if (m.control) expect(m.control.top).toBeGreaterThanOrEqual(m.hp.bottom);
}

async function shoot(win: Locator, name: string) {
  await win.page().mouse.move(0, 0);
  await win.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("FR-CHARX-106 FR-CHARX-107 FR-KIT-85 kit sheet: stat row first for DM (in combat) and owner, default and enlarged, kit shots", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const miraId = recordId("char-mira", "entity");

  // The kit's two sheet windows, for the side-by-side (read-only page).
  const kit = await rolePage(browser);
  await kit.setViewportSize({ width: 1440, height: 1000 });
  await kit.goto(pathToFileURL(resolve("docs/design/art/kit/gilt-stone.html")).href);
  await kit.locator(".sheet.narrow").screenshot({ path: `${SHOTS}/kit-sheet-narrow.png` });
  await kit.locator(".sheet.full").screenshot({ path: `${SHOTS}/kit-sheet-wide.png` });
  await kit.context().close();

  // DM: Mira mid-fight ("In combat", Initiative set), default size.
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "char.sheet");
  await win.getByTestId("char-sheet-picker").selectOption(miraId);
  await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  await expect(win.getByTestId("char-sheet-combat")).toBeVisible();
  expect(await win.boundingBox()).toMatchObject({ width: 320, height: 440 });
  await statRowFirst(win);
  await shoot(win, "app-dm-default");

  // Another tab scrolled down, then Main: it opens at its top (the stat row).
  await win.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await win.getByTestId("charx-content").evaluate((c) => {
    c.scrollTop = c.scrollHeight;
  });
  await win.locator('[data-testid="charx-tab"][data-value="main"]').click();
  await statRowFirst(win);

  // The DM's public switches live in the header menu, not in rows on Main.
  await win.getByTestId("charx-public-menu").click();
  await expect(dm.getByTestId("char-sheet-public-check")).toBeVisible();
  await dm.keyboard.press("Escape");

  // Enlarged to the kit's 680 wide.
  await moveTo(dm, win, 300, 70);
  await resizeTo(dm, win, 680, 800);
  await statRowFirst(win);
  await shoot(win, "app-dm-wide");
  await dm.context().close();

  // Player 1: own sheet, default and enlarged; no DM menu.
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const sheet = await openWindow(p1, "char.sheet");
  const picker = sheet.getByTestId("char-sheet-picker");
  if (await picker.count()) await picker.selectOption(miraId);
  await expect(sheet.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  await expect(sheet.getByTestId("charx-public-menu")).toHaveCount(0);
  await statRowFirst(sheet);
  await shoot(sheet, "app-player-default");
  await moveTo(p1, sheet, 300, 70);
  await resizeTo(p1, sheet, 680, 800);
  await statRowFirst(sheet);
  await shoot(sheet, "app-player-wide");
  await p1.context().close();
});
