// e2e-bundle: map-tools
// Thin freeform AoE flow (SCN §13 E2E, sprint 4), DM + player-1 + player-2 in separate contexts:
// player-1 places a cone with Ctrl held ("Free" chip, decimal origin), Keep → its `scn-template`
// `cells` attr is equal on the DM and player-2 (every client computes the squares itself,
// FR-SCN-41); the DM's Clear templates (default scope) keeps it, Clear with the box removes it
// (FR-SCN-44). Then (#375) player-1's snapped origins: a sphere at the centre of the pressed cell,
// at Crypt Ogre's (Large) centre over the ogre, a cube on a vertex; the origin cells highlighted
// while the press is held; the DM receives the same origin.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { gridPoint, mapPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

interface TemplateNode {
  id: string;
  ephemeral: boolean;
  cells: string;
  origin: string;
  angle: number;
  text: string | null;
}

/** `scn-template` Konva groups on the map canvas (SCN Appendix A, sprint 4 attrs). */
async function templates(page: Page): Promise<TemplateNode[]> {
  return page.evaluate(() => {
    type KNode = {
      id(): string;
      getAttr(a: string): unknown;
      findOne(s: string): { text(): string } | undefined;
    };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(".scn-template") ?? []).map((n) => ({
      id: n.id(),
      ephemeral: n.getAttr("ephemeral") === true,
      cells: String(n.getAttr("cells") ?? ""),
      origin: String(n.getAttr("origin") ?? ""),
      angle: Number(n.getAttr("angle")),
      text: n.findOne(".scn-template-label-text")?.text() ?? null,
    }));
  });
}

/** #375: the origin cells highlighted while placing, as "col,row,n", or null. */
const originCell = (page: Page) =>
  page.evaluate(() => {
    type KNode = { getAttr(a: string): unknown };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const n = K?.stages[0]?.find(".scn-aoe-origin-cell")[0];
    return n ? ["col", "row", "n"].map((a) => n.getAttr(a)).join(",") : null;
  });

const keptLabels = async (page: Page) =>
  (await templates(page))
    .filter((t) => !t.ephemeral)
    .map((t) => (t.text ?? "").split(" · ")[0])
    .sort();
const byLabel = async (page: Page, label: string) =>
  (await templates(page)).find((t) => !t.ephemeral && t.text?.startsWith(`${label} · `));

test("FR-SCN-41 / -43 / -44 player-1 places a Ctrl cone, Keep: same cells on DM and player-2; Clear (default) keeps it, Clear with the box removes it", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");

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
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  await expect
    .poll(() => keptLabels(dm))
    .toEqual(["Glyph", "Spirit Guardians", "Thunderwave", "Web"]);

  const [p1, p2] = [await rolePage(browser), await rolePage(browser)];
  await p1.goto(link("Player 1"));
  await p2.goto(link("Player 2"));
  for (const p of [p1, p2]) {
    await expect(p.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(p.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  }
  // FR-SCN-41: Thunderwave (player-2's fixture cube) = the 8 golden squares on every client.
  await expect
    .poll(async () => (await byLabel(p2, "Thunderwave"))?.text)
    .toBe("Thunderwave · 8 squares");
  const golden = "3,8 2,9 3,9 4,9 2,10 3,10 4,10 3,11";
  for (const p of [dm, p1, p2]) expect((await byLabel(p, "Thunderwave"))?.cells).toBe(golden);

  // FR-SCN-43: player-1, AoE → Cone 15 ft "Burning Hands"; hold Ctrl, press (3.37, 7.64), drag
  // to (5.75, 9.47), release.
  await p1.getByTestId("map-tool-aoe").click();
  await expect(p1.getByTestId("scn-aoe-panel")).toBeVisible();
  await p1.getByTestId("scn-aoe-shape-cone").click();
  await p1.getByTestId("scn-aoe-size").fill("15");
  await p1.getByTestId("scn-aoe-size").press("Enter");
  await p1.getByTestId("scn-aoe-label").fill("Burning Hands");
  await p1.getByTestId("scn-aoe-label").press("Enter");
  await mapPoint(p1, 4, 8, { margin: 2 });
  const from = await gridPoint(p1, 3.37, 7.64);
  const to = await gridPoint(p1, 5.75, 9.47);
  await p1.mouse.move(from.x - 10, from.y - 10);
  await p1.keyboard.down("Control");
  await p1.mouse.move(from.x, from.y);
  await expect(p1.getByTestId("scn-free-chip")).toBeVisible();
  await p1.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await p1.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
  }
  await p1.mouse.up();
  await p1.keyboard.up("Control");
  await expect(p1.getByTestId("scn-free-chip")).toHaveCount(0);
  const own = (await templates(p1)).find((t) => t.id === "eph-own");
  // Free: an off-grid origin (0.01 cell; the mouse moves in whole screen px) and a 0.1° angle,
  // not a vertex / 15° step.
  const [ox, oy] = (own?.origin ?? "").split(",").map(Number);
  expect(Math.abs((ox ?? 0) - 3.37)).toBeLessThanOrEqual(0.05);
  expect(Math.abs((oy ?? 0) - 7.64)).toBeLessThanOrEqual(0.05);
  expect((own?.angle ?? 0) % 15).not.toBe(0);
  expect(own?.cells).toBe("4,8 5,8 4,9 5,9");
  expect(own?.text).toBe("Burning Hands · 4 squares");
  // The DM and player-2 show the same squares live (ephemeral).
  for (const p of [dm, p2]) {
    await expect
      .poll(async () => (await templates(p)).find((t) => t.ephemeral)?.cells)
      .toBe(own?.cells);
  }

  // FR-SCN-25: Keep → a kept record; same `cells` on the DM and player-2.
  await p1.getByTestId("scn-aoe-keep").click();
  for (const p of [dm, p1, p2]) {
    await expect.poll(async () => (await byLabel(p, "Burning Hands"))?.cells).toBe(own?.cells);
    await expect.poll(async () => (await templates(p)).filter((t) => t.ephemeral)).toEqual([]);
  }
  const keptOrigin = (await byLabel(dm, "Burning Hands"))?.origin;
  expect((await byLabel(p2, "Burning Hands"))?.origin).toBe(keptOrigin);

  // FR-SCN-44: the DM's Clear templates: default scope = DM-placed only (Web, Glyph).
  await dm.getByTestId("map-tool-aoe").click();
  await dm.getByTestId("scn-aoe-clear-all").click();
  const dialog = dm.getByTestId("scn-aoe-clear-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Clear 2 DM templates on this scene?");
  await expect(dm.getByTestId("scn-aoe-clear-players")).toHaveAttribute("data-count", "3");
  await expect(dm.getByTestId("scn-aoe-clear-players")).toHaveAttribute("data-state", "unchecked");
  await expect(dm.getByTestId("scn-aoe-clear-confirm")).toHaveAttribute("data-count", "2");
  await dm.getByTestId("scn-aoe-clear-confirm").click();
  await expect(dialog).toHaveCount(0);
  const players = ["Burning Hands", "Spirit Guardians", "Thunderwave"];
  for (const p of [dm, p1, p2]) await expect.poll(() => keptLabels(p)).toEqual(players);

  // Again: nothing DM-placed left → Confirm disabled until ticked; Cancel sends nothing.
  await dm.getByTestId("scn-aoe-clear-all").click();
  await expect(dialog).toContainText("Clear 0 DM templates on this scene?");
  await expect(dm.getByTestId("scn-aoe-clear-confirm")).toBeDisabled();
  await dm.getByTestId("scn-aoe-clear-cancel").click();
  await expect(dialog).toHaveCount(0);
  await dm.getByTestId("scn-aoe-clear-all").click();
  await dm.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await keptLabels(p2)).toEqual(players);

  // With the box: the players' kept templates go too.
  await dm.getByTestId("scn-aoe-clear-all").click();
  await dm.getByTestId("scn-aoe-clear-players").click();
  await expect(dm.getByTestId("scn-aoe-clear-confirm")).toHaveAttribute("data-count", "3");
  await dm.getByTestId("scn-aoe-clear-confirm").click();
  for (const p of [dm, p1, p2]) await expect.poll(() => keptLabels(p)).toEqual([]);
  expect(errors).toEqual([]);

  for (const p of [p1, p2, dm]) await p.context().close();
});

