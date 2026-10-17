// e2e-bundle: vision-party
// Thin sight-while-dragging flow (FOG §13 sprint 4, V8: FR-FOG-53 / -54, FR-MAP-39). DM, player-1
// (Mira, torch 30 ft) and player-2 (Thorn) in separate contexts: the DM shows Goblin Ambush and
// opens d1; player-1 drags Mira toward the door and holds → `fog-vision` `preview` = Mira's id and
// the previewed sight reaches through d1 before the drop, with no Goblin yet; the drop brings the
// Goblin and ends the preview. The DM drags Thorn (an owned token) and holds → player-2's view
// follows (`fog.sight`), player-1's doesn't.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { gridPoint } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

/** Konva attr of the first node named `name` (null when absent). */
async function attrOf(page: Page, name: string, attr: string) {
  return page.evaluate(
    ([name, attr]) => {
      type KNode = { getAttr(a: string): unknown };
      type KStage = { findOne(s: string): KNode | undefined };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      return (K?.stages[0]?.findOne(`.${name}`)?.getAttr(attr) as unknown) ?? null;
    },
    [name, attr] as const,
  );
}

const maxX = (polys: number[][] | null) =>
  Math.max(...(polys ?? []).flatMap((p) => p.filter((_, i) => i % 2 === 0)));

/** The id of the token whose top-left is cell (col, row) (Goblin Ambush: 70 px cells). */
async function tokenAt(page: Page, col: number, row: number) {
  return page.evaluate(
    ([col, row]) => {
      type KNode = { id(): string; x(): number; y(): number };
      type KStage = { find(s: string): KNode[] };
      const K = (window as unknown as { Konva: { stages: KStage[] } }).Konva;
      const n = K.stages[0]
        ?.find(".map-token")
        .find((t) => t.x() === col * 70 && t.y() === row * 70);
      return n?.id() ?? null;
    },
    [col, row] as const,
  );
}

/** Presses on the token and moves to cell (col, row) in small steps; leaves the button down. */
async function dragHold(page: Page, tokenId: string, col: number, row: number) {
  const t = (await tokenNode(page, tokenId)) as { x: number; y: number };
  const to = await gridPoint(page, col + 0.5, row + 0.5);
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(t.x + ((to.x - t.x) * i) / 10, t.y + ((to.y - t.y) * i) / 10);
    await page.waitForTimeout(30);
  }
}

test("FR-FOG-53 / -54 / FR-MAP-39 sight while dragging: player-1's preview through d1 before the drop, Goblin on the drop; the DM's drag of Thorn previews for player-2 only", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const mira = recordId("battlemap", "token", 0);
  const goblin = recordId("battlemap", "token", 1);

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
  await scenes.getByTestId("ui-window-close").click();

  const p1 = await rolePage(browser);
  const p2 = await rolePage(browser);
  for (const [page, name] of [
    [p1, "Player 1"],
    [p2, "Player 2"],
  ] as const) {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
    });
    await page.goto(link(name));
    await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
    await expect.poll(() => tokenNode(page, mira)).not.toBeNull();
    await expect.poll(() => attrOf(page, "fog-vision", "player")).not.toBeNull();
  }
  expect(await tokenNode(p1, goblin)).toBeNull();

  // d1 open; player-1 drags Mira to (7, 5) and holds: the preview sees through the doorway.
  const d1 = (await konvaNodes(dm, "scn-door", "door-4"))[0] as { x: number; y: number };
  await dm.mouse.dblclick(d1.x, d1.y);
  await expect.poll(() => attrOf(p1, "fog-vision", "preview")).toBeNull();
  await dragHold(p1, mira, 7, 5);
  await expect.poll(() => attrOf(p1, "fog-vision", "preview")).toBe(mira);
  await expect
    .poll(async () => maxX((await attrOf(p1, "fog-vision", "see")) as number[][] | null))
    .toBeGreaterThan(8);
  // Records don't change mid-drag (FR-FOG-54): no Goblin before the drop; a rest keeps the preview.
  await p1.waitForTimeout(1500);
  expect(await tokenNode(p1, goblin)).toBeNull();
  expect(await attrOf(p1, "fog-vision", "preview")).toBe(mira);
  expect(await attrOf(p2, "fog-vision", "preview")).toBeNull(); // party off: nothing for player-2
  await p1.mouse.up();
  await expect.poll(() => tokenNode(p1, goblin)).not.toBeNull();
  await expect.poll(() => attrOf(p1, "fog-vision", "preview")).toBeNull();
  expect(maxX((await attrOf(p1, "fog-vision", "see")) as number[][])).toBeGreaterThan(8);

  // The DM drags Thorn (player-2's, at (2, 9)) and holds: player-2's view follows, player-1's doesn't.
  const thorn = (await tokenAt(dm, 2, 9)) as string;
  expect(thorn).not.toBeNull();
  await dragHold(dm, thorn, 4, 10);
  await expect.poll(() => attrOf(p2, "fog-vision", "preview")).toBe(thorn);
  expect(await attrOf(p1, "fog-vision", "preview")).toBeNull();
  await dm.mouse.up();
  await expect.poll(() => attrOf(p2, "fog-vision", "preview")).toBeNull();
  expect(errors).toEqual([]);
});
