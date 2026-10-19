// e2e-bundle: tpl-menu
// Thin kept-template right-click menu (SCN FR-SCN-48–51, MAP FR-MAP-71; CAMP §13 K8 / K9), DM +
// player-2 in separate contexts: the DM right-clicks Web (Select tool) → Delete, Edit…, Hide, no
// laser frame; Esc closes it; Edit… → the AoE tool with Web selected; a right-drag from Web is the
// laser; a right-click on Mira's token over Web is the token menu; Delete → gone on both. Player-2:
// Spirit Guardians (player-1's) → no menu, the laser; own Thunderwave → Delete, Edit… (no Hide) →
// gone on both; Thorn's token (no template under it) → nothing, no laser frame.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { mapPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow, shellWindow } from "./support/shell";

/** Kept `scn-template` ids on the map canvas (SCN Appendix A). */
const keptIds = (page: Page) =>
  page.evaluate(() => {
    type KNode = { id(): string; getAttr(a: string): unknown };
    const K = (window as unknown as { Konva?: { stages: { find(s: string): KNode[] }[] } }).Konva;
    return (K?.stages[0]?.find(".scn-template") ?? [])
      .filter((n) => n.getAttr("ephemeral") !== true)
      .map((n) => n.id())
      .sort();
  });

/** `map.laser` frames this page sent so far (`.ended`: how many carried `end`). */
function laserFrames(page: Page): { (): number; ended(): number } {
  let n = 0;
  let ends = 0;
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      const raw = String(f.payload);
      if (!raw.includes('"map.laser"')) return;
      n++;
      if (raw.includes('"end":true')) ends++;
    }),
  );
  return Object.assign(() => n, { ended: () => ends });
}

const rightClick = (page: Page, p: { x: number; y: number }) =>
  page.mouse.click(p.x, p.y, { button: "right" });

test("FR-SCN-48 / -50 / FR-MAP-71 template right-click menu: DM Delete, Edit…, Hide; right-drag lasers; player-2 own only (DM + player-2)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const guardians = recordId("scn-templates", "aoe-template", 0);
  const glyph = recordId("scn-templates", "aoe-template", 1);
  const thunderwave = recordId("mt-templates", "aoe-template", 0);
  const web = recordId("mt-templates", "aoe-template", 1);

  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const dmLasers = laserFrames(dm);
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
  await expect.poll(() => keptIds(dm)).toEqual([guardians, glyph, thunderwave, web].sort());

  const p2 = await rolePage(browser);
  const p2Lasers = laserFrames(p2);
  await p2.goto(link("Player 2"));
  await expect(p2.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(p2.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect.poll(() => keptIds(p2)).toEqual([guardians, thunderwave, web].sort());

  // K8: Select tool, right-click Web off any token (cell (1, 6), also inside Spirit Guardians
  // below it) → the menu at the pointer: Delete, Edit…, Hide; no laser frame.
  const menu = dm.getByTestId("scn-template-ctx");
  const onWeb = await mapPoint(dm, 1, 6);
  await rightClick(dm, onWeb);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-record-id", web);
  const items = menu.locator('[data-testid^="scn-template-ctx-"]');
  await expect(items).toHaveText(["Delete", "Edit…", "Hide"]);
  await expect(dm.getByTestId("scn-template-ctx-hide")).toHaveAttribute("data-hidden", "false");
  const box = await menu.boundingBox();
  expect(Math.abs((box?.x ?? 0) - onWeb.x)).toBeLessThan(24);
  expect(Math.abs((box?.y ?? 0) - onWeb.y)).toBeLessThan(24);
  expect(dmLasers()).toBe(0);
  await dm.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Edit… → the AoE tool with Web selected (its panel and end handle).
  await rightClick(dm, onWeb);
  await dm.getByTestId("scn-template-ctx-edit").click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-tool", "aoe");
  await expect(dm.getByTestId("scn-aoe-selected")).toHaveAttribute("data-record-id", web);
  await expect
    .poll(async () => (await konvaNodes(dm, "scn-template-handle-end", web)).length)
    .toBe(1);
  await dm.getByTestId("map-tool-select").click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-tool", "select");

  // A right-drag starting on Web is the laser, no menu.
  await dm.mouse.move(onWeb.x, onWeb.y);
  await dm.mouse.down({ button: "right" });
  for (let i = 1; i <= 6; i++) await dm.mouse.move(onWeb.x + i * 8, onWeb.y + i * 3);
  await dm.mouse.up({ button: "right" });
  await expect.poll(dmLasers).toBeGreaterThan(0);
  await expect(menu).toHaveCount(0);

  // FR-MAP-71 (2): Mira's token over Web → the token menu, not the template menu.
  const mira = await mapPoint(dm, 2, 7);
  await rightClick(dm, mira);
  await expect(dm.getByTestId("map-token-menu")).toBeVisible();
  await expect(menu).toHaveCount(0);
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("map-token-menu")).toHaveCount(0);

  // Delete (no confirm) → gone on the DM and player-2.
  await rightClick(dm, await mapPoint(dm, 1, 6));
  await dm.getByTestId("scn-template-ctx-delete").click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => keptIds(dm)).toEqual([guardians, glyph, thunderwave].sort());
  await expect.poll(() => keptIds(p2)).toEqual([guardians, thunderwave].sort());

  // K9, player-2: Spirit Guardians (player-1's), off any token (cell (5, 7)) → no menu; the
  // right press is the laser as today.
  const p2Menu = p2.getByTestId("scn-template-ctx");
  await rightClick(p2, await mapPoint(p2, 5, 7));
  await expect.poll(p2Lasers.ended).toBe(1);
  await expect(p2Menu).toHaveCount(0);

  // Own Thunderwave (cell (3, 9), under DM-placed ground) → Delete, Edit…, no Hide; no laser.
  const lasers = p2Lasers();
  await rightClick(p2, await mapPoint(p2, 3, 9));
  await expect(p2Menu).toBeVisible();
  await expect(p2Menu).toHaveAttribute("data-record-id", thunderwave);
  await expect(p2Menu.locator('[data-testid^="scn-template-ctx-"]')).toHaveText([
    "Delete",
    "Edit…",
  ]);
  expect(p2Lasers()).toBe(lasers);
  await p2.getByTestId("scn-template-ctx-delete").click();
  await expect.poll(() => keptIds(p2)).toEqual([guardians]);
  await expect.poll(() => keptIds(dm)).toEqual([guardians, glyph].sort());

  // Thorn's token (no own template under it now) → nothing: no menu, no laser frame.
  await rightClick(p2, await mapPoint(p2, 2, 9));
  await p2.waitForTimeout(300);
  await expect(p2Menu).toHaveCount(0);
  expect(p2Lasers()).toBe(lasers);

  expect(errors).toEqual([]);
  await p2.context().close();
  await dm.context().close();
});
