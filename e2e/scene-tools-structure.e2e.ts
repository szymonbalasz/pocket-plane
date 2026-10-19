// e2e-bundle: scene-tools
// Thin scene-tools structure flows (SCN §13 E2E), DM + player-1 in separate contexts: the DM
// shows Goblin Ambush; player-1's move through the wall reverts with the Toast and the cell
// flash; the DM double-clicks d1 open and the move through it succeeds; the door menu unlocks d2
// (players see it closed throughout); the Structure tool draws a wall and Undo removes it.
// Sprint 3 (SCN S1-S4): Ctrl free points + the "Free" chip, the endpoint magnet closing a gap with
// a door, the player's red wall hint while dragging (map.checkMove), the DM's red crossed
// segments; players never get walls.
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

/** A Konva node attribute (e.g. a door's `state`, the walls' `count`), or null. */
async function attr(page: Page, name: string, id: string | null, a: string) {
  return page.evaluate(
    ([name, id, a]) => {
      type KNode = { id(): string; getAttr(a: string): unknown };
      type KStage = { find(s: string): KNode[] };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      const n = (K?.stages[0]?.find(`.${name}`) ?? []).find((x) => id === null || x.id() === id);
      return (n?.getAttr(a) as string | number | undefined) ?? null;
    },
    [name, id, a] as const,
  );
}

/** The token's cell (Goblin Ambush: 70 px cells, offset 0). */
async function cellOf(page: Page, tokenId: string) {
  return page.evaluate((id) => {
    const K = (
      window as unknown as {
        Konva?: { stages: { find(s: string): { id(): string; x(): number; y(): number }[] }[] };
      }
    ).Konva;
    // The token group itself (a drag path / trail shares its id, FR-MAP-52).
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

test("FR-SCN-11 / -12 / -09 / -08 / -15 blocked move, door open, door menu, draw + undo (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);

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
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  // The wide Game log (FR-DICE-38) covers the lower map at 1280×800: park it (no refit).
  await shellWindow(dm, "dice.log").getByTestId("ui-window-minimise").click();

  // DM: walls (one shape, 3 segments), d1 closed, d2 locked.
  await expect.poll(() => attr(dm, "scn-walls", null, "count")).toBe(3);
  expect(await attr(dm, "scn-door", "door-4", "state")).toBe("closed");
  expect(await attr(dm, "scn-door", "door-5", "state")).toBe("locked");

  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  // Player: doors only, both closed; no walls.
  await expect.poll(() => attr(player, "scn-door", "door-5", "state")).toBe("closed");
  expect(await attr(player, "scn-door", "door-4", "state")).toBe("closed");
  expect(await konvaNodes(player, "scn-walls")).toHaveLength(0);

  // FR-SCN-11 / -12: Mira (2, 7) → (10, 7) is refused: Toast, cell flash, snap back.
  await expect.poll(() => tokenNode(player, mira)).not.toBeNull();
  await dragTo(player, mira, 10, 7);
  await expect(player.getByText("Blocked by a wall or door")).toBeVisible();
  await expect.poll(async () => (await konvaNodes(player, "scn-blocked-cell")).length).toBe(1);
  await expect.poll(() => cellOf(player, mira)).toEqual({ col: 2, row: 7 });
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 2, row: 7 });
  await expect.poll(async () => (await konvaNodes(player, "scn-blocked-cell")).length).toBe(0);

  // FR-SCN-09: the DM double-clicks d1 (Select tool) → open for the player.
  const d1 = (await konvaNodes(dm, "scn-door", "door-4"))[0] as { x: number; y: number };
  await dm.mouse.dblclick(d1.x, d1.y);
  await expect.poll(() => attr(player, "scn-door", "door-4", "state")).toBe("open");
  await dragTo(player, mira, 7, 5);
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 7, row: 5 });
  await dragTo(player, mira, 9, 5);
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 9, row: 5 });

  // Door menu: unlock d2 on the DM; the player's d2 stays closed.
  const d2 = (await konvaNodes(dm, "scn-door", "door-5"))[0] as { x: number; y: number };
  await dm.mouse.click(d2.x, d2.y, { button: "right" });
  await expect(dm.getByTestId("scn-door-menu")).toBeVisible();
  await expect(dm.getByTestId("scn-door-menu-lock")).toHaveCount(0);
  await dm.getByTestId("scn-door-menu-unlock").click();
  await expect.poll(() => attr(dm, "scn-door", "door-5", "state")).toBe("closed");
  expect(await attr(player, "scn-door", "door-5", "state")).toBe("closed");

  // FR-SCN-08 / -15: Structure → Wall: (13, 9) → (15, 9) → double-click (15, 11); Undo removes it.
  await dm.getByTestId("map-tool-structure").click();
  await expect(dm.getByTestId("scn-structure-panel")).toBeVisible();
  await expect(dm.getByTestId("scn-undo")).toBeEnabled(); // the unlock is undoable
  await dm.getByTestId("scn-structure-mode-wall").click();
  for (const [x, y] of [
    [13, 9],
    [15, 9],
  ] as const) {
    const p = await mapToPage(dm, x * 70, y * 70);
    await dm.mouse.click(p.x, p.y);
  }
  await expect.poll(() => attr(dm, "scn-edit-polyline", null, "count")).toBe(2);
  const end = await mapToPage(dm, 15 * 70, 11 * 70);
  await dm.mouse.dblclick(end.x, end.y);
  await expect.poll(() => attr(dm, "scn-walls", null, "count")).toBe(5);
  await dm.getByTestId("scn-undo").click();
  await expect.poll(() => attr(dm, "scn-walls", null, "count")).toBe(3);
  await dm.keyboard.press("Control+z"); // the unlock → locked again
  await expect.poll(() => attr(dm, "scn-door", "door-5", "state")).toBe("locked");
  await dm.keyboard.press("Control+z"); // the double-click → d1 closed again, for the player too
  await expect.poll(() => attr(player, "scn-door", "door-4", "state")).toBe("closed");
  await expect(dm.getByTestId("scn-undo")).toBeDisabled();

  // Leak strings: players never get walls or a locked door state.
  const raw = frames.join("\n");
  expect(raw).not.toContain('"walls"');
  expect(raw).not.toMatch(/\[5,8,11,8,12,2/);

  await player.context().close();
  await dm.context().close();
});

