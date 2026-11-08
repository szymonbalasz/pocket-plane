// e2e-bundle: rules-effects
// Targeting through a mirror (FR-MIR-04, FR-CBT-33), thin: the DM mirrors Goblin to an empty
// cell; player-1 attacks; in the DM's attack popup a click on the mirror targets Goblin (and does
// not drag the mirror), Ctrl-click takes it off, and a Shift box round the mirror adds it again.
// The pick rules (a player's copy, DM-only items off, each token once): bun test
// (mirror-store.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { gridPoint, mapPoint } from "./support/map";
import { rollNow } from "./support/rolls";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/** The DM's mirrors: id, map x, and the centre in page px. */
function mirrors(page: Page): Promise<{ id: string; x: number; cx: number; cy: number }[]> {
  return page.evaluate(() => {
    type KNode = {
      id(): string;
      x(): number;
      findOne(s: string): KNode;
      getClientRect(): { x: number; y: number; width: number; height: number };
    };
    type KStage = { container(): HTMLElement; find(s: string): KNode[] };
    const stage = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0];
    if (!stage) return [];
    const box = stage.container().getBoundingClientRect();
    return stage.find(".mir-mirror").map((n) => {
      const r = n.findOne("Rect").getClientRect();
      return {
        id: n.id(),
        x: n.x(),
        cx: box.x + r.x + r.width / 2,
        cy: box.y + r.y + r.height / 2,
      };
    });
  });
}

// The far side of Goblin Ambush: no token there.
const CELL = { col: 16, row: 11 };

test("FR-MIR-04 FR-CBT-33 a click, Ctrl-click and box on a mirror target its token", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // DM views Goblin Ambush (the battle's scene), then Goblin's token menu → Mirror → the empty cell.
  const ambush = recordId("battlemap", "scene");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await scenes.getByTestId("ui-window-close").click();
  const goblinToken = recordId("battlemap", "token", 1);
  await expect.poll(async () => (await tokenNode(dm, goblinToken)) !== null).toBe(true);
  const t = await tokenNode(dm, goblinToken);
  if (!t) throw new Error("Goblin not on the DM's map");
  await dm.mouse.click(t.x, t.y, { button: "right" });
  await dm.getByTestId("mir-token-menu-create").click();
  await expect(dm.getByTestId("mir-pick-panel")).toBeVisible();
  const cell = await mapPoint(dm, CELL.col, CELL.row);
  await dm.mouse.click(cell.x, cell.y);
  await expect(dm.getByTestId("mir-pick-panel")).toHaveCount(0);
  await expect.poll(async () => (await mirrors(dm)).length).toBe(1);
  const mirror = (await mirrors(dm))[0] as { id: string; x: number; cx: number; cy: number };
  expect(mirror.x).toBe(CELL.col * 70);

  // Player 1: Brakka's Flame Tongue Attack → a pending card; the DM opens its popup.
  const init = await openWindow(dm, "cbt.initiative");
  const goblin = await idByName(init, "Goblin");
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const flame = sheet.getByTestId("charx-attack").filter({ hasText: "Flame Tongue" });
  await rollNow(flame.getByTestId("charx-roll-attack"));
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("cbt-popup-target-row")).toHaveCount(0);
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);

  // A click on the mirror targets Goblin; the mirror stays put.
  const at = (await mirrors(dm))[0] as { cx: number; cy: number };
  await dm.mouse.click(at.cx, at.cy);
  await expect(trow).toHaveAttribute("data-source", "selection");
  await expect(popup.getByTestId("cbt-popup-target-row")).toHaveCount(1);
  // A press dragged off the mirror moves nothing while targeting.
  await dm.mouse.move(at.cx, at.cy);
  await dm.mouse.down();
  await dm.mouse.move(at.cx + 90, at.cy + 10, { steps: 6 });
  await dm.mouse.up();
  await expect.poll(async () => (await mirrors(dm))[0]?.x).toBe(CELL.col * 70);
  await dm.screenshot({ path: test.info().outputPath("mirror-targeted.png") });

  // Ctrl-click toggles Goblin off.
  await dm.keyboard.down("Control");
  await dm.mouse.click(at.cx, at.cy);
  await dm.keyboard.up("Control");
  await expect(trow).toHaveCount(0);

  // A Shift box round the mirror's cell adds Goblin again.
  const from = await gridPoint(dm, CELL.col - 0.4, CELL.row - 0.4);
  const to = await gridPoint(dm, CELL.col + 1.4, CELL.row + 1.4);
  await dm.keyboard.down("Shift");
  await dm.mouse.move(from.x, from.y);
  await dm.mouse.down();
  await dm.mouse.move(to.x, to.y, { steps: 8 });
  await dm.mouse.up();
  await dm.keyboard.up("Shift");
  await expect(trow).toHaveAttribute("data-source", "selection");

  await popup.getByTestId("cbt-popup-dismiss").click();
  await expect(popup).toHaveCount(0);
});
