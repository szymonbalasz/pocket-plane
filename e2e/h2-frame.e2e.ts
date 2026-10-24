// e2e-bundle: h2-frame-e2e
// Sprint 10 H2 (session-sim-13 glitch 3, BL-99, BL-104, BL-106): the Party Manager opens at its size
// row (600 wide, band-high) on the DM at 1440×900; a second launcher window that fits beside it at
// both useful sizes keeps it open, shrunk to its useful width (L3s), and it grows back when that
// window closes; the same for a player at 1280×720 out of a fight (Rules + Stats). No scene, so
// geometry alone (`h2-frame-e2e` = `base`). The ladder in detail: bun test (`h2-frame.test.ts`,
// the harness cells).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
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

test("FR-SHELL-156 FR-SHELL-97 FR-SHELL-102 BL-104 BL-106 BL-99 DM 1440×900: Party Manager opens 600 × 512; Compendium beside it shrinks it to 440 (both open, no overlap); closing Compendium grows it back", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  // Initiative in its zone (top-right, 1028): 948 px left of it hold 440 + 440, not 600 + 440.
  await openWindow(dm, "cbt.initiative");
  await expect.poll(() => box(shellWindow(dm, "cbt.initiative"))).toMatchObject({ x: 1028, y: 60 });
  const board = await openWindow(dm, "party.board");
  await expect.poll(() => box(board)).toEqual({ x: 68, y: 60, w: 600, h: 512 });
  const cmp = await openWindow(dm, "cmp.compendium");
  await expect(board).toBeVisible();
  await expect.poll(() => box(board)).toEqual({ x: 68, y: 60, w: 440, h: 512 });
  await expect(board).toHaveAttribute("data-placed", "squeezed");
  const c = await box(cmp);
  expect(c.w).toBeGreaterThanOrEqual(440);
  expect(overlaps(c, await box(board))).toBe(false);
  await cmp.getByTestId("ui-window-close").click();
  await expect.poll(() => box(board)).toEqual({ x: 68, y: 60, w: 600, h: 512 });
  await expect(board).toHaveAttribute("data-placed", "returned");
  await dm.context().close();
});

test("FR-SHELL-97 FR-SHELL-102 BL-99 player 1280×720 out of a fight: Rules then Stats → both open (Rules at its useful 420 wide), no overlap; closing Stats grows Rules back to 440", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 720 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const rules = await openWindow(p1, "cmp.rules");
  await expect.poll(async () => (await box(rules)).w).toBe(440);
  const stats = await openWindow(p1, "stats.board");
  await expect(rules).toBeVisible();
  await expect.poll(async () => (await box(rules)).w).toBe(420);
  expect(overlaps(await box(stats), await box(rules))).toBe(false);
  expect((await box(stats)).w).toBeGreaterThanOrEqual(400);
  await shellWindow(p1, "stats.board").getByTestId("ui-window-close").click();
  await expect.poll(async () => (await box(rules)).w).toBe(440);
  await p1.context().close();
});