test("FR-MAP-28 a drag in progress when the connection drops snaps back unsent; the DM's preview clears; no frames after", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);

  // The player's socket goes through a route we can cut (a server loss, seen from the player).
  const player = await rolePage(browser);
  const sockets: { cut(): Promise<void> }[] = [];
  let dragFrames = 0;
  await player.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (String(m).includes('"map.drag"')) dragFrames++;
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
    sockets.push({
      cut: async () => {
        await ws.close({ code: 4000, reason: "cut" });
        await server.close();
      },
    });
  });
  await player.goto(link("Player 1"));
  const status = player.getByTestId("sync-connection-status");
  await expect(status).toHaveAttribute("data-state", "live");
  await expect.poll(() => tokenNode(player, mira)).not.toBeNull();
  const start = (await cellOf(player, mira)) as { col: number; row: number };

  // Press on Mira and drag a little, without releasing; the DM sees the preview.
  const m = (await tokenNode(player, mira)) as { x: number; y: number };
  await player.mouse.move(m.x, m.y);
  await player.mouse.down();
  for (let i = 1; i <= 4; i++) await player.mouse.move(m.x + 12 * i, m.y + 6 * i);
  await expect.poll(() => attr(dm, "map-token", mira, "preview")).toBe(true);

  // The connection drops mid-drag; the player reconnects while still holding, then releases.
  await sockets.at(-1)?.cut();
  await expect(status).not.toHaveAttribute("data-state", "live");
  await expect(status).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  await player.mouse.move(m.x + 80, m.y + 40);
  await player.mouse.up();

  // Snapped back unsent, on the player and the DM; the DM's preview is gone and stays gone.
  await expect.poll(() => cellOf(player, mira)).toEqual(start);
  await expect.poll(() => attr(dm, "map-token", mira, "preview"), { timeout: 5_000 }).toBeNull();
  await expect.poll(() => cellOf(dm, mira)).toEqual(start);
  const after = dragFrames;
  await player.waitForTimeout(2_500);
  expect(dragFrames).toBe(after);
  expect(await attr(dm, "map-token", mira, "preview")).toBeNull();

  // Leave the bundle as loaded for the next spec on this server: Mira at (2, 7), Town shown.
  await dragTo(dm, mira, 2, 7);
  await expect.poll(() => cellOf(player, mira)).toEqual({ col: 2, row: 7 });
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${recordId("town", "scene")}"] button`)
    .first()
    .click();
  await showToPlayers(dm, "Town");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute(
    "data-scene-id",
    recordId("town", "scene"),
  );

  await player.context().close();
  await dm.context().close();
});

