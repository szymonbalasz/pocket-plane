// e2e-bundle: scenes
// Thin scenes-map flows (MAP §13 E2E), DM + player-1 in separate contexts: player drags Mira,
// DM sees it; DM reveals Wolf; feedback: Goblin → square (the menu's selection is temporary),
// box select + Ctrl-click + empty click (FR-MAP-31/32/35); DM activates the battlemap; reload.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, stageScale, tokenNode } from "./support/konva";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

/** A token's map-space cell (Town / Goblin Ambush: 70 px cells, offset 0). */
async function cellOf(page: Page, tokenId: string) {
  return page.evaluate((id) => {
    const K = (
      window as unknown as {
        Konva?: { stages: { findOne(s: string): { x(): number; y(): number } | undefined }[] };
      }
    ).Konva; // undefined until the lazy MapCanvas chunk loads
    const n = K?.stages[0]?.findOne(`#${id}`);
    return n ? { col: Math.round(n.x() / 70), row: Math.round(n.y() / 70) } : null;
  }, tokenId);
}

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

/** Konva attr `attr` of the token group, e.g. `shape` (FR-MAP-35). */
async function tokenAttr(page: Page, tokenId: string, attr: string) {
  return page.evaluate(
    ([id, attr]) => {
      type KNode = { getAttr(a: string): unknown };
      type KStage = { findOne(s: string): KNode | undefined };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      return (
        (K?.stages[0]?.findOne(`#${id}`)?.getAttr(attr) as string | boolean | undefined) ?? null
      );
    },
    [tokenId, attr] as const,
  );
}

