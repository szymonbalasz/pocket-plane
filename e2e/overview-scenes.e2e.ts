// e2e-bundle: overview-scenes
// Thin overview flows (OVW §13 E2E), DM + player-1 in separate contexts: the DM shows, the player
// follows and gets no hidden item; left-drag on the locked map pans, Fit frames; the Scenes window's
// one list; a battle scene and back; Encounters Start off on an overview, with its hint; ping with
// the overview's ID; a new overview is empty; add an image, resize, hide, reveal seen by the player,
// group move, lock then pan, delete asks; Add party twice, a player drags their own and not another's,
// others see it move; place labels and their style panel.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { sceneRow, showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const itemIds = async (page: Page) => (await konvaNodes(page, "ovw-item")).map((n) => n.id).sort();
const sceneRowOf = (page: Page, id: string) =>
  page.locator(`[data-testid="ovw-scene-row"][data-record-id="${id}"]`);

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

  // FR-OVW-10: no request: the shown overview. The DM holds all seven items, hidden ones too.
  await expect(dm.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);
  await expect(dm.getByTestId("map-canvas")).toHaveCount(0);
  await expect.poll(() => itemIds(dm)).toHaveLength(7);
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await expect(dm.getByTestId("ovw-tool-ping")).toBeEnabled();

  // FR-OVW-09, -39: the player sees it; the hidden label and scroll never reach them.
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);
  await expect(player.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);
  await expect(player.getByTestId("map-canvas")).toHaveCount(0);
  await expect
    .poll(() => itemIds(player))
    .toEqual([items(0), items(1), items(2), items(5), items(6)].sort());
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
  await expect
    .poll(() => itemIds(player))
    .toEqual([items(0), items(1), items(2), items(5), items(6)].sort());
  await expect(dm.getByTestId("map-canvas")).toBeVisible();
  await expect(dm.getByTestId("map-not-shown-badge")).toBeVisible();

  // ADR-0041: after a Show the DM's items load when it views the overview.
  await row(coast).getByTestId("ovw-scene-row-name").click();
  await expect(dm.getByTestId("ovw-canvas")).toHaveAttribute("data-overview-id", coast);
  await expect.poll(() => itemIds(dm)).toHaveLength(7);

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
  await expect.poll(() => itemIds(dm)).toHaveLength(7);
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
  await expect.poll(() => itemIds(player)).toHaveLength(5);
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
  await expect.poll(() => itemIds(player)).toHaveLength(5);
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
  expect(await itemIds(player)).toHaveLength(5);
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

