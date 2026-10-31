// e2e-bundle: spell-fx
// Teleport (FR-MAP-121, -122), DM + player-1 in their own contexts: right-click Mira → Teleport →
// hovering shows the target → click a cell: the token jumps there on both screens with smoke at
// both ends. Esc drops a pick without moving; players get no token menu.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { mapPoint } from "./support/map";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** A token's id, by its label text. */
async function tokenId(page: Page, name: string): Promise<string | null> {
  const labels = await konvaNodes(page, "map-token-label");
  return labels.find((l) => l.text === name)?.id ?? null;
}

/** A token's top-left in map px (its Konva x, y). */
function mapXY(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((id) => {
    type KNode = { id(): string; x(): number; y(): number };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva: { stages: KStage[] } }).Konva;
    const n = K.stages[0]?.find(".map-token").find((t) => t.id() === id);
    return n ? { x: n.x(), y: n.y() } : null;
  }, id);
}

/** The `lastPoof` attr on the over pass (a poof lasts 0.9 s; this one stays). */
function lastPoof(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    type KNode = { getAttr(a: string): unknown };
    type KStage = { findOne(s: string): KNode | undefined };
    const K = (window as unknown as { Konva: { stages: KStage[] } }).Konva;
    const v = K.stages[0]?.findOne(".vfx-over-pass")?.getAttr("lastPoof");
    return (v as string | undefined) ?? null;
  });
}

test("FR-MAP-121 FR-MAP-122 token menu → Teleport → a cell: the token jumps, smoke on both screens; Esc cancels", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(dm);
  await live(p1);
  await expect.poll(() => tokenId(dm, "Mira")).not.toBeNull();
  const mira = (await tokenId(dm, "Mira")) as string;
  await expect.poll(() => tokenNode(p1, mira)).not.toBeNull();
  const start = await mapXY(dm, mira);

  const openPick = async () => {
    const t = await tokenNode(dm, mira);
    if (!t) throw new Error("Mira not on the DM's map");
    await dm.mouse.click(t.x, t.y, { button: "right" });
    await dm.getByTestId("map-token-menu-teleport").click();
    await expect(dm.getByTestId("map-teleport-panel")).toBeVisible();
  };

  // Esc drops the pick: no move, the Select tool back.
  await openPick();
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("map-teleport-panel")).toHaveCount(0);
  await expect(dm.getByTestId("map-tool-select")).toHaveAttribute("data-state", "on");
  expect(await mapXY(dm, mira)).toEqual(start);
  expect(await lastPoof(dm)).toBeNull();

  // Pick a cell a few squares away, seen through the hover footprint.
  await openPick();
  const target = await mapPoint(dm, 2, 2);
  await dm.mouse.move(target.x, target.y);
  await expect.poll(async () => (await konvaNodes(dm, "map-teleport-target")).length).toBe(1);
  await dm.screenshot({ path: test.info().outputPath("pick-dm.png") });
  await dm.mouse.click(target.x, target.y);
  // Evidence of the look, mid-puff, on both screens (Playwright's output folder, gitignored).
  await dm.waitForTimeout(300);
  await Promise.all([
    dm.screenshot({ path: test.info().outputPath("smoke-dm.png") }),
    p1.screenshot({ path: test.info().outputPath("smoke-player.png") }),
  ]);

  await expect(dm.getByTestId("map-teleport-panel")).toHaveCount(0);
  const landed = { x: 2 * 70, y: 2 * 70 };
  await expect.poll(() => mapXY(dm, mira)).toEqual(landed);
  await expect.poll(() => mapXY(p1, mira)).toEqual(landed);

  // The same cue on both screens.
  await expect.poll(() => lastPoof(dm)).not.toBeNull();
  await expect.poll(() => lastPoof(p1)).toBe(await lastPoof(dm));

  // Players get no token menu, so no Teleport.
  const seen = await tokenNode(p1, mira);
  if (!seen) throw new Error("Mira not on the player's map");
  await p1.mouse.click(seen.x, seen.y, { button: "right" });
  await expect(p1.getByTestId("map-token-menu-teleport")).toHaveCount(0);
});
