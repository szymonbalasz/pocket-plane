// e2e-bundle: vision
// Thin dynamic-vision flow (FOG §13 E2E; V2 server, V3 client). DM, player-1 (Mira, torch 30 ft)
// and player-2 (Thorn) in separate contexts: the DM shows Goblin Ambush and opens d1; player-1
// drags Mira to (7, 5) → the Goblin reaches player-1 only and player-1 draws one `see` polygon
// cut at x = 8 (V3); a reload keeps it; a darkness circle over the Goblin hides it, Undo brings it
// back; View as Player 1 loads player-1's rows (the Goblin not dimmed, Goblin 2 in darkness
// dimmed); the DM sets the Goblin Invisible from its token menu (V3) → faded with the Invisible
// badge for the DM, gone for player-1.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

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

/** The token's cell (Goblin Ambush: 70 px cells, offset 0). */
async function cellOf(page: Page, tokenId: string) {
  return page.evaluate((id) => {
    const K = (
      window as unknown as {
        Konva?: { stages: { findOne(s: string): { x(): number; y(): number } | undefined }[] };
      }
    ).Konva;
    const n = K?.stages[0]?.findOne(`#${id}`);
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

/** Konva attr of the first node named `name` (null when absent). */
async function attrOf(page: Page, name: string, attr: string) {
  return page.evaluate(
    ([name, attr]) => {
      type KNode = { getAttr(a: string): unknown };
      type KStage = { findOne(s: string): KNode | undefined };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      return (K?.stages[0]?.findOne(`.${name}`)?.getAttr(attr) as unknown) ?? null;
    },
    [name, attr] as const,
  );
}

test("FR-FOG-21 / -34 / -37 / -43 / -44 / -45 / -47 vision: d1 open, Mira → (7, 5) → Goblin for player-1 only; reload keeps it; darkness hides it, Undo → back; Invisible → gone (DM + player-1 + player-2)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const goblin = recordId("battlemap", "token", 1);
  const goblin2 = recordId("goblin-2", "token");
  const player1 = recordId("player-1", "player");

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

  const p1 = await rolePage(browser);
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => ws.on("framereceived", (f) => p2Frames.push(String(f.payload))));
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
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
    await expect.poll(() => tokenNode(page, mira)).not.toBeNull();
    expect(await tokenNode(page, goblin)).toBeNull();
  }

  // The DM double-clicks d1 open; player-1 drags Mira through to (7, 5): the Goblin (12, 6) is
  // in her 30 ft through the doorway (FR-FOG-33 / -34).
  const d1 = (await konvaNodes(dm, "scn-door", "door-4"))[0] as { x: number; y: number };
  await dm.mouse.dblclick(d1.x, d1.y);
  await dragTo(p1, mira, 7, 5);
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 7, row: 5 });
  await expect.poll(() => tokenNode(p1, goblin)).not.toBeNull();
  await expect.poll(() => cellOf(p2, mira)).toEqual({ col: 7, row: 5 });
  expect(await tokenNode(p2, goblin)).toBeNull();
  // V3 (FR-FOG-21): player-1 draws its `vision`: one `see` polygon, cut at the x = 8 wall except
  // through the open door; no darkvision. Player-2 (Thorn, darkvision 60) one `dark` polygon.
  await expect
    .poll(async () => ((await attrOf(p1, "fog-vision", "see")) as number[][] | null)?.length)
    .toBe(1);
  expect(await attrOf(p1, "fog-vision", "dark")).toEqual([]);
  expect(await attrOf(p1, "fog-vision", "blind")).toBe(false);
  expect(((await attrOf(p2, "fog-vision", "dark")) as number[][]).length).toBe(1);
  expect(await attrOf(p2, "fog-vision", "see")).toEqual([]);

  // Reload: the snapshot computes player-1's sight again.
  await p1.reload();
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await expect.poll(() => tokenNode(p1, goblin)).not.toBeNull();

  // Darkness circle [12.5, 6.5, 1.5] over the Goblin (Mira can't see into it) → gone; Undo → back.
  await dm.getByTestId("map-tool-fog").click();
  // FR-FOG-17: Mira and Thorn have senses → no "No vision set" hint.
  await expect(dm.getByTestId("fog-bar")).toBeVisible();
  await expect(dm.getByTestId("fog-no-vision")).toHaveCount(0);
  const undo = dm.getByTestId("fog-undo");
  const depth = Number(await undo.getAttribute("data-depth"));
  await dm.getByTestId("fog-mode-darkness").click();
  await dm.getByTestId("fog-shape-circle").click();
  const c = await mapToPage(dm, 12.5 * 70, 6.5 * 70);
  const edge = await mapToPage(dm, 14 * 70, 6.5 * 70);
  await dm.keyboard.down("Control");
  await dm.mouse.move(c.x, c.y);
  await dm.mouse.down();
  for (let i = 1; i <= 5; i++) await dm.mouse.move(c.x + ((edge.x - c.x) * i) / 5, c.y);
  await dm.mouse.up();
  await dm.keyboard.up("Control");
  await expect(undo).toHaveAttribute("data-depth", String(depth + 1));
  await expect.poll(() => tokenNode(p1, goblin)).toBeNull();
  await undo.click();
  await expect(undo).toHaveAttribute("data-depth", String(depth));
  await expect.poll(() => tokenNode(p1, goblin)).not.toBeNull();

  // FR-FOG-43 / -20: View as Player 1 → one load; P1's rows drawn over the DM view; the Goblin
  // (seen by P1) at full opacity, Goblin 2 (in darkness, unseen) dimmed; back to "DM".
  expect(await attrOf(dm, "fog-view-as", "player")).toBeNull();
  await dm.getByTestId("fog-view-as").click();
  await dm.locator(`[data-testid="fog-view-as-option"][data-value="${player1}"]`).click();
  await expect(dm.getByTestId("fog-view-as")).toHaveAttribute("data-value", player1);
  await expect.poll(() => attrOf(dm, "fog-view-as", "player")).toBe(player1);
  await expect(dm.getByTestId("fog-view-as")).not.toHaveAttribute("data-loading", /.*/);
  expect(((await attrOf(dm, "fog-vision", "see")) as number[][]).length).toBe(1);
  await expect.poll(async () => (await tokenNode(dm, goblin))?.opacity).toBe(1);
  await expect.poll(async () => (await tokenNode(dm, goblin2))?.opacity).toBe(0.5);
  await dm.getByTestId("fog-view-as").click();
  await dm.locator('[data-testid="fog-view-as-option"][data-value="dm"]').click();
  await expect.poll(() => attrOf(dm, "fog-view-as", "player")).toBeNull();
  await expect.poll(async () => (await tokenNode(dm, goblin2))?.opacity).toBe(1);

  // #210 (FR-FOG-47): the Goblin's token menu → Invisible → faded + "Invisible" badge for the DM;
  // gone for player-1 (no Sees invisible source).
  await dm.getByTestId("map-tool-select").click();
  const g = (await tokenNode(dm, goblin)) as { x: number; y: number };
  await dm.mouse.click(g.x, g.y, { button: "right" });
  const item = dm.getByTestId("fog-token-menu-invisible");
  await expect(item).toHaveAttribute("data-state", "unchecked");
  await item.click();
  await expect.poll(() => tokenNode(p1, goblin)).toBeNull();
  await expect.poll(async () => (await tokenNode(dm, goblin))?.opacity).toBe(0.5);
  expect(await konvaNodes(dm, "fog-token-invisible", goblin)).toHaveLength(1);

  // No player-2 frame ever named the Goblin; no `invisible` key reached a player.
  for (const f of p2Frames) {
    expect(f).not.toContain(goblin);
    expect(f).not.toContain('"invisible"');
  }
  expect(errors).toEqual([]);
});