/** The stage pointer on a canvas node's centre. */
const centre = async (page: Page, name: string, id?: string) => {
  const [n] = await konvaNodes(page, name, id);
  if (!n) throw new Error(`no node ${name}`);
  return { x: n.x, y: n.y };
};
const drag = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifier?: "Control",
) => {
  await page.mouse.move(from.x, from.y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
};

test("FR-OVW-22 FR-OVW-23 FR-OVW-20 add an image, resize it, hide it, reveal it to the player", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const coast = recordId("ovw-sword-coast", "overview");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);
  await expect.poll(() => itemIds(player)).toHaveLength(5);

  // On a new, empty overview: its display size, and the camera fits.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes.getByTestId("map-scene-new").click();
  await dm.getByTestId("ovw-scene-new").click();
  await dm.getByTestId("ovw-scene-new-form-name").fill("Luskan");
  await dm.getByTestId("ovw-scene-new-form-submit").click();
  const canvas = dm.getByTestId("ovw-canvas");
  await expect(dm.getByTestId("ovw-canvas-empty")).toBeVisible();
  const placeImage = async () => {
    await dm.getByTestId("ovw-tool-add-image").click();
    await dm.getByTestId("ovw-add-image-choose").click();
    const picker = dm.getByTestId("asset-picker");
    await picker.getByTestId("asset-picker-item").first().click();
    await picker.getByTestId("asset-picker-select").click();
  };
  await placeImage();
  await expect.poll(() => itemIds(dm)).toHaveLength(1);
  await expect(dm.getByTestId("ovw-canvas-empty")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-camera", "fitted");
  await expect(canvas).not.toHaveAttribute("data-fit-rect", "");
  // Back on Select, with the new image selected: its handles show.
  await expect(canvas).toHaveAttribute("data-tool", "select");
  const [first] = await itemIds(dm);
  await expect.poll(async () => (await konvaNodes(dm, "ovw-handle-se")).length).toBe(1);

  // A corner keeps its shape.
  const before = (await konvaNodes(dm, "ovw-image"))[0];
  if (!before) throw new Error("no image");
  const corner = await centre(dm, "ovw-handle-se", first);
  await drag(dm, corner, { x: corner.x - before.width / 2, y: corner.y - before.height / 4 });
  await expect
    .poll(async () => (await konvaNodes(dm, "ovw-image"))[0]?.width)
    .toBeLessThan(before.width * 0.75);
  const after = (await konvaNodes(dm, "ovw-image"))[0];
  expect((after?.width ?? 0) / (after?.height ?? 1)).toBeCloseTo(before.width / before.height, 1);

  // A second image lands in the view's centre without moving the camera, Add hidden remembered.
  const camera = await canvas.getAttribute("data-zoom");
  await dm.getByTestId("ovw-tool-add-image").click();
  await dm.getByTestId("ovw-add-hidden").click();
  await dm.getByTestId("ovw-add-image-choose").click();
  await dm.getByTestId("asset-picker-item").first().click();
  await dm.getByTestId("asset-picker-select").click();
  await expect.poll(() => itemIds(dm)).toHaveLength(2);
  await expect(canvas).toHaveAttribute("data-zoom", camera ?? "");
  await expect.poll(async () => (await konvaNodes(dm, "ovw-item-hidden")).length).toBe(1);
  await dm.reload();
  await live(dm);
  await dm.getByTestId("ovw-tool-add-image").click();
  await expect(dm.getByTestId("ovw-add-hidden")).toHaveAttribute("data-state", "checked");
  await dm.getByTestId("ovw-add-hidden").click();
  await dm.getByTestId("ovw-tool-select").click();

  // Back on the shown overview: right-click the hidden scroll, Reveal: the player gets it.
  await sceneRowOf(dm, coast).getByTestId("ovw-scene-row-name").click();
  await expect(canvas).toHaveAttribute("data-overview-id", coast);
  await expect.poll(() => itemIds(dm)).toHaveLength(7);
  const scroll = recordId("ovw-sword-coast", "overview-item", 4);
  await expect(dm.getByTestId("ovw-tool-fit")).toBeVisible();
  const at = await centre(dm, "ovw-item", scroll);
  await dm.mouse.click(at.x, at.y, { button: "right" });
  const menu = dm.getByTestId("ovw-item-menu");
  await expect(menu).toHaveAttribute("data-record-id", scroll);
  await expect(menu.getByTestId("ovw-item-menu-hide")).toHaveText("Reveal");
  await menu.getByTestId("ovw-item-menu-hide").click();
  await expect.poll(() => itemIds(player)).toContain(scroll);

  // … and Hide takes it away again.
  await dm.mouse.click(at.x, at.y, { button: "right" });
  await expect(menu.getByTestId("ovw-item-menu-hide")).toHaveText("Hide");
  await menu.getByTestId("ovw-item-menu-hide").click();
  await expect.poll(() => itemIds(player)).not.toContain(scroll);

  await player.context().close();
  await dm.context().close();
});

