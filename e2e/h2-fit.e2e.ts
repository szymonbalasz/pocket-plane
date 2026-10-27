// e2e-bundle: h2-fit-e2e
// Sprint 10 H2 (session-sim-13 glitch 4, BL-100, FR-MAP-115): a Compendium the DM dragged over the
// map centre and resized stays where it is after a reload, and the load fit and Fit frame the map
// around the other windows (`data-fit-visible="all"`, the cell Fit gave without it), never the
// 48-px PCs-only view in a corner. The rule in detail: bun test (`h2-frame.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { tokenFootprints } from "./support/canvas";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { showToPlayers } from "./support/scenes";
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

/** Drags a window by its title bar so its top-left lands at (x, y). */
async function dragTo(page: Page, win: Locator, x: number, y: number) {
  const t = await box(win.getByTestId("ui-window-title"));
  const w = await box(win);
  const grab = { x: t.x + 60, y: t.y + t.h / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (x - w.x), grab.y + (y - w.y), { steps: 6 });
  await page.mouse.up();
}

/** Resizes a window by its corner handle to `w` × `h`. */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const handle = await box(win.getByTestId("ui-window-resize"));
  const now = await box(win);
  const at = { x: handle.x + handle.w / 2, y: handle.y + handle.h / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + (w - now.w), at.y + (h - now.h), { steps: 6 });
  await page.mouse.up();
}

test("FR-MAP-115 BL-100 DM 1440×900: a remembered Compendium over the map centre → after a reload and a Fit the map is framed around Initiative + the Game log (`all`, Fit's cell), the Compendium at its stored rect", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const ambush = recordId("battlemap", "scene");
  const scenes = await showToPlayers(dm, "Goblin Ambush");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  const canvas = dm.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", ambush);
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  await dm.getByTestId("map-tool-fit").click();
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  const cell = await canvas.getAttribute("data-cell-px");

  // The Compendium dragged onto the tokens' centre and resized to 480 × 440 (sim-13 b02).
  const cmp = await openWindow(dm, "cmp.compendium");
  const tokens = await tokenFootprints(dm);
  const cx = (Math.min(...tokens.map((t) => t.x)) + Math.max(...tokens.map((t) => t.x + t.w))) / 2;
  const cy = (Math.min(...tokens.map((t) => t.y)) + Math.max(...tokens.map((t) => t.y + t.h))) / 2;
  await dragTo(dm, cmp, Math.round(cx - 240), Math.max(70, Math.round(cy - 220)));
  await resizeTo(dm, cmp, 480, 440);
  await expect(cmp).toHaveAttribute("data-remembered", "true");
  const mine = await box(cmp);

  await dm.reload();
  await live(dm);
  await expect(cmp).toBeVisible();
  await expect.poll(() => box(cmp)).toEqual(mine);
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  await expect(canvas).toHaveAttribute("data-cell-px", cell ?? "");
  await dm.getByTestId("map-tool-fit").click();
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  await expect(canvas).toHaveAttribute("data-cell-px", cell ?? "");
  expect(await box(cmp)).toEqual(mine);
  await dm.context().close();
});

test("FR-SHELL-102 FR-MAP-113 H2 FAIL 5 DM resize round trip: 1280×720, Reset layout, Party Manager opened → 1440×900 keeps an all-tokens fit (not the 48-px floor) → 1280×720: Party Manager and the map as before", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  // The scene picked at 1440 (at 1280 the pending-action toast sits over the Scenes rows).
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const ambush = recordId("battlemap", "scene");
  const scenes = await showToPlayers(dm, "Goblin Ambush");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  const canvas = dm.getByTestId("map-canvas");
  await expect(canvas).toHaveAttribute("data-scene-id", ambush);
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  const log = shellWindow(dm, "dice.log");
  await dm.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => box(log)).toEqual({ x: 68, y: 508, w: 690, h: 200 });
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  await expect(shellWindow(dm, "map.scenes")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  const board = await openWindow(dm, "party.board");
  const before = await box(board);
  const cell = await canvas.getAttribute("data-cell-px");

  await dm.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => box(log)).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  await expect(canvas).toHaveAttribute("data-fit-floor", "false");

  await dm.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => box(log)).toEqual({ x: 68, y: 508, w: 690, h: 200 });
  await expect.poll(() => box(board)).toEqual(before);
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  await expect(canvas).toHaveAttribute("data-cell-px", cell ?? "");
  await dm.context().close();
});