/** Selection rings (FR-MAP-31): token ids with a `map-token-ring` in state `selected`. */
async function selectedIds(page: Page) {
  return page.evaluate(() => {
    type KNode = {
      getAttr(a: string): unknown;
      findAncestor(s: string): KNode | null;
      id(): string;
    };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(".map-token-ring") ?? [])
      .filter((n) => n.getAttr("state") === "selected")
      .map((n) => n.findAncestor(".map-token")?.id() ?? "")
      .sort();
  });
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
  const dmIn: string[] = [];
  const dmOut: string[] = [];
  dm.on("websocket", (ws) => {
    ws.on("framereceived", (f) => dmIn.push(String(f.payload)));
    ws.on("framesent", (f) => dmOut.push(String(f.payload)));
  });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", town);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  const scenes = await openWindow(dm, "map.scenes"); // closed by default (map-first, #162)
  await expect(scenes.getByTestId("map-scene-row")).toHaveCount(3);
  await expect(scenes.getByTestId("map-folder-row")).toHaveCount(1);
  await expect(
    scenes
      .locator(`[data-testid="map-scene-row"][data-record-id="${town}"]`)
      .getByTestId("map-scene-live"),
  ).toBeVisible();
  // No encounter: the empty Initiative opened minimised (P3 glitch 3), clear of the map.
  await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "minimised");

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
  // FR-MAP-42 (#171): the name label is centred on the token's bottom grid line, on the labels layer.
  const [label] = await konvaNodes(player, "map-token-label", miraTown);
  expect(label?.text).toBe("Mira");
  expect(Math.abs((label?.y ?? 0) - (m.y + cell / 2))).toBeLessThan(2);
  expect(Math.abs((label?.x ?? 0) - m.x)).toBeLessThan(2);
  expect(label?.height ?? 0).toBeLessThan(cell * 0.5);
  await player.mouse.move(m.x, m.y);
  await player.mouse.down();
  for (let i = 1; i <= 6; i++) await player.mouse.move(m.x + (cell * 3 * i) / 6, m.y);
  // FR-MAP-37: "15 ft" without a speed, "15 / ‹speed› ft" with one.
  await expect
    .poll(async () => (await konvaNodes(player, "map-move-label-text"))[0]?.text)
    .toMatch(/^15( \/ \d+)? ft$/);
  // FR-MAP-40 (#171): while the player holds, the DM draws Mira from the drag preview at the held
  // spot, with no movement label of its own.
  await expect.poll(() => tokenAttr(dm, miraTown, "preview")).toBe(true);
  await expect.poll(() => cellOf(dm, miraTown)).toEqual({ col: 8, row: 5 });
  expect(await konvaNodes(dm, "map-move-label")).toHaveLength(0);
  await player.mouse.up();
  await expect.poll(() => tokenAttr(dm, miraTown, "preview")).toBeNull();
  await expect.poll(() => cellOf(dm, miraTown)).toEqual({ col: 8, row: 5 });
  await expect.poll(() => cellOf(player, miraTown)).toEqual({ col: 8, row: 5 });

  // DM views Goblin Ambush: not shown to players; Wolf + Elite there, styled hidden.
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  // ADR-0041: the DM snapshot held only Town's tokens; viewing Goblin Ambush loads them.
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  expect(dmIn.find((f) => f.includes('"type":"snapshot"'))).not.toContain(wolf);
  expect(dmOut.filter((f) => f.includes('"sync.loadScene"') && f.includes(ambush))).toHaveLength(1);
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

  // FR-MAP-35: Goblin's menu → Shape → Square. Cave Ogre is shape none (scenes-extras).
  const goblin = recordId("battlemap", "token", 1);
  const ogre = recordId("scenes-extras", "token", 2);
  expect(await tokenAttr(dm, ogre, "shape")).toBe("none");
  // The right-click selects Goblin for its menu only: once the menu closes, the DM's own
  // selection (Wolf) is back, so no stale target reaches combat's attack popup (FR-CBT-33).
  const w2 = (await tokenNode(dm, wolf))!;
  await dm.mouse.click(w2.x, w2.y);
  await expect.poll(() => selectedIds(dm)).toEqual([wolf]);
  const g = (await tokenNode(dm, goblin))!;
  await dm.mouse.click(g.x, g.y, { button: "right" });
  await expect.poll(() => selectedIds(dm)).toEqual([goblin]);
  await dm.getByTestId("map-token-menu-shape").click();
  // By keyboard: the map fit (FR-MAP-44) may put Goblin near the right edge, where the submenu
  // flips over its parent and a pointer jump to the option would close it.
  await dm.locator('[data-testid="map-token-shape-option"][data-value="square"]').press("Enter");
  await expect.poll(() => tokenAttr(dm, goblin, "shape")).toBe("square");
  await expect(dm.getByTestId("map-token-menu")).toHaveCount(0); // the pick closed the menu
  await expect.poll(() => selectedIds(dm)).toEqual([wolf]);
  await dm.keyboard.press("Escape"); // canvas Esc clears (FR-MAP-31)
  await expect.poll(() => selectedIds(dm)).toEqual([]);

  // FR-MAP-31/32: Shift+drag a box around Goblin (12, 6) and Cave Ogre (9, 10); Ctrl+click
  // Goblin; click empty canvas.
  // Empty canvas clear of the bottom-left game log (map-first layout, #162).
  const empty = await mapToPage(dm, 10 * 70, 12.5 * 70);
  await dm.mouse.click(empty.x, empty.y);
  await expect.poll(() => selectedIds(dm)).toEqual([]);
  const a = await mapToPage(dm, 8.5 * 70, 5.5 * 70);
  const b = await mapToPage(dm, 13.6 * 70, 11.6 * 70);
  await dm.keyboard.down("Shift");
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await dm.mouse.move(a.x + ((b.x - a.x) * i) / 5, a.y + ((b.y - a.y) * i) / 5);
  }
  await dm.mouse.up();
  await dm.keyboard.up("Shift");
  await expect.poll(() => selectedIds(dm)).toEqual([goblin, ogre].sort());
  const g2 = (await tokenNode(dm, goblin))!;
  await dm.keyboard.down("Control");
  await dm.mouse.click(g2.x, g2.y);
  await dm.keyboard.up("Control");
  await expect.poll(() => selectedIds(dm)).toEqual([ogre]);
  await dm.mouse.click(empty.x, empty.y);
  await expect.poll(() => selectedIds(dm)).toEqual([]);

  // Show to players: the player switches; Wolf visible, Elite and the scene name never sent.
  await dm.getByTestId("map-show-to-players").click();
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await expect(dm.getByTestId("map-tool-ping")).toBeEnabled();
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect.poll(() => tokenNode(player, wolf)).not.toBeNull();
  expect(await tokenNode(player, elite)).toBeNull();
  await expect.poll(() => tokenAttr(player, goblin, "shape")).toBe("square");
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

test("BL-06 new scene dialog shows the chosen map's name", async ({ browser }) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes.getByTestId("map-scene-new").click();
  const dialog = dm.getByRole("dialog", { name: "New scene" });
  await expect(dialog.getByText("none chosen")).toBeVisible();
  await expect(dialog.getByTestId("map-scene-new-map-name")).toHaveCount(0);
  const picker = dialog.getByTestId("asset-picker");
  await picker.getByTestId("asset-picker-item").filter({ hasText: "battlemap" }).click();
  await picker.getByTestId("asset-picker-select").click();
  const name = dialog.getByTestId("map-scene-new-map-name");
  await expect(name).toHaveText("battlemap");
  await expect(name).toHaveAttribute("title", "battlemap");
  await expect(dialog.getByText("none chosen")).toHaveCount(0);
  await dm.keyboard.press("Escape"); // cancel: no scene created
  await expect(dialog).toHaveCount(0);
  await dm.context().close();
});