test("FR-SCN-43 (#375) snapped origins: cell centre, a Large token's centre, a cube on a vertex; origin cells highlighted while held; the DM gets the same origin", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await showToPlayers(dm, "Goblin Ambush");
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  const p1 = await rolePage(browser);
  p1.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);

  const own = async () => (await templates(p1)).find((t) => t.id === "eph-own");
  const dmEph = async () => (await templates(dm)).find((t) => t.ephemeral);
  /** Press (held) at grid point (gx, gy), check the highlight, release. */
  const press = async (gx: number, gy: number, cell: string | null) => {
    const at = await gridPoint(p1, gx, gy);
    await p1.mouse.move(at.x, at.y);
    await p1.mouse.down();
    await expect.poll(() => originCell(p1)).toBe(cell);
    await p1.mouse.up();
    await expect.poll(() => originCell(p1)).toBeNull();
  };

  await p1.getByTestId("map-tool-aoe").click();
  await p1.getByTestId("scn-aoe-shape-sphere").click();
  // A 20-ft sphere pressed in cell (7, 4): origin (7.5, 4.5), that cell highlighted while held.
  await mapPoint(p1, 7, 4, { margin: 2 });
  await press(7.3, 4.8, "7,4,1");
  expect((await own())?.origin).toBe("7.5,4.5");
  await expect.poll(async () => (await dmEph())?.origin).toBe("7.5,4.5");
  expect((await dmEph())?.cells).toBe((await own())?.cells);

  // Over Crypt Ogre (Large at (4, 10)): the token's centre, the vertex (5, 11); its 2 × 2 lit.
  await mapPoint(p1, 4, 10, { margin: 2 });
  await press(4.3, 11.6, "4,10,2");
  expect((await own())?.origin).toBe("5,11");
  await expect.poll(async () => (await dmEph())?.origin).toBe("5,11");
  expect((await dmEph())?.cells).toBe((await own())?.cells);

  // A cube keeps its corner on the nearest vertex; nothing highlighted.
  await p1.getByTestId("scn-aoe-shape-cube").click();
  await mapPoint(p1, 8, 4, { margin: 2 });
  await press(8.3, 4.2, null);
  expect((await own())?.origin).toBe("8,4");
  await expect.poll(async () => (await dmEph())?.origin).toBe("8,4");

  // Esc ends the ephemeral for everyone (nothing kept for the next spec).
  await p1.keyboard.press("Escape");
  await expect.poll(async () => (await templates(dm)).filter((t) => t.ephemeral)).toEqual([]);
  expect(errors).toEqual([]);
  for (const p of [p1, dm]) await p.context().close();
});
