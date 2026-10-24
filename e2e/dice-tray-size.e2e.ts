// e2e-bundle: base
// T1 / T5 (sprint 10, DM #343, #347; FR-DICEX-96): the Dice tray opens 25 % bigger and its dice
// scale with it. An empty map (bundle `base`, no scene), so placement has room for the whole
// default: the DM at 1440×900 gets 450 × 375 and 50-px dice (× 1.25); resized to the useful 360 × 300 the
// dice are 48 px (× 1.2, orchestrator ruling), a typical stage (5 dice + adv, constant) one by one
// with the compact 28-px notation row. Player 1 at 1280×720: the default, dice ≥ 48 px. Roll is
// inside the window and the `elementFromPoint` hit, the body never scrolls. Client-only: no intent.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** The window's size, the dice scale, a die's box and Roll's place, from the real layout. */
const facts = (win: Locator) =>
  win.evaluate((w) => {
    const q = (id: string) => w.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const tray = q("dicex-tray");
    const roll = q("dicex-tray-roll");
    const die = q("dicex-tray-die");
    const area = q("dicex-tray-area");
    const preview = q("dicex-tray-preview");
    const expr = q("dicex-tray-expression");
    if (!tray || !roll || !die || !expr || !area || !preview) throw new Error("tray parts missing");
    const wr = w.getBoundingClientRect();
    const r = roll.getBoundingClientRect();
    const body = tray.parentElement as HTMLElement;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const inside = (b: DOMRect) =>
      b.left >= wr.left && b.right <= wr.right && b.top >= wr.top && b.bottom <= wr.bottom;
    return {
      win: { w: Math.round(wr.width), h: Math.round(wr.height) },
      scale: Number(tray.dataset.scale),
      px: Number(preview.dataset.px),
      die: Math.round(die.getBoundingClientRect().height),
      /** The smallest die box (every staged die). */
      smallest: Math.min(
        ...[...w.querySelectorAll('[data-testid="dicex-tray-die"]')].map((d) =>
          Math.round(d.getBoundingClientRect().height),
        ),
      ),
      grouped: preview.dataset.grouped === "true",
      areaScrolls: area.scrollHeight > area.clientHeight,
      expression: Math.round(expr.getBoundingClientRect().height),
      rollInside: inside(r),
      expressionInside: inside(expr.getBoundingClientRect()),
      hit: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      bodyScrolls: body.scrollHeight > body.clientHeight,
    };
  });

/** Palette d6, d6, d8 and constant 1 (sim-9 d01's roll). */
async function stage(tray: Locator) {
  for (const f of [6, 6, 8]) {
    await tray.locator(`[data-testid="dicex-tray-palette"][data-value="${f}"]`).click();
  }
  await tray.getByTestId("dicex-tray-constant").fill("1");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(3);
}

test("FR-DICEX-96 tray default size and dice scale: DM 1440×900 opens 450 × 375 with 50-px dice and Roll visible; at the useful 360 × 300 the dice are 48 px, 5 dice + adv one by one, Roll the click target", async ({
  browser,
}) => {
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, e2eEnv().secret);
  await live(dm);
  const tray = await openWindow(dm, "dicex.tray");
  await stage(tray);

  await expect(tray.getByTestId("dicex-tray")).toHaveAttribute("data-scale", "1.25");
  const big = await facts(tray);
  expect(big.win).toEqual({ w: 450, h: 375 });
  expect(big).toMatchObject({ px: 50, die: 50, expression: 35 });
  expect(big).toMatchObject({ rollInside: true, expressionInside: true, bodyScrolls: false });
  expect(big.hit).toBe("dicex-tray-roll");

  // Resize to the useful size: × 1.2, 48-px dice, the notation row back to 28 px.
  const handle = await tray.getByTestId("ui-window-resize").boundingBox();
  if (!handle) throw new Error("no resize handle");
  await drag(dm, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, -90, -75);
  await expect(tray.getByTestId("dicex-tray")).toHaveAttribute("data-scale", "1.2");
  const useful = await facts(tray);
  expect(useful.win).toEqual({ w: 360, h: 300 });
  expect(useful).toMatchObject({ px: 48, die: 48, expression: 28 });
  expect(useful).toMatchObject({ rollInside: true, expressionInside: true, bodyScrolls: false });
  expect(useful.hit).toBe("dicex-tray-roll");

  // A typical stage at the useful size: 5 dice + adv (the d20 pair) + a constant.
  await tray.getByTestId("dicex-tray-expression").fill("1d20+1d8+2d6+1d4+3");
  await tray.locator('[data-testid="dicex-tray-mode-option"][data-value="advantage"]').click();
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(6);
  const typical = await facts(tray);
  expect(typical.smallest).toBeGreaterThanOrEqual(48);
  expect(typical).toMatchObject({ grouped: false, areaScrolls: false, bodyScrolls: false });
  expect(typical).toMatchObject({ rollInside: true, expressionInside: true });
  expect(typical.hit).toBe("dicex-tray-roll");

  // The remembered (resized) tray keeps its size over a reload (FR-SHELL-144).
  await dm.reload();
  await live(dm);
  const again = await openWindow(dm, "dicex.tray");
  await expect
    .poll(async () => {
      const b = await again.boundingBox();
      return b && { w: Math.round(b.width), h: Math.round(b.height) };
    })
    .toEqual({ w: 360, h: 300 });
});

test("FR-DICEX-96 tray default size and dice scale: Player 1 at 1280×720 opens at its default, dice ≥ 48 px, Roll visible", async ({
  browser,
}) => {
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 720 });
  await p1.goto(e2eEnv().link("Player 1"));
  await live(p1);
  const tray = await openWindow(p1, "dicex.tray");
  await stage(tray);
  const f = await facts(tray);
  // The whole default where the work area holds it (band-capped only when it doesn't).
  expect(f.win.w).toBe(450);
  expect(f.win.h).toBeGreaterThanOrEqual(360);
  expect(f.scale).toBeGreaterThanOrEqual(1.2);
  expect(f.px).toBe(Math.round(40 * f.scale));
  expect(f.die).toBe(f.px);
  expect(f.smallest).toBeGreaterThanOrEqual(48);
  expect(f).toMatchObject({ rollInside: true, expressionInside: true, bodyScrolls: false });
  expect(f.hit).toBe("dicex-tray-roll");
});