test("FR-OVW-18 FR-OVW-16 FR-OVW-21 box, group move on every client, lock then pan, delete asks", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const label = (i: number) => recordId("ovw-sword-coast", "overview-item", i);
  const [neverwinter, phandalin] = [label(1), label(2)];
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);
  await expect.poll(() => itemIds(player)).toHaveLength(5);
  await expect.poll(() => itemIds(dm)).toHaveLength(7);
  const canvas = dm.getByTestId("ovw-canvas");
  await expect(canvas).toHaveAttribute("data-camera", "fitted");

  // A Ctrl-drag over the locked map is a box; the map itself stays out of it.
  const a = await centre(dm, "ovw-item", neverwinter);
  const b = await centre(dm, "ovw-item", phandalin);
  const left = Math.min(a.x, b.x) - 40;
  const right = Math.max(a.x, b.x) + 200;
  const top = Math.min(a.y, b.y) - 30;
  const bottom = Math.max(a.y, b.y) + 30;
  await drag(dm, { x: left, y: top }, { x: right, y: bottom }, "Control");
  const selected = async () => (await konvaNodes(dm, "ovw-item-selected")).map((n) => n.id).sort();
  await expect.poll(selected).toEqual(expect.arrayContaining([neverwinter, phandalin]));
  expect(await selected()).not.toContain(label(0));

  // A label's own box: at fit zoom its dot is under 2 px, too small to press.
  const boxOf = (id: string) => centre(dm, "ovw-item-selected", id);

  // A drag of either moves every selected one, on the player's client too.
  const a2 = await boxOf(neverwinter);
  const b2 = await boxOf(phandalin);
  const playerBefore = await centre(player, "ovw-item", phandalin);
  await drag(dm, a2, { x: a2.x + 60, y: a2.y + 40 });
  await expect
    .poll(async () => (await centre(player, "ovw-item", phandalin)).x)
    .toBeGreaterThan(playerBefore.x + 10);
  // Within a pixel or two: the browser's mouse events carry whole pixels.
  expect(Math.abs((await boxOf(phandalin)).x - (b2.x + 60))).toBeLessThan(2);
  expect(Math.abs((await boxOf(neverwinter)).x - (a2.x + 60))).toBeLessThan(2);

  // Locked (the menu acts on the selection): a left-drag pans, the items stay on the map.
  const moved = await boxOf(phandalin);
  const menu = dm.getByTestId("ovw-item-menu");
  await dm.mouse.click(moved.x, moved.y, { button: "right" });
  await menu.getByTestId("ovw-item-menu-lock").click();
  await expect.poll(async () => (await konvaNodes(dm, "ovw-item", phandalin)).length).toBe(1);
  await expect(menu).toHaveCount(0);
  const stageX = () =>
    dm.evaluate(() => {
      type KStage = { x(): number };
      return (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0]?.x() ?? 0;
    });
  await expect
    .poll(() =>
      dm.evaluate(
        (id) =>
          (
            window as unknown as {
              Konva: { stages: { findOne(s: string): { attrs: { locked?: boolean } } }[] };
            }
          ).Konva.stages[0]?.findOne(`#${id}`).attrs.locked,
        phandalin,
      ),
    )
    .toBe(true);
  const panFrom = await stageX();
  await drag(dm, moved, { x: moved.x + 50, y: moved.y + 30 });
  await expect(canvas).toHaveAttribute("data-camera", "moved");
  expect(Math.abs((await stageX()) - (panFrom + 50))).toBeLessThan(2);
  const here = await boxOf(phandalin);
  expect(Math.abs(here.x - (moved.x + 50))).toBeLessThan(2);

  // The Delete key leaves locked items; the menu's Lock is a toggle, so unlock them.
  await canvas.focus();
  await dm.keyboard.press("Delete");
  await expect(dm.getByText("Locked — unlock it first").first()).toBeVisible();
  await expect.poll(() => itemIds(dm)).toHaveLength(7);
  await dm.mouse.click(here.x, here.y, { button: "right" });
  await menu.getByTestId("ovw-item-menu-lock").click();
  await expect(menu).toHaveCount(0);

  // Deleting more than one asks first.
  await canvas.focus();
  await dm.keyboard.press("Delete");
  const dialog = dm.getByTestId("ovw-delete-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("ovw-delete-cancel").click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => itemIds(dm)).toHaveLength(7);

  // A click on one of a group narrows to it. Ctrl-D copies it and selects the copy; Delete, alone,
  // goes at once.
  await dm.mouse.click(here.x, here.y);
  await expect.poll(selected).toEqual([phandalin]);
  await canvas.focus();
  await dm.keyboard.press("Control+d");
  await expect.poll(() => itemIds(dm)).toHaveLength(8);
  await expect.poll(selected).not.toEqual([phandalin]);
  await dm.keyboard.press("Delete");
  await expect.poll(() => itemIds(dm)).toHaveLength(7);

  // Esc clears.
  await dm.mouse.click(here.x, here.y);
  await expect.poll(selected).toEqual([phandalin]);
  await canvas.focus();
  await dm.keyboard.press("Escape");
  await expect.poll(selected).toEqual([]);

  await player.context().close();
  await dm.context().close();
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

test.describe("miniatures", () => {
  const sameSpot = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  // Its art's circle, on these two portrait-less characters: a press never lands on the name.
  const pressPoint = async (page: Page, id: string) => {
    const [n] = await konvaNodes(page, "ovw-item", id);
    if (!n) throw new Error("no miniature");
    return { x: n.x, y: n.y };
  };

  test("FR-OVW-35 FR-OVW-37 a player drags their own, not another's; others see it move", async ({
    browser,
  }) => {
    const { secret, link, recordId } = e2eEnv();
    const mira = recordId("ovw-sword-coast", "overview-item", 5);
    const thorn = recordId("ovw-sword-coast", "overview-item", 6);
    const dm = await rolePage(browser);
    await loginDm(dm, secret);
    await live(dm);
    const player = await rolePage(browser);
    await player.goto(link("Player 1"));
    await live(player);
    const other = await rolePage(browser);
    await other.goto(link("Player 2"));
    await live(other);
    for (const p of [dm, player, other]) {
      await expect.poll(async () => (await konvaNodes(p, "ovw-item", mira)).length).toBe(1);
      await expect(p.getByTestId("ovw-canvas")).toHaveAttribute("data-camera", "fitted");
    }

    // Name drawn on the real fixture.
    const names = (await konvaNodes(player, "ovw-miniature-name")).map((n) => n.text).sort();
    expect(names).toEqual(["Mira", "Thorn"]);

    // Own: while dragging, the DM and the other player see it move; on drop it stays.
    const from = await pressPoint(player, mira);
    const dmStart = await pressPoint(dm, mira);
    const otherStart = await pressPoint(other, mira);
    await player.mouse.move(from.x, from.y);
    await player.mouse.down();
    await player.mouse.move(from.x + 40, from.y - 60, { steps: 5 });
    await expect.poll(async () => (await pressPoint(dm, mira)).y).toBeLessThan(dmStart.y - 10);
    await expect
      .poll(async () => (await pressPoint(other, mira)).y)
      .toBeLessThan(otherStart.y - 10);
    await player.mouse.up();
    await expect(player.getByTestId("ovw-canvas")).toHaveAttribute("data-camera", "fitted");
    const dropped = await pressPoint(player, mira);
    expect(sameSpot(dropped, { x: from.x + 40, y: from.y - 60 })).toBe(true);
    await player.waitForTimeout(100);
    expect((await pressPoint(dm, mira)).y).toBeLessThan(dmStart.y - 10);
    expect((await pressPoint(other, mira)).y).toBeLessThan(otherStart.y - 10);

    // Another's: pans instead; Thorn stays where the others see it. The player has no menu.
    const thornOnDm = await pressPoint(dm, thorn);
    const at = await pressPoint(player, thorn);
    await player.mouse.move(at.x, at.y);
    await player.mouse.down();
    await player.mouse.move(at.x + 30, at.y + 30, { steps: 4 });
    await player.mouse.up();
    await expect(player.getByTestId("ovw-canvas")).toHaveAttribute("data-camera", "moved");
    expect(sameSpot(await pressPoint(dm, thorn), thornOnDm)).toBe(true);
    await player.mouse.click(at.x + 30, at.y + 30, { button: "right" });
    await expect(player.getByTestId("ovw-item-menu")).toHaveCount(0);

    await other.context().close();
    await player.context().close();
    await dm.context().close();
  });

  test("FR-OVW-31 FR-OVW-33 Add party twice: placed once, then the toast; linked entries off", async ({
    browser,
  }) => {
    const { secret, recordId } = e2eEnv();
    const phandalin = recordId("ovw-phandalin", "overview");
    const dm = await rolePage(browser);
    await loginDm(dm, secret);
    await live(dm);
    await openWindow(dm, "map.scenes");
    await sceneRowOf(dm, phandalin).getByTestId("ovw-scene-row-name").click();
    const canvas = dm.getByTestId("ovw-canvas");
    await expect(canvas).toHaveAttribute("data-overview-id", phandalin);
    await expect.poll(() => itemIds(dm)).toHaveLength(1);

    const addParty = async () => {
      await dm.getByTestId("ovw-tool-add-party").click();
      await dm.getByTestId("ovw-add-party").click();
    };
    await addParty();
    await expect.poll(() => itemIds(dm)).toHaveLength(3);
    // Back on Select, the party selected.
    await expect(canvas).toHaveAttribute("data-tool", "select");
    await expect.poll(async () => (await konvaNodes(dm, "ovw-item-selected")).length).toBe(2);

    await addParty();
    await expect(dm.getByText("Everyone is already here").first()).toBeVisible();
    expect(await itemIds(dm)).toHaveLength(3);

    // FR-OVW-33: a linked miniature's Name, Image… and Owner are off; Shape isn't.
    // The tool stayed on after the toast. The party is still selected: a click narrows it to one, and
    // only then the menu brings the kind's entries. The outline holds the name too: its upper half
    // is the miniature.
    await dm.getByTestId("ovw-tool-select").click();
    const [one] = await konvaNodes(dm, "ovw-item-selected");
    if (!one) throw new Error("no miniature");
    const on = { x: one.x, y: one.y - one.height / 4 };
    await dm.mouse.click(on.x, on.y);
    await expect.poll(async () => (await konvaNodes(dm, "ovw-item-selected")).length).toBe(1);
    await dm.mouse.click(on.x, on.y, { button: "right" });
    const menu = dm.getByTestId("ovw-item-menu");
    await expect(menu.getByTestId("ovw-item-menu-name")).toHaveAttribute("data-disabled", "");
    await expect(menu.getByTestId("ovw-item-menu-image")).toHaveAttribute("data-disabled", "");
    await expect(menu.getByTestId("ovw-item-menu-owner")).toHaveAttribute("data-disabled", "");
    await expect(menu.getByTestId("ovw-item-menu-shape")).not.toHaveAttribute("data-disabled", "");

    await dm.context().close();
  });

  test("FR-OVW-32 Add miniature: name and owner from the panel, then the picker", async ({
    browser,
  }) => {
    const { secret, link, recordId } = e2eEnv();
    const dm = await rolePage(browser);
    await loginDm(dm, secret);
    await live(dm);
    const player = await rolePage(browser);
    await player.goto(link("Player 1"));
    await live(player);
    await expect.poll(() => itemIds(dm)).toHaveLength(7);
    await expect.poll(() => itemIds(player)).toHaveLength(5);
    const known = await itemIds(player);

    await dm.getByTestId("ovw-tool-add-miniature").click();
    await dm.getByTestId("ovw-add-miniature-name").fill("The Ship");
    await dm.getByTestId("ovw-add-miniature-choose").click();
    const picker = dm.getByTestId("asset-picker");
    await picker.getByTestId("asset-picker-item").first().click();
    await picker.getByTestId("asset-picker-select").click();
    await expect.poll(() => itemIds(dm)).toHaveLength(8);
    await expect.poll(() => itemIds(player)).toHaveLength(6);
    const texts = (await konvaNodes(player, "ovw-miniature-name")).map((n) => n.text);
    expect(texts).toContain("The Ship");

    // Its own Name works: an unlinked miniature; the new one is selected, its menu acts on it alone.
    await expect(dm.getByTestId("ovw-canvas")).toHaveAttribute("data-tool", "select");
    const [selected] = await konvaNodes(dm, "ovw-item-selected");
    if (!selected) throw new Error("nothing selected");
    await dm.mouse.click(selected.x, selected.y - selected.height / 4, { button: "right" });
    const menu = dm.getByTestId("ovw-item-menu");
    await menu.getByTestId("ovw-item-menu-name").click();
    await dm.getByTestId("ovw-miniature-name-input").fill("The Galley");
    await dm.getByTestId("ovw-miniature-name-submit").click();
    await expect
      .poll(async () => (await konvaNodes(player, "ovw-miniature-name")).map((n) => n.text))
      .toContain("The Galley");

    // Shape and Owner from their submenus: Player 1 can now drag it.
    await dm.mouse.click(selected.x, selected.y - selected.height / 4, { button: "right" });
    await menu.getByTestId("ovw-item-menu-owner").click();
    const ownerId = recordId("player-1", "player");
    await dm.locator(`[data-testid="ovw-item-owner-option"][data-record-id="${ownerId}"]`).click();
    await expect(menu).toHaveCount(0);
    await dm.mouse.click(selected.x, selected.y - selected.height / 4, { button: "right" });
    await menu.getByTestId("ovw-item-menu-shape").click();
    await dm.locator('[data-testid="ovw-item-shape-option"][data-value="square"]').click();
    await expect(menu).toHaveCount(0);
    const ship = (await itemIds(player)).find((id) => !known.includes(id));
    if (!ship) throw new Error("no new miniature");
    const [shipNode] = await konvaNodes(player, "ovw-item", ship);
    const [onDm] = await konvaNodes(dm, "ovw-item", ship);
    if (!shipNode || !onDm) throw new Error("no node");
    const y = shipNode.y - shipNode.height / 4;
    await player.mouse.move(shipNode.x, y);
    await player.mouse.down();
    await player.mouse.move(shipNode.x + 30, y + 30, { steps: 4 });
    await player.mouse.up();
    await expect(player.getByTestId("ovw-canvas")).toHaveAttribute("data-camera", "fitted");
    await expect
      .poll(async () => (await konvaNodes(dm, "ovw-item", ship))[0]?.x)
      .toBeGreaterThan(onDm.x + 5);

    // One server per bundle: the tests after this one count the Sword Coast's items.
    const [moved] = await konvaNodes(dm, "ovw-item", ship);
    if (!moved) throw new Error("no node");
    await dm.mouse.click(moved.x, moved.y - moved.height / 4, { button: "right" });
    await menu.getByTestId("ovw-item-menu-delete").click();
    await expect.poll(() => itemIds(player)).toHaveLength(5);

    await player.context().close();
    await dm.context().close();
  });
});

test("FR-OVW-36 a selected miniature's name: the text style panel, no dot; the player sees it", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("ovw-sword-coast", "overview-item", 5);
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await live(player);
  await expect.poll(() => itemIds(player)).toHaveLength(5);
  await expect(dm.getByTestId("ovw-canvas")).toHaveAttribute("data-camera", "fitted");
  const nameOf = (page: Page) =>
    page.evaluate(() => {
      type KNode = { text(): string; fill(): string; fontFamily(): string; fontSize(): number };
      type KStage = { find(s: string): KNode[] };
      const stage = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0];
      const node = stage?.find(".ovw-miniature-name").find((n) => n.text() === "Mira");
      return node ? { color: node.fill(), font: node.fontFamily(), size: node.fontSize() } : null;
    });
  const start = await nameOf(player);

  const [node] = await konvaNodes(dm, "ovw-item", mira);
  if (!node) throw new Error("no miniature");
  await dm.mouse.click(node.x, node.y);
  const panel = dm.getByTestId("ovw-miniature-style-panel");
  await expect(panel).toHaveAttribute("data-count", "1");
  await expect(panel.getByTestId("ovw-style-dot")).toHaveCount(0);
  await expect(dm.getByTestId("ovw-style-panel")).toHaveCount(0);

  await panel.getByTestId("ovw-style-color").fill("#ff0000");
  await expect.poll(async () => (await nameOf(player))?.color).toBe("#ff0000");
  await panel.getByTestId("ovw-style-font-fell").click();
  await expect.poll(async () => (await nameOf(player))?.font).toContain("IM Fell English SC");
  await panel.getByTestId("ovw-style-size-input").fill("60");
  await panel.getByTestId("ovw-style-size-input").press("Enter");
  await expect.poll(async () => (await nameOf(player))?.size).toBe(60);
  expect(start?.size).not.toBe(60);

  // A miniature's style isn't what the next label takes.
  await dm.getByTestId("ovw-tool-label").click();
  await expect(dm.getByTestId("ovw-style-preview")).toHaveAttribute("data-font", "garamond");

  await player.context().close();
  await dm.context().close();
});

