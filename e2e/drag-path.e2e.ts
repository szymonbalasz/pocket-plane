// e2e-bundle: map-tools
// Thin drag-path flow (MAP §13 E2E, sprint 4), DM + player-1 + player-2 in separate contexts: the
// DM shows Goblin Ambush from the Scenes window; player-1 holds a drag on Mira (2, 7) → (5, 8) →
// player-1's own path and player-2's `map-drag-path` for Mira read "2,7 3,7 4,8 5,8" (FR-MAP-52,
// -53); the drop clears it everywhere (out of combat, FR-MAP-54). The DM holds a drag on Goblin
// Sneak → player-1 draws a `map-token` preview for it and no `map-drag-path` (OQ-MAP-37).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { gridPoint, mapPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

interface PathNode {
  id: string;
  cells: string;
  blocked: number;
  preview: string;
}

/** `map-drag-path` Konva groups on the map canvas (MAP §7 test IDs, sprint 4). */
async function paths(page: Page): Promise<PathNode[]> {
  return page.evaluate(() => {
    type KNode = { id(): string; getAttr(a: string): unknown };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(".map-drag-path") ?? []).map((n) => ({
      id: n.id(),
      cells: String(n.getAttr("cells") ?? ""),
      blocked: Number(n.getAttr("blocked")),
      preview: String(n.getAttr("preview") ?? ""),
    }));
  });
}

/** Whether the token is drawn from another client's drag preview (FR-MAP-40). */
async function previewed(page: Page, tokenId: string): Promise<boolean> {
  return page.evaluate((id) => {
    type KNode = { id(): string; getAttr(a: string): unknown };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const n = K?.stages[0]?.find(".map-token").find((t) => t.id() === id);
    return n?.getAttr("preview") === true;
  }, tokenId);
}

/** Presses on the token at cell `from` and moves (in steps) to the centre of cell `to`; no release. */
async function holdDrag(
  page: Page,
  from: { col: number; row: number },
  to: { col: number; row: number },
) {
  const a = await gridPoint(page, from.col + 0.5, from.row + 0.5);
  const b = await gridPoint(page, to.col + 0.5, to.row + 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
}

test("FR-MAP-52 / -53 / -54 player-1 holds a drag on Mira: same path cells for player-1 and player-2, cleared on drop; the DM's Goblin Sneak drag glides on player-1 with no path", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const sneak = recordId("mt-crowd", "token", 0);

  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
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
  await scenes.getByTestId("ui-window-close").click();

  const [p1, p2] = [await rolePage(browser), await rolePage(browser)];
  for (const [page, name] of [
    [p1, "Player 1"],
    [p2, "Player 2"],
  ] as const) {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
    });
    await page.goto(link(name));
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
    await expect.poll(() => tokenNode(page, mira)).not.toBeNull();
  }

  // player-1 holds a drag on Mira (2, 7) → (5, 8); the cells around stay clear of windows.
  await mapPoint(p1, 3, 7, { margin: 2 });
  await holdDrag(p1, { col: 2, row: 7 }, { col: 5, row: 8 });
  const want = "2,7 3,7 4,8 5,8";
  await expect
    .poll(async () => (await paths(p1)).map((p) => [p.id, p.cells, p.preview]))
    .toEqual([[mira, want, "local"]]);
  await expect
    .poll(async () => (await paths(p2)).map((p) => [p.id, p.cells, p.preview]))
    .toEqual([[mira, want, "remote"]]);
  await expect
    .poll(async () => (await paths(dm)).map((p) => [p.id, p.cells]))
    .toEqual([[mira, want]]);
  // The drop: out of combat the path clears everywhere; Mira lands on (5, 8).
  await p1.mouse.up();
  for (const p of [p1, p2, dm]) await expect.poll(() => paths(p)).toEqual([]);

  // The DM holds a drag on Goblin Sneak (4, 9): player-1 sees it glide, with no path.
  await mapPoint(dm, 5, 10, { margin: 2 });
  await holdDrag(dm, { col: 4, row: 9 }, { col: 6, row: 11 });
  await expect
    .poll(async () => (await paths(dm)).map((p) => [p.id, p.cells]))
    .toEqual([[sneak, "4,9 5,10 6,11"]]);
  await expect.poll(() => previewed(p1, sneak)).toBe(true);
  expect(await paths(p1)).toEqual([]);
  // Escape cancels: the token snaps back, the preview and the path go.
  await dm.keyboard.press("Escape");
  await dm.mouse.up();
  await expect.poll(() => paths(dm)).toEqual([]);
  await expect.poll(() => previewed(p1, sneak)).toBe(false);

  expect(errors).toEqual([]);
});
