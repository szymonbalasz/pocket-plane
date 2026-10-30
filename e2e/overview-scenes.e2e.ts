// e2e-bundle: overview-scenes
// Thin overview flows (OVW §13 E2E), DM + player-1 in separate contexts: the DM shows, the player
// follows and gets no hidden item; left-drag on the locked map pans, Fit frames; the Scenes window's
// one list; a battle scene and back; Encounters Start off on an overview, with its hint; ping with
// the overview's ID; a new overview is empty. Editing, label and miniature flows: their slices.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { sceneRow, showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const itemIds = async (page: Page) => (await konvaNodes(page, "ovw-item")).map((n) => n.id).sort();

test("FR-OVW-09 FR-OVW-10 FR-OVW-14 DM shows, player follows; a battle scene and back", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const coast = recordId("ovw-sword-coast", "overview");
  const phandalin = recordId("ovw-phandalin", "overview");
  const items = (i: number) => recordId("ovw-sword-coast", "overview-item", i);
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);

  // FR-OVW-10: no request: the shown overview. The DM holds all five items, hidden ones too.
  await expect(dm.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);
  await expect(dm.getByTestId("map-canvas")).toHaveCount(0);
  await expect.poll(() => itemIds(dm)).toHaveLength(5);
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await expect(dm.getByTestId("ovw-tool-ping")).toBeEnabled();

  // FR-OVW-09, -39: the player sees it; the hidden label and scroll never reach them.
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);
  await expect(player.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);
  await expect(player.getByTestId("map-canvas")).toHaveCount(0);
  await expect.poll(() => itemIds(player)).toEqual([items(0), items(1), items(2)].sort());
  await expect(player.getByTestId("map-scenes")).toHaveCount(0);
  await expect(player.getByTestId("ovw-canvas-empty")).toHaveCount(0);

  // FR-OVW-14: one list, the Overview mark, Live on the shown one.
  const scenes = await openWindow(dm, "map.scenes");
  const row = (id: string) =>
    scenes.locator(`[data-testid="ovw-scene-row"][data-record-id="${id}"]`);
  await expect(row(coast).getByTestId("ovw-scene-live")).toBeVisible();
  await expect(row(coast).getByTestId("ovw-scene-mark")).toBeVisible();
  await expect(row(phandalin).getByTestId("ovw-scene-live")).toHaveCount(0);
  await expect(sceneRow(dm, "Town")).toBeVisible();

  // FR-OVW-10: a battle scene opened, not shown: the map, badge; the player stays.
  await sceneRow(dm, "Town").getByTestId("map-scene-row-name").click();
  await expect(dm.getByTestId("map-canvas")).toBeVisible();
  await expect(dm.getByTestId("ovw-canvas")).toHaveCount(0);
  await expect(dm.getByTestId("map-not-shown-badge")).toBeVisible();
  await expect(player.getByTestId("ovw-canvas")).toBeVisible();

  // FR-OVW-06, -41: Show the battle scene: the player follows.
  await showToPlayers(dm, "Town");
  await expect(player.getByTestId("map-canvas")).toBeVisible();
  await expect(player.getByTestId("ovw-canvas")).toHaveCount(0);
  await expect(row(coast).getByTestId("ovw-scene-live")).toHaveCount(0);

  // FR-OVW-05: and back. The DM keeps viewing Town until they open the overview.
  await row(coast).hover();
  await row(coast).getByTestId("ovw-scene-show").click();
  await expect(row(coast).getByTestId("ovw-scene-live")).toBeVisible();
  await expect(player.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);
  await expect.poll(() => itemIds(player)).toEqual([items(0), items(1), items(2)].sort());
  await expect(dm.getByTestId("map-canvas")).toBeVisible();
  await expect(dm.getByTestId("map-not-shown-badge")).toBeVisible();

  // ADR-0041: after a Show the DM's items load when it views the overview.
  await row(coast).getByTestId("ovw-scene-row-name").click();
  await expect(dm.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);
  await expect.poll(() => itemIds(dm)).toHaveLength(5);

  await player.context().close();
  await dm.context().close();
});

