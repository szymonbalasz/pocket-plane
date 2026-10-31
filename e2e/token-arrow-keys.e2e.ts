// e2e-bundle: scene-tools
// Arrow keys on the battlemap (FR-MAP-124), DM + player-1 in their own contexts. The DM's keys move
// the selection; a player's move their own token, with no selection. The usual rules hold: a player
// stops at a wall with one toast however long the key is held, the DM doesn't, and nobody leaves
// the map. A key pressed in a window stays that window's. A token walking past the view pans it.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

/** The token's cell (Goblin Ambush: 70 px cells, offset 0). */
function cellOf(page: Page, tokenId: string) {
  return page.evaluate((id) => {
    type KNode = { id(): string; x(): number; y(): number };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const n = K?.stages[0]?.find(".map-token").find((t) => t.id() === id);
    return n ? { col: Math.round(n.x() / 70), row: Math.round(n.y() / 70) } : null;
  }, tokenId);
}

/** Presses a key and waits until the token shows at the cell, so presses never run together. */
async function step(page: Page, key: string, tokenId: string, col: number, row: number) {
  await page.keyboard.press(key);
  await expect.poll(() => cellOf(page, tokenId)).toEqual({ col, row });
}

async function clickToken(page: Page, tokenId: string, modifier?: "Shift") {
  const t = await tokenNode(page, tokenId);
  if (!t) throw new Error(`token ${tokenId} not drawn`);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(t.x, t.y);
  if (modifier) await page.keyboard.up(modifier);
}

test("FR-MAP-124 arrow keys move a selection and a player's own token; walls, map edge and windows hold", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const goblin = recordId("battlemap", "token", 1);

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const scenes = await openWindow(dm, "map.scenes");
  const row = scenes.locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`);
  await row.first().click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await showToPlayers(dm, "Goblin Ambush");
  // The wide Game log (FR-DICE-38) covers the lower map at 1280×800: park it (no refit).
  await shellWindow(dm, "dice.log").getByTestId("ui-window-minimise").click();
  await expect.poll(() => tokenNode(dm, mira)).not.toBeNull();

  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect.poll(() => tokenNode(player, mira)).not.toBeNull();
  expect(await cellOf(player, mira)).toEqual({ col: 2, row: 7 });

  // Nothing selected: the DM's keys move nothing.
  await dm.keyboard.press("ArrowRight");
  await dm.waitForTimeout(100);
  expect(await cellOf(dm, mira)).toEqual({ col: 2, row: 7 });

  // A player needs no selection, and everyone sees the step.
  await step(player, "ArrowRight", mira, 3, 7);
  await step(player, "ArrowUp", mira, 3, 6);
  await step(player, "ArrowDown", mira, 3, 7);
  await step(player, "ArrowLeft", mira, 2, 7);
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 2, row: 7 });

  // The wall at x = 8: Mira stops at column 7, and a key held against it toasts once.
  for (const col of [3, 4, 5, 6, 7]) await step(player, "ArrowRight", mira, col, 7);
  const blocked = player.getByText("Blocked by a wall or door");
  await player.keyboard.down("ArrowRight");
  await expect(blocked).toHaveCount(1);
  for (let i = 0; i < 5; i++) {
    await player.waitForTimeout(130);
    await player.keyboard.down("ArrowRight");
  }
  await player.keyboard.up("ArrowRight");
  await expect(blocked).toHaveCount(1);
  expect(await cellOf(player, mira)).toEqual({ col: 7, row: 7 });
  expect(await cellOf(dm, mira)).toEqual({ col: 7, row: 7 });

  // After a window's button had the focus, clicking the token gives the keys to the map.
  await row.first().focus();
  await clickToken(dm, mira);
  // The DM is never checked at a wall, as on a drag (ADR-0040).
  await step(dm, "ArrowRight", mira, 8, 7);
  await expect.poll(() => cellOf(player, mira)).toEqual({ col: 8, row: 7 });
  // A modifier keeps the key the browser's.
  await dm.keyboard.press("Shift+ArrowRight");
  await dm.waitForTimeout(100);
  expect(await cellOf(dm, mira)).toEqual({ col: 8, row: 7 });

  // Focus in a window: the key is the window's.
  await row.first().focus();
  await dm.keyboard.press("ArrowRight");
  await dm.waitForTimeout(100);
  expect(await cellOf(dm, mira)).toEqual({ col: 8, row: 7 });
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();

  // A group moves together, and stops together at the map's top edge, keeping its shape.
  await dm.keyboard.press("Escape");
  await clickToken(dm, goblin);
  const goblinFrom = (await cellOf(dm, goblin)) as { col: number; row: number };
  await clickToken(dm, mira, "Shift");
  await step(dm, "ArrowUp", mira, 8, 6);
  await expect
    .poll(() => cellOf(dm, goblin))
    .toEqual({ col: goblinFrom.col, row: goblinFrom.row - 1 });
  const gap = goblinFrom.row - 1 - 6;
  const top = Math.min(6, goblinFrom.row - 1);
  for (let n = 1; n <= top; n++) await step(dm, "ArrowUp", mira, 8, 6 - n);
  await dm.keyboard.press("ArrowUp");
  await dm.waitForTimeout(150);
  expect(await cellOf(dm, mira)).toEqual({ col: 8, row: 6 - top });
  expect(await cellOf(dm, goblin)).toEqual({ col: goblinFrom.col, row: 6 - top + gap });
  await expect(dm.getByText("Token must overlap the map")).toHaveCount(0);

  // Zoomed in, a token walking past the view brings the camera along.
  await dm.keyboard.press("Escape");
  await clickToken(dm, mira);
  const at = await tokenNode(dm, mira);
  if (!at) throw new Error("Mira not drawn");
  await dm.mouse.move(at.x, at.y);
  for (let i = 0; i < 14; i++) await dm.mouse.wheel(0, -100);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-camera", "moved");
  const width = dm.viewportSize()?.width ?? 1280;
  const stageX = () =>
    dm.evaluate(() => {
      type KStage = { x(): number };
      return (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0]?.x() ?? 0;
    });
  const camFrom = await stageX();
  for (let n = 1; n <= 7; n++) {
    await step(dm, "ArrowRight", mira, 8 + n, 6 - top);
    await expect.poll(async () => (await tokenNode(dm, mira))?.x ?? width).toBeLessThan(width);
  }
  // The walk was longer than the room to the screen's edge: the camera did move.
  expect(await stageX()).toBeLessThan(camFrom);

  await player.context().close();
  await dm.context().close();
});
