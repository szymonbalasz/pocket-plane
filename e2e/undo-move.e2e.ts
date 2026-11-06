// e2e-bundle: undo-move-e2e
// Undo move (#456; FR-CBT-179–181), thin: the DM on `late-damage`'s Goblin Ambush, where
// `trail-moves` moved Goblin once (12,6 → 10,6) and Mira twice this turn. Goblin's token menu
// offers "Undo move (10 ft)": the token goes back to 12,6, its trail and its menu item go, the
// Initiative row reads 0 ft. Mira's undo takes only her last move (her trail keeps 2,7 → 4,7).
// Two quick right-clicks on a token are two menus, not a double-click (no stat block).
// Rules, refusals, redaction: bun test (move-undo.test.ts).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { openWindow } from "./support/shell";

/** `map-drag-trail` Konva groups: token id → cells (FR-MAP-67 attrs). */
async function trails(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    type KNode = { id(): string; getAttr(a: string): unknown };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return Object.fromEntries(
      (K?.stages[0]?.find(".map-drag-trail") ?? []).map((n) => [
        n.id(),
        String(n.getAttr("cells") ?? ""),
      ]),
    );
  });
}

test("FR-CBT-181 the DM's token menu undoes the last counted move: token, trail, feet", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const goblin = recordId("battlemap", "token", 1);
  const errors: string[] = [];

  const dm = await rolePage(browser);
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
  await scenes.getByTestId("ui-window-close").click();
  await dm.getByTestId("map-tool-select").click();
  await expect.poll(() => trails(dm)).toMatchObject({ [goblin]: "12,6 10,6" });

  /** The token's node once it has stopped gliding (two equal reads). */
  const settled = async (tokenId: string) => {
    let last = "";
    await expect
      .poll(async () => {
        const n = await tokenNode(dm, tokenId);
        const now = `${n?.x},${n?.y}`;
        const same = now === last;
        last = now;
        return same;
      })
      .toBe(true);
    return (await tokenNode(dm, tokenId)) as { x: number; y: number };
  };
  const menuOn = async (tokenId: string) => {
    await expect(dm.getByTestId("map-token-menu")).toBeHidden();
    const t = await settled(tokenId);
    await dm.mouse.click(t.x, t.y, { button: "right" });
    await expect(dm.getByTestId("map-token-menu")).toBeVisible();
    return t;
  };

  // Goblin: one step back to 12,6 (two cells right), its trail gone, no item left. Two quick
  // right-clicks are two menus, never a double-click (that opens the stat block).
  const before = await menuOn(goblin);
  await dm.mouse.click(before.x, before.y, { button: "right" });
  await expect(dm.getByTestId("map-token-menu")).toBeVisible();
  await expect(dm.getByTestId("ent-statblock")).toHaveCount(0);
  const item = dm.getByTestId("cbt-token-menu-undo-move");
  await expect(item).toHaveText("Undo move (10 ft)");
  await item.click();
  await expect
    .poll(async () => ((await tokenNode(dm, goblin))?.x ?? before.x) - before.x)
    .toBeGreaterThan(50);
  await expect.poll(async () => Object.keys(await trails(dm))).not.toContain(goblin);
  await menuOn(goblin);
  await expect(dm.getByTestId("cbt-token-menu-undo-move")).toHaveCount(0);
  await dm.keyboard.press("Escape");

  const init = await openWindow(dm, "cbt.initiative");
  const goblinRow = init.locator('[data-testid="cbt-init-row"]').filter({
    has: dm.locator('[data-testid="cbt-init-row-name"][data-value="Goblin"]'),
  });
  await expect(goblinRow.getByTestId("cbt-init-row-moved")).toHaveText(/^Moved 0( \/ \d+)? ft$/);
  await init.getByTestId("ui-window-close").click();

  // Mira: only her last move (4,7 → 5,6) goes.
  await menuOn(mira);
  await dm.getByTestId("cbt-token-menu-undo-move").click();
  await expect.poll(() => trails(dm)).toMatchObject({ [mira]: "2,7 4,7" });

  expect(errors).toEqual([]);
});