test("FR-OVW-10 FR-OVW-43 a viewed overview not shown: badge, ping off, Start off with the hint", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const coast = recordId("ovw-sword-coast", "overview");
  const phandalin = recordId("ovw-phandalin", "overview");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);

  const scenes = await openWindow(dm, "map.scenes");
  const row = scenes.locator(`[data-testid="ovw-scene-row"][data-record-id="${phandalin}"]`);
  await row.getByTestId("ovw-scene-row-name").click();
  await expect(dm.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", phandalin);
  await expect.poll(() => itemIds(dm)).toHaveLength(1);
  await expect(dm.getByTestId("map-not-shown-badge")).toBeVisible();
  await expect(dm.getByTestId("ovw-tool-ping")).toBeDisabled();
  await expect(dm.getByTestId("fog-view-as-top")).toBeDisabled();
  await expect(player.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);

  // FR-OVW-43: Start off, with the hint; back on on a battle scene that isn't shown.
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.getByTestId("cbt-enc-new").click();
  await expect(enc.getByTestId("cbt-enc-start")).toBeDisabled();
  await expect(enc.getByTestId("cbt-enc-start-hint")).toHaveText("Open a battle scene first");
  await sceneRow(dm, "Town").getByTestId("map-scene-row-name").click();
  await expect(dm.getByTestId("map-canvas")).toBeVisible();
  await expect(enc.getByTestId("cbt-enc-start")).toBeEnabled();
  await expect(enc.getByTestId("cbt-enc-start-hint")).toHaveCount(0);
  await expect(dm.getByTestId("fog-view-as-top")).toBeEnabled();

  await player.context().close();
  await dm.context().close();
});

test("FR-OVW-11 FR-OVW-12 FR-OVW-13 pan on the locked map, wheel, Fit, ping with the overview's ID", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const canvas = dm.getByTestId("ovw-canvas");
  await expect.poll(() => itemIds(dm)).toHaveLength(5);
  // FR-OVW-12: the 4096-wide map fits inside the view, so below 100 %.
  await expect.poll(async () => Number(await canvas.getAttribute("data-zoom"))).toBeLessThan(100);
  await expect(canvas).not.toHaveAttribute("data-fit-rect", "");
  const fitted = await canvas.getAttribute("data-zoom");

  const stagePos = () =>
    dm.evaluate(() => {
      type KStage = { x(): number; y(): number };
      const st = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0] as KStage;
      return { x: st.x(), y: st.y() };
    });
  const start = await stagePos();
  // FR-OVW-11: a left-drag on the locked map pans; the map's node stays where it is.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await dm.mouse.move(cx, cy);
  await dm.mouse.down();
  await dm.mouse.move(cx + 60, cy + 40, { steps: 4 });
  await dm.mouse.up();
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  const panned = await stagePos();
  expect(panned.x).toBeCloseTo(start.x + 60, 0);
  expect(panned.y).toBeCloseTo(start.y + 40, 0);

  // FR-OVW-11: the wheel zooms about the pointer.
  await dm.mouse.wheel(0, -200);
  await expect.poll(async () => canvas.getAttribute("data-zoom")).not.toBe(fitted);

  // FR-OVW-12: Fit puts it back.
  await dm.getByTestId("ovw-tool-fit").click();
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  await expect(canvas).toHaveAttribute("data-zoom", fitted ?? "");
  expect(await stagePos()).toEqual(start);

  // FR-OVW-13: a ping with the overview's ID reaches the player's canvas.
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);
  await expect.poll(() => itemIds(player)).toHaveLength(3);
  await dm.getByTestId("ovw-tool-ping").click();
  await dm.mouse.click(cx, cy);
  await expect.poll(async () => (await konvaNodes(player, "map-ping")).length).toBeGreaterThan(0);
  await expect.poll(async () => (await konvaNodes(dm, "map-ping")).length).toBeGreaterThan(0);

  // FR-OVW-13: Shift + ping pulls the player's view: their camera has moved, the zoom hasn't.
  const playerCanvas = player.getByTestId("ovw-canvas");
  const playerZoom = await playerCanvas.getAttribute("data-zoom");
  await expect(playerCanvas).toHaveAttribute("data-camera", "fitted");
  await dm.keyboard.down("Shift");
  await dm.mouse.click(cx + 120, cy);
  await dm.keyboard.up("Shift");
  await expect(playerCanvas).toHaveAttribute("data-camera", "moved");
  await expect(playerCanvas).toHaveAttribute("data-zoom", playerZoom ?? "");

  // FR-OVW-13: a right-drag is the laser, on the player's canvas too.
  await dm.getByTestId("ovw-tool-select").click();
  await dm.mouse.move(cx, cy);
  await dm.mouse.down({ button: "right" });
  await dm.mouse.move(cx + 40, cy + 20, { steps: 6 });
  await expect.poll(async () => (await konvaNodes(player, "map-laser")).length).toBeGreaterThan(0);
  await dm.mouse.up({ button: "right" });

  // FR-OVW-23: the image is drawn whole, in its own shape.
  const [map] = await konvaNodes(dm, "ovw-image");
  expect((map?.width ?? 0) / (map?.height ?? 1)).toBeCloseTo(4096 / 2731, 2);

  await player.context().close();
  await dm.context().close();
});

