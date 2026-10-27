// e2e-bundle: f1-frame-e2e
// Sprint 11 F1 (session-sim-14 glitch 4, d10 / d11, BL-109): a player at 1280×720 (K5: 1240×720,
// where the band holds 828 px as before the toast corner moved; `f1-frame.test.ts` likewise) out of a fight
// with Recap + Stats open opens Rules → one window put away (Recap, the least recently used),
// Stats moved aside at its size (L3r), Rules + Stats open side by side; closing Rules brings Stats
// back. No scene, so geometry alone (`f1-frame-e2e` = `base`). The ladder in detail: bun test
// (`f1-frame.test.ts`, the harness cells).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

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
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

test("FR-SHELL-97 FR-SHELL-102 BL-109 player 1240×720 (K5; d10: 1280×720) out of a fight: Recap + Stats open → Rules puts away one window (Recap) and moves Stats aside; Rules + Stats open, no overlap; closing Rules brings Stats back", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1240, height: 720 });
  await p1.goto(link("Player 1"));
  await live(p1);
  // Recap from the palette (no launcher entry, FR-RECAP-28), then Stats beside it (d10).
  await p1.getByTestId("ui-palette-open").click();
  await expect(p1.getByTestId("ui-palette")).toBeVisible();
  await p1.keyboard.type("recap");
  await expect(
    p1.locator('[data-testid="ui-palette-item"][data-record-id="recap.open"]'),
  ).toBeVisible();
  await p1.keyboard.press("Enter");
  const recap = shellWindow(p1, "recap.session");
  await expect(recap).toBeVisible();
  const stats = await openWindow(p1, "stats.board");
  await expect(recap).toBeVisible();
  const statsAt = await box(stats);
  expect(overlaps(statsAt, await box(recap))).toBe(false);

  // Before the fix: Recap and Stats both put away, Rules alone (d11).
  const rules = await openWindow(p1, "cmp.rules");
  await expect(stats).toBeVisible();
  await expect(recap).toBeHidden();
  const r = await box(rules);
  const s = await box(stats);
  expect(overlaps(r, s)).toBe(false);
  expect(r.w).toBeGreaterThanOrEqual(420);
  expect({ w: s.w, h: s.h }).toEqual({ w: statsAt.w, h: statsAt.h });
  await expect(stats).toHaveAttribute("data-placed", "displaced");

  await rules.getByTestId("ui-window-close").click();
  await expect.poll(() => box(stats)).toEqual(statsAt);
  await expect(stats).toHaveAttribute("data-placed", "returned");
  await p1.context().close();
});
