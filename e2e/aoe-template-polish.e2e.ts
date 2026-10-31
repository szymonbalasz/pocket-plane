// e2e-bundle: tpl-menu
// AoE tool polish (SCN FR-SCN-57–60), DM + player-2 in separate contexts: no cylinder in the panel;
// the label's second line gives the measures and the pill is drawn over the tokens; a right click
// with the AoE tool removes: the player their own ephemeral, the DM a player's ephemeral, and over
// a token the DM gets the template's menu, not the token's. A player can't remove another's.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { mapPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

interface Pill {
  id: string;
  text: string | null;
  measures: string | null;
  /** The Konva layer the pill is drawn in. */
  layer: string | null;
}

/** The templates' label pills on the map canvas. */
const pills = (page: Page): Promise<Pill[]> =>
  page.evaluate(() => {
    type KNode = {
      id(): string;
      name(): string;
      text(): string;
      getLayer(): KNode | null;
      findOne(s: string): KNode | undefined;
    };
    const K = (window as unknown as { Konva?: { stages: { find(s: string): KNode[] }[] } }).Konva;
    return (K?.stages[0]?.find(".scn-template-label") ?? []).map((n) => ({
      id: n.id(),
      text: n.findOne(".scn-template-label-text")?.text() ?? null,
      measures: n.findOne(".scn-template-label-measures")?.text() ?? null,
      layer: n.getLayer()?.name() ?? null,
    }));
  });

const ephemerals = async (page: Page) =>
  (await pills(page)).filter((p) => p.id.startsWith("eph-")).map((p) => p.measures);

/** Places a sphere with the AoE tool (a press and release in one cell: the panel's radius). */
async function placeSphere(page: Page, col: number, row: number) {
  const p = await mapPoint(page, col, row);
  await page.mouse.click(p.x, p.y);
}

const rightClick = (page: Page, p: { x: number; y: number }) =>
  page.mouse.click(p.x, p.y, { button: "right" });

test("FR-SCN-57 / -58 / -59 / -60 AoE tool: no cylinder, measures on the label, over the tokens; right click removes (DM + player-2)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const web = recordId("mt-templates", "aoe-template", 1);
  const guardians = recordId("scn-templates", "aoe-template", 0);

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

  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await expect(p2.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(p2.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);

  // FR-SCN-57: the panel offers four shapes.
  await p2.getByTestId("map-tool-aoe").click();
  await expect(p2.getByTestId("scn-aoe-panel")).toBeVisible();
  await expect(p2.getByTestId("scn-aoe-shape-cylinder")).toHaveCount(0);
  await expect(p2.locator('[data-testid^="scn-aoe-shape-"]')).toHaveCount(4);

  // FR-SCN-59 / -60: kept templates' pills sit in the top Konva layer, with their measures.
  await expect
    .poll(async () => (await pills(dm)).find((p) => p.id === web)?.layer)
    .toBe("map-layer-top");
  await expect
    .poll(async () => (await pills(dm)).find((p) => p.id === web)?.measures)
    .toMatch(/^\d+ ft sides$/);

  // A placed sphere: measures on both clients.
  await p2.getByTestId("scn-aoe-shape-sphere").click();
  await p2.getByTestId("scn-aoe-size").fill("10");
  await p2.getByTestId("scn-aoe-size").press("Enter");
  await placeSphere(p2, 12, 4);
  await expect.poll(() => ephemerals(p2)).toEqual(["10 ft radius"]);
  await expect.poll(() => ephemerals(dm)).toEqual(["10 ft radius"]);

  // A line's measures follow the panel.
  await p2.getByTestId("scn-aoe-shape-line").click();
  await expect.poll(() => ephemerals(p2)).toEqual(["10 ft long · 5 ft wide"]);
  await p2.getByTestId("scn-aoe-shape-sphere").click();
  await expect.poll(() => ephemerals(dm)).toEqual(["10 ft radius"]);

  // FR-SCN-58: the player's right click on their own: gone for everyone, no menu.
  await rightClick(p2, await mapPoint(p2, 12, 4));
  await expect.poll(() => ephemerals(p2)).toEqual([]);
  await expect.poll(() => ephemerals(dm)).toEqual([]);
  await expect(p2.getByTestId("scn-template-ctx")).toHaveCount(0);
  await expect(p2.getByTestId("scn-aoe-clear")).toBeDisabled();

  // FR-SCN-58: without the AoE tool the DM's right click on it does nothing to it.
  await placeSphere(p2, 12, 4);
  await expect.poll(() => ephemerals(dm)).toEqual(["10 ft radius"]);
  await rightClick(dm, await mapPoint(dm, 12, 4));
  await dm.waitForTimeout(300);
  expect(await ephemerals(dm)).toEqual(["10 ft radius"]);

  // FR-SCN-58: with it, the DM removes the player's: gone on both, the player's panel knows.
  await dm.getByTestId("map-tool-aoe").click();
  await expect(dm.getByTestId("scn-aoe-panel")).toBeVisible();
  await rightClick(dm, await mapPoint(dm, 12, 4));
  await expect.poll(() => ephemerals(dm)).toEqual([]);
  await expect.poll(() => ephemerals(p2)).toEqual([]);
  await expect(p2.getByTestId("scn-aoe-clear")).toBeDisabled();
  // …and it stays gone (the sender stopped repeating it; receivers would redraw within 1 s).
  await dm.waitForTimeout(1500);
  expect(await ephemerals(dm)).toEqual([]);

  // A player can't remove another's: player-2's right click on Spirit Guardians (player-1's, cell
  // (5, 7), off any token) with the AoE tool: no menu, still there.
  await rightClick(p2, await mapPoint(p2, 5, 7));
  await p2.waitForTimeout(300);
  await expect(p2.getByTestId("scn-template-ctx")).toHaveCount(0);
  expect((await pills(p2)).map((p) => p.id)).toContain(guardians);

  // The DM's right click on their own ephemeral.
  await placeSphere(dm, 12, 4);
  await expect.poll(() => ephemerals(dm)).toEqual(["20 ft radius"]);
  await rightClick(dm, await mapPoint(dm, 12, 4));
  await expect.poll(() => ephemerals(dm)).toEqual([]);

  // FR-SCN-58: a kept template over a token: Mira's token on Web → with the AoE tool the
  // template's menu, not the token's.
  const mira = await mapPoint(dm, 2, 7);
  await rightClick(dm, mira);
  await expect(dm.getByTestId("scn-template-ctx")).toHaveAttribute("data-record-id", web);
  await expect(dm.getByTestId("map-token-menu")).toHaveCount(0);
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("scn-template-ctx")).toHaveCount(0);

  // Any other tool: the token's menu, as before.
  await dm.getByTestId("map-tool-select").click();
  await rightClick(dm, mira);
  await expect(dm.getByTestId("map-token-menu")).toBeVisible();
  await dm.keyboard.press("Escape");

  expect(errors).toEqual([]);
  await p2.context().close();
  await dm.context().close();
});