test("FR-OVW-47 not live: pan, zoom and Fit still work; ping and laser are off", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const player = await rolePage(browser);
  // The socket goes through a route that can cut it and then hold it down (as K11).
  let hold = false;
  const cut: (() => Promise<void>)[] = [];
  await player.routeWebSocket(/\/ws/, (ws) => {
    if (hold) return;
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    cut.push(async () => {
      await ws.close({ code: 4000, reason: "cut" });
      await server.close();
    });
  });
  await player.goto(link("Player 1"));
  await live(player);
  await expect.poll(() => itemIds(player)).toHaveLength(3);
  const canvas = player.getByTestId("ovw-canvas");
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  const fitted = await canvas.getAttribute("data-zoom");

  hold = true;
  for (const c of cut) await c();
  await expect(player.getByTestId("sync-connection-status")).not.toHaveAttribute(
    "data-state",
    "live",
  );
  // The picture stays; the camera is the viewer's own.
  expect(await itemIds(player)).toHaveLength(3);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await player.mouse.move(cx, cy);
  await player.mouse.down();
  await player.mouse.move(cx + 50, cy, { steps: 3 });
  await player.mouse.up();
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  await player.mouse.wheel(0, 200);
  await expect.poll(() => canvas.getAttribute("data-zoom")).not.toBe(fitted);
  await player.getByTestId("ovw-tool-fit").click();
  await expect(canvas).toHaveAttribute("data-zoom", fitted ?? "");

  // No laser and no ping leave a client that isn't live.
  await player.mouse.move(cx, cy);
  await player.mouse.down({ button: "right" });
  await player.mouse.move(cx + 30, cy, { steps: 3 });
  expect(await konvaNodes(player, "map-laser")).toHaveLength(0);
  await player.mouse.up({ button: "right" });
  await player.getByTestId("ovw-tool-ping").click();
  await player.mouse.click(cx, cy);
  expect(await konvaNodes(player, "map-ping")).toHaveLength(0);

  await player.context().close();
});

test("FR-OVW-14 New offers Overview; an empty one says so and Fit goes to the origin at 100 %", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const scenes = await openWindow(dm, "map.scenes");
  await scenes.getByTestId("map-scene-new").click();
  await expect(dm.getByTestId("map-scene-new-battle")).toBeVisible();
  await dm.getByTestId("ovw-scene-new").click();
  await dm.getByTestId("ovw-scene-new-form-name").fill("Neverwinter");
  await dm.getByTestId("ovw-scene-new-form-submit").click();

  const row = scenes.getByTestId("ovw-scene-row").filter({
    has: dm.getByTestId("ovw-scene-row-name").getByText("Neverwinter", { exact: true }),
  });
  await expect(row).toHaveAttribute("data-viewed", "true");
  const canvas = dm.getByTestId("ovw-canvas");
  await expect(canvas).toHaveAttribute(
    "data-overview-id",
    (await row.getAttribute("data-record-id")) ?? "",
  );
  await expect(dm.getByTestId("ovw-canvas-empty")).toHaveText("Add an image to begin");
  await expect(canvas).toHaveAttribute("data-zoom", "100");
  await expect(dm.getByTestId("map-not-shown-badge")).toBeVisible();

  // Rename, Duplicate, Delete from the row's menu.
  await row.getByTestId("ovw-scene-menu").click();
  await dm.getByTestId("ovw-scene-menu-rename").click();
  const renameName = dm.getByTestId("map-rename-name");
  await renameName.fill("Waterdeep");
  await dm.getByTestId("map-rename-submit").click();
  const renamed = scenes
    .getByTestId("ovw-scene-row")
    .filter({ has: dm.getByTestId("ovw-scene-row-name").getByText("Waterdeep", { exact: true }) });
  await expect(renamed).toHaveCount(1);
  await renamed.getByTestId("ovw-scene-menu").click();
  await dm.getByTestId("ovw-scene-menu-duplicate").click();
  await expect(
    scenes.getByTestId("ovw-scene-row-name").getByText("Waterdeep (copy)", { exact: true }),
  ).toBeVisible();
  await renamed.getByTestId("ovw-scene-menu").click();
  await dm.getByTestId("ovw-scene-menu-delete").click();
  await expect(renamed).toHaveCount(0);
  // Back to the default: the shown overview.
  await expect(dm.getByTestId("ovw-canvas-empty")).toHaveCount(0);

  await dm.context().close();
});
