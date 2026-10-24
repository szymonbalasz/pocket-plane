// e2e-bundle: f1-fit-e2e
// Sprint 11 F1 (session-sim-14 glitch 1, d04, BL-107): DM 1440×900 on Goblin Ambush after Reset
// layout, the untouched Party Manager opened → Fit and a reload keep an all-tokens view
// (`data-fit-visible="all"`, no floor), never the 48-px PCs-only view; and the DM launcher in test
// mode keeps the labels that fit (BL-113). The rules in detail: bun test (`f1-frame.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
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

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

test("FR-MAP-115 FR-SHELL-97 BL-107 DM 1440×900 Goblin Ambush, Reset layout, Party Manager opened: Fit and a reload frame every token (`all`, no floor), the Party Manager ≥ its useful size over no other window", async ({
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
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  await expect(shellWindow(dm, "map.scenes")).toHaveCount(0);
  const init = await openWindow(dm, "cbt.initiative");
  await dm.getByTestId("map-tool-fit").click();
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");

  const board = await openWindow(dm, "party.board");
  const b = await box(board);
  expect(b.w).toBeGreaterThanOrEqual(440);
  expect(overlaps(b, await box(init))).toBe(false);
  expect(overlaps(b, await box(shellWindow(dm, "dice.log")))).toBe(false);
  // Before the fix: Party Manager 600 × 512 at 424,60 and Fit → `pcs` at the 48-px floor (d04).
  await dm.getByTestId("map-tool-fit").click();
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  await expect(canvas).toHaveAttribute("data-fit-floor", "false");
  expect(await box(board)).toEqual(b);

  await dm.reload();
  await live(dm);
  await expect(board).toBeVisible();
  await expect(canvas).toHaveAttribute("data-fit-visible", "all");
  await expect(canvas).toHaveAttribute("data-fit-floor", "false");
  await dm.context().close();
});

test("FR-SHELL-43 BL-113 DM 1440×900 in test mode: the launcher keeps the labels that fit (left first), not icon-only throughout; the bar inside the viewport, nothing in the menu", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const buttons = dm.getByTestId("ui-launcher-button");
  await expect(buttons.first()).toBeVisible();
  await expect(buttons.first()).toHaveAttribute("data-compact", "false");
  await expect(dm.getByTestId("ui-launcher-overflow")).toHaveAttribute("data-count", "0");
  const bar = await box(dm.getByTestId("ui-launcher"));
  expect(bar.x).toBeGreaterThanOrEqual(8);
  expect(bar.x + bar.w).toBeLessThanOrEqual(1440 - 8);
  // Labels from the left: once a button is icon-only, every later one is too.
  const compact = await buttons.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-compact") === "true"),
  );
  expect(compact.indexOf(true)).toBeGreaterThan(0);
  expect(compact.slice(compact.indexOf(true)).every(Boolean)).toBe(true);
  await dm.context().close();
});
