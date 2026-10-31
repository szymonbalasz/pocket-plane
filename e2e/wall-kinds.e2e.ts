// e2e-bundle: wall-kinds
// Windows and one-way walls (FR-SCN-57–59), DM + player-1 in separate contexts on Goblin Ambush.
// The wall at x = 8 stands between Mira (moved to (7, 7)) and the Goblin (12, 6). The DM draws a
// Window into it: player-1 sees the Goblin but can't walk through; the DM can. Undo closes it.
// Then a One-way wall, drawn downwards so its arrows point east: player-1 sees the Goblin from the
// west; Flip turns it round and the Goblin goes; Undo brings it back; players never get walls.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

/** Map px → page px on the first stage. */
async function mapToPage(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      type KStage = { container(): HTMLElement; x(): number; y(): number; scaleX(): number };
      const st = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0] as KStage;
      const box = st.container().getBoundingClientRect();
      return { x: box.left + st.x() + x * st.scaleX(), y: box.top + st.y() + y * st.scaleX() };
    },
    [x, y] as const,
  );
}

/** A Konva node's `count` attr, or null. */
async function count(page: Page, name: string) {
  return page.evaluate((name) => {
    type KStage = { findOne(s: string): { getAttr(a: string): unknown } | undefined };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.findOne(`.${name}`)?.getAttr("count") as number | undefined) ?? null;
  }, name);
}

/** The token's cell (Goblin Ambush: 70 px cells, offset 0). */
async function cellOf(page: Page, tokenId: string) {
  return page.evaluate((id) => {
    const K = (
      window as unknown as {
        Konva?: { stages: { find(s: string): { id(): string; x(): number; y(): number }[] }[] };
      }
    ).Konva;
    const n = K?.stages[0]?.find(".map-token").find((t) => t.id() === id);
    return n ? { col: Math.round(n.x() / 70), row: Math.round(n.y() / 70) } : null;
  }, tokenId);
}

/** Drags a token from its cell to `(col, row)` in small steps. */
async function dragTo(page: Page, tokenId: string, col: number, row: number) {
  const t = (await tokenNode(page, tokenId)) as { x: number; y: number };
  const to = await mapToPage(page, col * 70 + 35, row * 70 + 35);
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(t.x + ((to.x - t.x) * i) / 8, t.y + ((to.y - t.y) * i) / 8);
  }
  await page.mouse.up();
}

/** A polyline with the Structure tool, in vertices; the last point double-clicked. */
async function draw(dm: Page, points: [number, number][]) {
  for (const [i, [x, y]] of points.entries()) {
    const p = await mapToPage(dm, x * 70, y * 70);
    if (i === points.length - 1) await dm.mouse.dblclick(p.x, p.y);
    else await dm.mouse.click(p.x, p.y);
  }
}

test("FR-SCN-57 / -58 / -59 windows see through, one-way walls one way, nobody walks through but the DM (DM + player-1)", async ({
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
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await showToPlayers(dm, "Goblin Ambush");
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  // The wide Game log (FR-DICE-38) covers the lower map at 1280×800: park it (no refit).
  await shellWindow(dm, "dice.log").getByTestId("ui-window-minimise").click();

  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);

  // Mira up against the wall: within 30 ft of the Goblin, but it's behind the wall.
  await expect.poll(() => tokenNode(dm, mira)).not.toBeNull();
  await dragTo(dm, mira, 7, 7);
  await expect.poll(() => cellOf(player, mira)).toEqual({ col: 7, row: 7 });
  expect(await tokenNode(player, goblin)).toBeNull();
  const walls = (await count(dm, "scn-walls")) as number;

  await dm.getByTestId("map-tool-structure").click();
  await expect(dm.getByTestId("scn-structure-panel")).toBeVisible();

  // FR-SCN-57 / -58: a Window into the wall takes its place: the Goblin shows through it.
  await dm.getByTestId("scn-structure-mode-window").click();
  await draw(dm, [
    [8, 7],
    [8, 8],
  ]);
  await expect.poll(() => count(dm, "scn-windows")).toBe(1);
  await expect.poll(() => count(dm, "scn-walls")).toBe(walls + 1);
  await expect.poll(() => tokenNode(player, goblin)).not.toBeNull();

  // FR-SCN-10: but the player can't walk through it, and the DM can, both ways.
  await dragTo(player, mira, 9, 7);
  await expect(player.getByText("Blocked by a wall or door")).toBeVisible();
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 7, row: 7 });
  await dm.getByTestId("map-tool-select").click();
  await dragTo(dm, mira, 9, 7);
  await expect.poll(() => cellOf(player, mira)).toEqual({ col: 9, row: 7 });
  await dragTo(dm, mira, 7, 7);
  await expect.poll(() => cellOf(player, mira)).toEqual({ col: 7, row: 7 });
  await dm.getByTestId("map-tool-structure").click();

  // FR-SCN-58: Undo gives the wall back whole; the Goblin goes.
  await dm.getByTestId("scn-undo").click();
  await expect.poll(() => count(dm, "scn-windows")).toBe(0);
  await expect.poll(() => count(dm, "scn-walls")).toBe(walls);
  await expect.poll(() => tokenNode(player, goblin)).toBeNull();

  // FR-SCN-57: a One-way wall drawn downwards: its arrows point east, so west sees through.
  await dm.getByTestId("scn-structure-mode-one-way").click();
  await draw(dm, [
    [8, 7],
    [8, 8],
  ]);
  await expect.poll(() => count(dm, "scn-one-way")).toBe(1);
  await expect.poll(() => tokenNode(player, goblin)).not.toBeNull();

  // FR-SCN-59: Flip turns it round: the Goblin goes; Undo brings it back.
  await dm.getByTestId("scn-structure-mode-flip").click();
  const p = await mapToPage(dm, 8 * 70, 7.5 * 70);
  await dm.mouse.move(p.x, p.y);
  await expect.poll(async () => (await konvaNodes(dm, "scn-edit-flip")).length).toBe(1);
  await dm.mouse.click(p.x, p.y);
  await expect.poll(() => tokenNode(player, goblin)).toBeNull();
  await dm.keyboard.press("Control+z");
  await expect.poll(() => tokenNode(player, goblin)).not.toBeNull();

  // Players never get walls of any kind.
  expect(frames.join("\n")).not.toContain('"walls"');
  expect(await konvaNodes(player, "scn-windows")).toHaveLength(0);
  expect(await konvaNodes(player, "scn-one-way")).toHaveLength(0);

  await player.context().close();
  await dm.context().close();
});
