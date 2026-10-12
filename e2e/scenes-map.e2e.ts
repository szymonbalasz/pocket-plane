// e2e-bundle: scenes
// Thin scenes-map flows (MAP §13 E2E), DM + player-1 in separate contexts: player drags Mira,
// DM sees it; DM reveals Wolf; DM activates the battlemap; reload.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, stageScale, tokenNode } from "./support/konva";
import { shellWindow } from "./support/shell";

/** A token's map-space cell (Town / Goblin Ambush: 70 px cells, offset 0). */
async function cellOf(page: Page, tokenId: string) {
  return page.evaluate((id) => {
    const K = (
      window as unknown as {
        Konva: { stages: { findOne(s: string): { x(): number; y(): number } | undefined }[] };
      }
    ).Konva;
    const n = K.stages[0]?.findOne(`#${id}`);
    return n ? { col: Math.round(n.x() / 70), row: Math.round(n.y() / 70) } : null;
  }, tokenId);
}

test("FR-MAP-15 / -19 / -06 drag, reveal, activate, reload (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const town = recordId("town", "scene");
  const ambush = recordId("battlemap", "scene");
  const miraTown = recordId("town", "token");
  const wolf = recordId("battlemap", "token", 2);
  const elite = recordId("battlemap", "token", 3);

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", town);
  const scenes = shellWindow(dm, "map.scenes");
  await expect(scenes.getByTestId("map-scene-row")).toHaveCount(3);
  await expect(scenes.getByTestId("map-folder-row")).toHaveCount(1);
  await expect(
    scenes
      .locator(`[data-testid="map-scene-row"][data-record-id="${town}"]`)
      .getByTestId("map-scene-live"),
  ).toBeVisible();
  // The Players window (top-right) would cover part of the map.
  await shellWindow(dm, "camp.players").getByTestId("ui-window-close").click();

  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", town);
  await expect(player.getByTestId("map-scenes")).toHaveCount(0);

  // Player drags Mira 3 cells right; sees 15 ft while dragging; DM sees (8, 5).
  await expect.poll(() => tokenNode(player, miraTown)).not.toBeNull();
  const m = (await tokenNode(player, miraTown))!;
  const cell = 70 * (await stageScale(player));
  await player.mouse.move(m.x, m.y);
  await player.mouse.down();
  for (let i = 1; i <= 6; i++) await player.mouse.move(m.x + (cell * 3 * i) / 6, m.y);
  await expect
    .poll(async () => (await konvaNodes(player, "map-drag-label-text"))[0]?.text)
    .toBe("15 ft");
  await player.mouse.up();
  await expect.poll(() => cellOf(dm, miraTown)).toEqual({ col: 8, row: 5 });
  await expect.poll(() => cellOf(player, miraTown)).toEqual({ col: 8, row: 5 });

  // DM views Goblin Ambush: not shown to players; Wolf + Elite there, styled hidden.
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-not-shown-badge")).toBeVisible();
  await expect(dm.getByTestId("map-tool-ping")).toBeDisabled();
  await expect.poll(async () => (await tokenNode(dm, wolf))?.opacity).toBeLessThan(1);
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", town);

  // Reveal Wolf via the token menu.
  const w = (await tokenNode(dm, wolf))!;
  await dm.mouse.click(w.x, w.y, { button: "right" });
  await expect(dm.getByTestId("map-token-menu")).toBeVisible();
  await expect(dm.getByTestId("map-token-menu-hide")).toHaveText(/Reveal/);
  await dm.getByTestId("map-token-menu-hide").click();
  await expect.poll(async () => (await tokenNode(dm, wolf))?.opacity).toBe(1);

  // Show to players: the player switches; Wolf visible, Elite and the scene name never sent.
  await dm.getByTestId("map-show-to-players").click();
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await expect(dm.getByTestId("map-tool-ping")).toBeEnabled();
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect.poll(() => tokenNode(player, wolf)).not.toBeNull();
  expect(await tokenNode(player, elite)).toBeNull();
  const raw = frames.join("\n");
  for (const s of ["Elite Goblin Warrior", "Goblin Ambush", "Cellar", "Act 1", elite]) {
    expect({ s, leaked: raw.includes(s) }).toEqual({ s, leaked: false });
  }

  // Reload both: state survives.
  await player.reload();
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect.poll(() => tokenNode(player, wolf)).not.toBeNull();
  await dm.reload();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(
    shellWindow(dm, "map.scenes")
      .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"]`)
      .getByTestId("map-scene-live"),
  ).toBeVisible();
  await player.reload();
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await dm.goto("/");
  await expect
    .poll(() => cellOf(dm, recordId("battlemap", "token", 0)))
    .toEqual({ col: 2, row: 7 });

  await player.context().close();
  await dm.context().close();
});