/** The newest DM `scene-structure` record seen in `frames` (walls and doors). */
function latestStructure(frames: string[]): { walls: number[][]; doors: number[][] } | null {
  let found: { walls: number[][]; doors: number[][] } | null = null;
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.walls) && Array.isArray(o.doors)) {
      found = o as unknown as { walls: number[][]; doors: number[][] };
    }
    for (const x of Object.values(o)) visit(x);
  };
  for (const f of frames) {
    try {
      visit(JSON.parse(f));
    } catch {
      // not JSON: skip
    }
  }
  return found;
}

test("FR-SCN-08 / -38 / -13 freeform walls + magnet door, player wall hint before the drop, DM red crossing (S1–S4)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const town = recordId("town", "scene");
  const mira = recordId("battlemap", "token", 0);
  const goblin = recordId("battlemap", "token", 1);

  const dm = await rolePage(browser);
  const dmFrames: string[] = [];
  dm.on("websocket", (ws) => ws.on("framereceived", (f) => dmFrames.push(String(f.payload))));
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
  await expect.poll(() => attr(dm, "scn-walls", null, "count")).toBe(3);

  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect.poll(() => tokenNode(player, mira)).not.toBeNull();

  const at = (x: number, y: number) => mapToPage(dm, x * 70, y * 70);
  const ctrlClick = async (x: number, y: number) => {
    const p = await at(x, y);
    await dm.mouse.move(p.x, p.y);
    await dm.keyboard.down("Control");
    await dm.mouse.move(p.x + 1, p.y);
    await dm.mouse.move(p.x, p.y);
    await expect(dm.getByTestId("scn-free-chip")).toBeVisible();
    await dm.mouse.click(p.x, p.y);
    await dm.keyboard.up("Control");
    await dm.mouse.move(p.x + 1, p.y);
  };

  // S1, 6 rows lower (on screen): (10, 8) → Ctrl (12.4, 9.65), double-click ends; Ctrl
  // (13.1, 10.8) → (15, 12), double-click.
  await dm.getByTestId("map-tool-structure").click();
  await dm.getByTestId("scn-structure-mode-wall").click();
  const v = await at(10, 8);
  await dm.mouse.click(v.x, v.y);
  await expect(dm.getByTestId("scn-free-chip")).toHaveCount(0);
  await ctrlClick(12.4, 9.65);
  await expect.poll(() => attr(dm, "scn-draft-point", "1", "free")).toBe(true);
  expect(await attr(dm, "scn-draft-point", "0", "free")).toBe(false);
  const e1 = await at(12.4, 9.65); // the magnet takes the double-click onto the free point
  await dm.mouse.dblclick(e1.x, e1.y);
  await expect.poll(() => attr(dm, "scn-walls", null, "count")).toBe(4);
  await ctrlClick(13.1, 10.8);
  const e2 = await at(15, 12);
  await dm.mouse.click(e2.x, e2.y);
  await dm.mouse.dblclick(e2.x, e2.y);
  await expect.poll(() => attr(dm, "scn-walls", null, "count")).toBe(5);
  const walls = latestStructure(dmFrames)?.walls ?? [];
  const w1 = walls.find((w) => w[1] === 10 && w[2] === 8) as number[];
  const w2 = walls.find((w) => w[3] === 15 && w[4] === 12) as number[];
  expect(w1).toBeDefined();
  expect(w2).toBeDefined();
  expect(Number.isInteger(w1[3]) && Number.isInteger(w1[4])).toBe(false);

  // S2: Door mode, each click 5 px (screen) from a free wall end → exactly on both ends.
  await dm.getByTestId("scn-structure-mode-door").click();
  const g1 = await at(w1[3] as number, w1[4] as number);
  const g2 = await at(w2[1] as number, w2[2] as number);
  await dm.mouse.click(g1.x + 5, g1.y);
  await dm.mouse.click(g2.x, g2.y - 5);
  await expect.poll(() => latestStructure(dmFrames)?.doors.length).toBe(3);
  const door = latestStructure(dmFrames)?.doors.at(-1) as number[];
  expect(door.slice(1, 5)).toEqual([w1[3], w1[4], w2[1], w2[2]]);

  // S3 (DM): Goblin dragged across x = 8: red crossed segment + "through wall"; released unmoved.
  await dm.getByTestId("map-tool-select").click();
  const gob = (await tokenNode(dm, goblin)) as { x: number; y: number };
  const west = await mapToPage(dm, 4 * 70 + 35, 6 * 70 + 35);
  await dm.mouse.move(gob.x, gob.y);
  await dm.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await dm.mouse.move(gob.x + ((west.x - gob.x) * i) / 6, gob.y + ((west.y - gob.y) * i) / 6);
  }
  await expect.poll(async () => (await konvaNodes(dm, "scn-wall-crossed")).length).toBe(1);
  await expect.poll(async () => (await konvaNodes(dm, "scn-through-wall")).length).toBe(1);
  await dm.mouse.move(gob.x, gob.y, { steps: 6 });
  await dm.mouse.up();
  await expect.poll(async () => (await konvaNodes(dm, "scn-wall-crossed")).length).toBe(0);
  await expect.poll(() => cellOf(dm, goblin)).toEqual({ col: 12, row: 6 });

  // S3 (player): Mira held over (10, 7) → one red piece [8, 7, 8, 8]; back → gone; release unmoved.
  const m = (await tokenNode(player, mira)) as { x: number; y: number };
  const to = await mapToPage(player, 10 * 70 + 35, 7 * 70 + 35);
  await player.mouse.move(m.x, m.y);
  await player.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await player.mouse.move(m.x + ((to.x - m.x) * i) / 8, m.y + ((to.y - m.y) * i) / 8);
  }
  await expect.poll(() => attr(player, "scn-wall-hint", null, "segment")).toBe("8,7,8,8");
  expect(await konvaNodes(player, "scn-wall-hint")).toHaveLength(1);
  await player.mouse.move(m.x + 80, m.y, { steps: 4 });
  await expect.poll(async () => (await konvaNodes(player, "scn-wall-hint")).length).toBe(0);
  await player.mouse.move(m.x, m.y, { steps: 4 });
  await player.mouse.up();
  await expect.poll(() => cellOf(dm, mira)).toEqual({ col: 2, row: 7 });

  // S4: Undo ×3 (door, wall, wall) → Goblin Ambush's structure as loaded.
  await dm.getByTestId("map-tool-structure").click();
  for (let i = 0; i < 3; i++) await dm.getByTestId("scn-undo").click();
  await expect.poll(() => attr(dm, "scn-walls", null, "count")).toBe(3);
  await expect.poll(() => latestStructure(dmFrames)?.doors.length).toBe(2);

  // Leak strings: players never get walls.
  const raw = frames.join("\n");
  expect(raw).not.toContain('"walls"');

  // Leave the bundle as loaded: Town shown.
  await dm.getByTestId("map-tool-select").click();
  const again = await openWindow(dm, "map.scenes");
  await again
    .locator(`[data-testid="map-scene-row"][data-record-id="${town}"] button`)
    .first()
    .click();
  await showToPlayers(dm, "Town");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", town);

  await player.context().close();
  await dm.context().close();
});