// FR-OVW-25–30, OVW §13 walkthrough steps 4–5: names in one go, the style panel, the player's view.
test.describe("place labels", () => {
  const labelNode = async (page: Page, text: string) => {
    const nodes = await konvaNodes(page, "ovw-label-text");
    const node = nodes.find((n) => n.text === text);
    if (!node) throw new Error(`no label ${text}`);
    return node;
  };
  /** What a label draws, by its text; null until it's there. */
  const drawn = (page: Page, text: string) =>
    page.evaluate((t) => {
      type KNode = {
        text(): string;
        fontFamily(): string;
        fontSize(): number;
        strokeWidth(): number;
        fill(): string;
        parent: { findOne(s: string): KNode | undefined };
      };
      type KStage = { find(s: string): KNode[] };
      const stage = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0];
      const node = stage?.find(".ovw-label-text").find((n) => n.text() === t);
      if (!node) return null;
      return {
        font: node.fontFamily(),
        size: node.fontSize(),
        strokeWidth: node.strokeWidth(),
        color: node.fill(),
        dot: node.parent.findOne(".ovw-label-dot")?.fill() ?? null,
      };
    }, text);
  const texts = async (page: Page) => (await konvaNodes(page, "ovw-label-text")).map((n) => n.text);

  test("FR-OVW-25 FR-OVW-26 FR-OVW-28 add with Enter, a second in the same style, restyle both, the player sees it", async ({
    browser,
  }) => {
    const { secret, link } = e2eEnv();
    const dm = await rolePage(browser);
    let restyles = 0;
    dm.on("websocket", (ws) => {
      ws.on("framesent", (f) => {
        if (String(f.payload).includes("ovw.updateItems")) restyles++;
      });
    });
    await loginDm(dm, secret);
    await live(dm);
    const player = await rolePage(browser);
    await player.goto(link("Player 1"));
    await live(player);
    await expect.poll(() => itemIds(player)).toHaveLength(5);
    await expect.poll(() => itemIds(dm)).toHaveLength(7);
    const canvas = dm.getByTestId("ovw-canvas");
    await expect(canvas).toHaveAttribute("data-camera", "fitted");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const input = dm.getByTestId("ovw-label-input");
    const addLabel = async (x: number, y: number, text: string) => {
      await dm.mouse.click(x, y);
      await expect(input).toBeFocused();
      await dm.keyboard.type(text);
      await dm.keyboard.press("Enter");
      await expect(input).toHaveCount(0);
      await expect.poll(() => texts(player)).toContain(text);
    };

    // The tool's panel sets the next label's style; the first takes it, the second the same.
    await dm.getByTestId("ovw-tool-label").click();
    await expect(canvas).toHaveAttribute("data-tool", "label");
    await dm.getByTestId("ovw-style-font-fell").click();
    await expect(dm.getByTestId("ovw-style-preview")).toHaveAttribute("data-font", "fell");
    const zoom = await canvas.getAttribute("data-zoom");
    await addLabel(cx, cy, "Thundertree");
    await addLabel(cx + 120, cy + 70, "Conyberry");
    await expect(canvas).toHaveAttribute("data-tool", "label");
    await expect(canvas).toHaveAttribute("data-zoom", zoom ?? "");
    for (const text of ["Thundertree", "Conyberry"]) {
      expect((await drawn(player, text))?.font).toContain("IM Fell English SC");
    }
    // FR-OVW-30: the face has loaded, on a client that had never drawn it.
    await expect
      .poll(() => player.evaluate(() => document.fonts.check('16px "IM Fell English SC"')))
      .toBe(true);

    // Esc cancels; the tool stays on.
    await dm.mouse.click(cx - 120, cy);
    await expect(input).toBeFocused();
    await dm.keyboard.type("Nowhere");
    await dm.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-tool", "label");
    expect(await texts(dm)).not.toContain("Nowhere");

    // Both selected: one panel, for both.
    await dm.getByTestId("ovw-tool-select").click();
    await expect(dm.getByTestId("ovw-style-panel")).toHaveCount(0);
    const a = await labelNode(dm, "Thundertree");
    const b = await labelNode(dm, "Conyberry");
    await dm.mouse.click(a.x, a.y);
    await dm.keyboard.down("Control");
    await dm.mouse.click(b.x, b.y);
    await dm.keyboard.up("Control");
    const panel = dm.getByTestId("ovw-style-panel");
    await expect(panel).toHaveAttribute("data-count", "2");

    await panel.getByTestId("ovw-style-dot-color").fill("#ff0000");
    await panel.getByTestId("ovw-style-font-alegreya").click();
    await expect.poll(async () => (await drawn(player, "Conyberry"))?.dot).toBe("#ff0000");
    await expect
      .poll(async () => (await drawn(player, "Thundertree"))?.font)
      .toContain("Alegreya Sans");
    await expect.poll(() => restyles).toBe(2);

    // FR-OVW-28 one commit: a slider's drag draws on the DM's canvas only, its release sends one.
    const before = (await drawn(dm, "Thundertree"))?.size ?? 0;
    const slider = await panel.getByTestId("ovw-style-size").boundingBox();
    if (!slider) throw new Error("no size slider");
    const sliderY = slider.y + slider.height / 2;
    await dm.mouse.move(slider.x + slider.width * 0.3, sliderY);
    await dm.mouse.down();
    await dm.mouse.move(slider.x + slider.width * 0.5, sliderY, { steps: 8 });
    await expect.poll(async () => (await drawn(dm, "Conyberry"))?.size).toBeGreaterThan(before);
    expect(restyles).toBe(2);
    expect((await drawn(player, "Thundertree"))?.size).toBe(before);
    await dm.mouse.up();
    const size = (await drawn(dm, "Thundertree"))?.size ?? 0;
    await expect.poll(() => restyles).toBe(3);
    await expect.poll(async () => (await drawn(player, "Conyberry"))?.size).toBe(size);
    await expect.poll(async () => (await drawn(player, "Thundertree"))?.size).toBe(size);

    // FR-OVW-28 mixed selection: one back to Garamond; together the font shows mixed, and a change
    // to the stroke leaves each its own font.
    const c = await labelNode(dm, "Conyberry");
    await dm.mouse.click(c.x, c.y);
    await expect(panel).toHaveAttribute("data-count", "1");
    await panel.getByTestId("ovw-style-font-garamond").click();
    await expect.poll(async () => (await drawn(player, "Conyberry"))?.font).toContain("Garamond");
    const t = await labelNode(dm, "Thundertree");
    await dm.keyboard.down("Control");
    await dm.mouse.click(t.x, t.y);
    await dm.keyboard.up("Control");
    await expect(panel).toHaveAttribute("data-count", "2");
    await expect(panel.getByTestId("ovw-style-font")).toHaveAttribute("data-mixed", "true");
    await panel.getByTestId("ovw-style-stroke-width-input").fill("5");
    await panel.getByTestId("ovw-style-stroke-width-input").press("Enter");
    await expect.poll(async () => (await drawn(player, "Conyberry"))?.strokeWidth).toBe(5);
    await expect.poll(async () => (await drawn(player, "Thundertree"))?.strokeWidth).toBe(5);
    expect((await drawn(player, "Conyberry"))?.font).toContain("Garamond");
    expect((await drawn(player, "Thundertree"))?.font).toContain("Alegreya Sans");

    // FR-OVW-26: a double-click edits the text, already selected to type over; so does the menu.
    await canvas.focus();
    await dm.keyboard.press("Escape");
    const named = await labelNode(dm, "Thundertree");
    await dm.mouse.dblclick(named.x, named.y);
    await expect(input).toBeFocused();
    await dm.keyboard.type("Thundertree Ruins");
    await dm.keyboard.press("Enter");
    await expect.poll(() => texts(player)).toContain("Thundertree Ruins");
    const other = await labelNode(dm, "Conyberry");
    await dm.mouse.click(other.x, other.y, { button: "right" });
    await dm.getByTestId("ovw-item-menu-edit-text").click();
    await expect(input).toBeFocused();
    await dm.keyboard.type("Conyberry Pass");
    await dm.keyboard.press("Enter");
    await expect.poll(() => texts(player)).toContain("Conyberry Pass");

    // FR-OVW-28 last style: the reload keeps what was last used, and the next label takes it.
    await dm.reload();
    await live(dm);
    await expect.poll(() => itemIds(dm)).toHaveLength(9);
    await dm.getByTestId("ovw-tool-label").click();
    await expect(dm.getByTestId("ovw-style-preview")).toHaveAttribute("data-font", "garamond");
    await expect(dm.getByTestId("ovw-style-stroke-width-input")).toHaveValue("5");
    await addLabel(cx - 150, cy - 80, "Leilon");
    const leilon = await drawn(player, "Leilon");
    expect(leilon?.dot).toBe("#ff0000");
    expect(leilon?.strokeWidth).toBe(5);
    expect(leilon?.size).toBe(size);

    await player.context().close();
    await dm.context().close();
  });

  test("FR-OVW-25 Esc cancels only from the field; an open palette takes its Esc first", async ({
    browser,
  }) => {
    const { secret } = e2eEnv();
    const dm = await rolePage(browser);
    await loginDm(dm, secret);
    await live(dm);
    await expect.poll(() => itemIds(dm)).not.toHaveLength(0);
    const canvas = dm.getByTestId("ovw-canvas");
    await expect(canvas).toHaveAttribute("data-camera", "fitted");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas box");
    const input = dm.getByTestId("ovw-label-input");

    await dm.getByTestId("ovw-tool-label").click();
    await dm.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(input).toBeFocused();
    await dm.keyboard.type("Conyberry");

    // The palette's Esc closes the palette; the field keeps its text, and focus comes back to it.
    await dm.keyboard.press("Control+k");
    const palette = dm.getByTestId("ui-palette");
    await expect(palette).toBeVisible();
    await dm.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(input).toHaveValue("Conyberry");
    await expect(input).toBeFocused();

    // From the Game log's dice input too.
    await dm.getByTestId("dice-roll-expression").click();
    await dm.keyboard.press("Escape");
    await expect(input).toHaveValue("Conyberry");

    // In the field it cancels, sends nothing, and the tool stays on.
    await input.click();
    await dm.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-tool", "label");
    expect(await texts(dm)).not.toContain("Conyberry");

    await dm.context().close();
  });
});
