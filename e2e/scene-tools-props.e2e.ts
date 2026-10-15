// e2e-bundle: scene-tools-props
// Thin props flow (SCN §13 step 6), DM + player-1 in separate contexts: the DM shows Goblin
// Ambush; the player sees the barrel and the table, not the hidden chest. With the Props tool the
// DM reveals the chest from its menu (the player gets it), locks it (a locked drag does nothing),
// drags the barrel a cell (the player sees it), Ctrl+Z puts it back, then places a new barrel via
// the asset picker. Player reload keeps them.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
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

/** Page px of a cell's centre (Goblin Ambush: 70 px cells, offset 0). */
const cellCentre = (page: Page, col: number, row: number) =>
  mapToPage(page, (col + 0.5) * 70, (row + 0.5) * 70);

/** A prop's footprint top-left cell, from its hit rect (`scn-prop` group, id = record id). */
async function propCell(page: Page, id: string) {
  return page.evaluate((id) => {
    type KNode = { findOne(s: string): { x(): number; y(): number } | undefined };
    type KStage = { find(s: string): (KNode & { id(): string })[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const n = K?.stages[0]?.find(".scn-prop").find((p) => p.id() === id);
    const hit = n?.findOne("Rect");
    return hit ? { col: Math.round(hit.x() / 70), row: Math.round(hit.y() / 70) } : null;
  }, id);
}

async function propAttr(page: Page, id: string, attr: string) {
  return page.evaluate(
    ([id, attr]) => {
      type KNode = { id(): string; getAttr(a: string): unknown };
      type KStage = { find(s: string): KNode[] };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      const n = K?.stages[0]?.find(".scn-prop").find((p) => p.id() === id);
      return (n?.getAttr(attr) as boolean | undefined) ?? null;
    },
    [id, attr] as const,
  );
}

const propIds = async (page: Page) => (await konvaNodes(page, "scn-prop")).map((n) => n.id).sort();

test("FR-SCN-16–19 props: reveal, lock, locked drag, move, Ctrl+Z (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const barrel = recordId("scn-props", "scene-prop", 0);
  const table = recordId("scn-props", "scene-prop", 1);
  const chest = recordId("scn-props", "scene-prop", 2);
  const chestImage = recordId("scn-prop-images", "asset", 2);

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
  await dm.getByTestId("map-show-to-players").click();
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await scenes.getByTestId("ui-window-close").click();
  const initiative = shellWindow(dm, "cbt.initiative");
  if (await initiative.isVisible()) await initiative.getByTestId("ui-window-close").click();

  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);

  // Step 1: DM all three, the chest styled hidden; the player barrel + table only.
  await expect.poll(() => propIds(dm)).toEqual([barrel, table, chest].sort());
  expect(await propAttr(dm, chest, "hidden")).toBe(true);
  await expect.poll(() => propIds(player)).toEqual([barrel, table].sort());
  expect(frames.join("\n")).not.toContain(chestImage);
  expect(frames.join("\n")).not.toContain('"locked"');

  // Props tool: DM only; props take pointer events only now.
  await expect(player.getByTestId("map-tool-props")).toHaveCount(0);
  await dm.getByTestId("map-tool-props").click();
  await expect(dm.getByTestId("scn-tool-props")).toBeVisible();
  await expect(dm.getByTestId("scn-undo")).toBeDisabled();

  // Reveal the chest from its menu → the player gets it with its image.
  const c = await cellCentre(dm, 17, 12);
  await dm.mouse.click(c.x, c.y, { button: "right" });
  await expect(dm.getByTestId("scn-prop-menu")).toHaveAttribute("data-record-id", chest);
  await expect(dm.getByTestId("scn-prop-menu-hide")).toHaveText(/Reveal/);
  await dm.getByTestId("scn-prop-menu-hide").click();
  await expect.poll(() => propIds(player)).toEqual([barrel, table, chest].sort());
  expect(frames.join("\n")).toContain(chestImage);

  // Lock it; a drag of the locked chest does nothing.
  await dm.mouse.click(c.x, c.y, { button: "right" });
  await expect(dm.getByTestId("scn-prop-menu-lock")).toHaveText(/Lock/);
  await dm.getByTestId("scn-prop-menu-lock").click();
  await expect.poll(() => propAttr(dm, chest, "locked")).toBe(true);
  const to = await cellCentre(dm, 15, 12);
  await dm.mouse.move(c.x, c.y);
  await dm.mouse.down();
  for (let i = 1; i <= 5; i++) await dm.mouse.move(c.x + ((to.x - c.x) * i) / 5, c.y);
  await dm.mouse.up();
  await dm.waitForTimeout(200);
  expect(await propCell(dm, chest)).toEqual({ col: 17, row: 12 });
  expect(frames.join("\n")).not.toContain('"locked"');

  // Drag the barrel (5, 3) → (6, 3): the player sees it; Ctrl+Z puts it back.
  const b = await cellCentre(dm, 5, 3);
  const b2 = await cellCentre(dm, 6, 3);
  await dm.mouse.move(b.x, b.y);
  await dm.mouse.down();
  for (let i = 1; i <= 5; i++) await dm.mouse.move(b.x + ((b2.x - b.x) * i) / 5, b.y);
  await dm.mouse.up();
  await expect.poll(() => propCell(player, barrel)).toEqual({ col: 6, row: 3 });
  await expect(dm.getByTestId("scn-undo")).toBeEnabled();
  await dm.keyboard.press("Control+z");
  await expect.poll(() => propCell(player, barrel)).toEqual({ col: 5, row: 3 });
  await expect.poll(() => propCell(dm, barrel)).toEqual({ col: 5, row: 3 });

  // Place a barrel at (6, 12): "Choose image…" → the DM picker → click the cell (FR-SCN-16).
  const barrelImage = recordId("scn-prop-images", "asset", 0);
  await dm.getByTestId("scn-prop-image").click();
  await dm.locator(`[data-testid="asset-picker-item"][data-record-id="${barrelImage}"]`).click();
  await dm.getByTestId("asset-picker-select").click();
  await expect(dm.getByTestId("asset-picker")).toHaveCount(0);
  await expect(dm.getByTestId("scn-prop-image-name")).toHaveText("prop-barrel");
  const at = await cellCentre(dm, 6, 12);
  await dm.mouse.click(at.x, at.y);
  await expect.poll(async () => (await propIds(player)).length).toBe(4);
  const placed = (await propIds(player)).find((id) => ![barrel, table, chest].includes(id))!;
  expect(await propCell(player, placed)).toEqual({ col: 6, row: 12 });

  // Player reload: the revealed chest and the new barrel are still there.
  await player.reload();
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect.poll(() => propIds(player)).toEqual([barrel, table, chest, placed].sort());
});
