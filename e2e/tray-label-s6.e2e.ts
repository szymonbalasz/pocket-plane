// e2e-bundle: session-sim-9
// Thin sprint-6 fixes for the dice tray and kept templates (track WF; play-shell §13 F11, F12).
// WF5: the tray keeps Roll visible at its min size with dice staged, 12 d6 included
// (FR-DICEX-53, -54); the real part heights match the pure layout's budget. Sends no intent.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** sim-9 presents a handout to Player 1 (P0 h2): close its popup first. */
async function closePresented(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** FR-DICEX-53's testable outcome, read from the real layout. */
const trayFacts = (win: Locator) =>
  win.evaluate((w) => {
    const roll = w.querySelector<HTMLElement>(
      '[data-testid="dicex-tray-roll"], [data-testid="dicex-tray-again"]',
    );
    const tray = w.querySelector<HTMLElement>('[data-testid="dicex-tray"]');
    const area = w.querySelector<HTMLElement>('[data-testid="dicex-tray-area"]');
    if (!roll || !tray || !area) throw new Error("tray parts missing");
    const wr = w.getBoundingClientRect();
    const r = roll.getBoundingClientRect();
    const body = tray.parentElement as HTMLElement;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const part = (name: string) =>
      w.querySelector(`[data-tray-part="${name}"]`)?.getBoundingClientRect().height ?? null;
    return {
      win: { w: Math.round(wr.width), h: Math.round(wr.height) },
      inside: r.left >= wr.left && r.right <= wr.right && r.top >= wr.top && r.bottom <= wr.bottom,
      hit: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      dice: area.clientHeight - 12,
      parts: {
        header: part("header"),
        palette: part("palette"),
        expression: part("expression"),
        bar: part("bar"),
      },
    };
  });

test("FR-DICEX-53 tray Roll visible at min: 2d6 + 1d8 + 1 and 12 d6 as opened and at 300×240, Roll inside and hit, body not scrolling; FR-DICEX-54 12 d6 group at min", async ({
  browser,
}) => {
  const p1 = await rolePage(browser);
  await p1.goto(e2eEnv().link("Player 1"));
  await live(p1);
  await closePresented(p1);
  const tray = await openWindow(p1, "dicex.tray");
  for (const f of [6, 6, 8]) {
    await tray.locator(`[data-testid="dicex-tray-palette"][data-value="${f}"]`).click();
  }
  await tray.getByTestId("dicex-tray-constant").fill("1");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(3);
  const preview = tray.getByTestId("dicex-tray-preview");

  const check = async (size?: { w: number; h: number }) => {
    const f = await trayFacts(tray);
    if (size) expect(f.win).toEqual(size);
    // Placement may open it narrower than 360 × 300 (PC footprints, FR-SHELL-58): never below min.
    expect(f.win.w).toBeGreaterThanOrEqual(300);
    expect(f.win.h).toBeGreaterThanOrEqual(240);
    expect(f.inside).toBe(true);
    expect(f.hit).toBe("dicex-tray-roll");
    expect(f.bodyScrolls).toBe(false);
    // The pure layout's budget (TRAY_PART_PX) is what the browser draws.
    expect(f.parts).toEqual({ header: 24, palette: 28, expression: 28, bar: 33 });
    expect(f.dice).toBeGreaterThanOrEqual(40);
    return f;
  };

  // As opened (360 × 300, or placement's shrunk size).
  await check();
  await expect(preview).toHaveAttribute("data-cell", "40");

  // Resize to the min (the frame clamps at 300 × 240).
  const handle = await tray.getByTestId("ui-window-resize").boundingBox();
  if (!handle) throw new Error("no resize handle");
  await drag(p1, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, -200, -200);
  const min = await check({ w: 300, h: 240 });
  expect(min.dice).toBe(41);
  await expect(preview).toHaveAttribute("data-cell", "40");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(3);

  // 12 d6 at min: no row of 28 holds them → one die "×12", still no scroll, Roll in place.
  await tray.getByTestId("dicex-tray-expression").fill("12d6");
  await expect(preview).toHaveAttribute("data-grouped", "true");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(1);
  await expect(tray.getByTestId("dicex-tray-die")).toHaveAttribute("data-group", "12");
  await check({ w: 300, h: 240 });
  await expect(preview).not.toHaveAttribute("data-scroll", "true");
});
