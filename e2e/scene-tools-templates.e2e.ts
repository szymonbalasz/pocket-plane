// e2e-bundle: scene-tools
// Thin AoE template flow (SCN §13 E2E), DM + player-1 in separate contexts: kept templates per
// role (Glyph never reaches the player); the player places a sphere with the AoE tool, the DM
// sees it live with its squares, Keep, reload, it is still there.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

interface TemplateNode {
  id: string;
  ephemeral: boolean;
  hidden: boolean;
  shape: string;
  cells: number;
  text: string | null;
}

/** `scn-template` Konva groups on the map canvas (SCN Appendix A). */
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
      hidden: n.getAttr("hidden") === true,
      shape: String(n.getAttr("shape")),
      cells: Number(n.getAttr("cells")),
      text: n.findOne(".scn-template-label-text")?.text() ?? null,
    }));
  });
}

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

const kept = (list: TemplateNode[]) =>
  list
    .filter((t) => !t.ephemeral)
    .map((t) => t.id)
    .sort();

test("FR-SCN-22 / -23 / -25 player places a sphere, the DM sees it live, Keep, reload (DM + player-1)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const guardians = recordId("scn-templates", "aoe-template", 0);
  const glyph = recordId("scn-templates", "aoe-template", 1);

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await shellWindow(dm, "cbt.initiative").getByTestId("ui-window-close").click();
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await dm.getByTestId("map-show-to-players").click();
  await expect(dm.getByTestId("map-not-shown-badge")).toHaveCount(0);
  await shellWindow(dm, "map.scenes").getByTestId("ui-window-close").click();
  // FR-SCN-27: the DM sees both kept templates, Glyph in hidden styling.
  await expect.poll(async () => kept(await templates(dm))).toEqual([guardians, glyph].sort());
  expect((await templates(dm)).find((t) => t.id === glyph)).toMatchObject({
    hidden: true,
    shape: "cube",
    text: "Glyph · 4 squares",
  });

  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect.poll(async () => kept(await templates(player))).toEqual([guardians]);
  expect((await templates(player))[0]?.text).toMatch(/^Spirit Guardians · \d+ squares$/);

  // FR-SCN-22: AoE tool, sphere; press vertex (10, 4), drag 2 cells east → radius 10 ft.
  await player.getByTestId("map-tool-aoe").click();
  await expect(player.getByTestId("scn-aoe-panel")).toBeVisible();
  await player.getByTestId("scn-aoe-shape-sphere").click();
  await player.getByTestId("scn-aoe-label").fill("Fireball");
  await player.getByTestId("scn-aoe-label").press("Enter");
  const from = await mapToPage(player, 10 * 70, 4 * 70);
  const to = await mapToPage(player, 12 * 70, 4 * 70);
  await player.mouse.move(from.x, from.y);
  await player.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await player.mouse.move(from.x + ((to.x - from.x) * i) / 5, from.y);
  }
  await player.mouse.up();
  // FR-SCN-23: the DM sees the ephemeral live, with its squares (radius 10 ft: 12 squares).
  await expect
    .poll(async () => (await templates(dm)).filter((t) => t.ephemeral).map((t) => t.text))
    .toEqual(["Fireball · 12 squares"]);
  expect((await templates(player)).find((t) => t.id === "eph-own")?.cells).toBe(12);

  // FR-SCN-25: Keep → a kept record for everyone; the ephemeral is gone.
  await player.getByTestId("scn-aoe-keep").click();
  await expect.poll(async () => kept(await templates(dm))).toHaveLength(3);
  await expect.poll(async () => (await templates(dm)).filter((t) => t.ephemeral)).toEqual([]);
  await expect.poll(async () => kept(await templates(player))).toHaveLength(2);
  const fireball = (await templates(dm)).find((t) => t.text === "Fireball · 12 squares");
  expect(fireball?.ephemeral).toBe(false);

  // Reload: the kept Fireball is still there for the player; Glyph never reached them.
  await player.reload();
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect
    .poll(async () => kept(await templates(player)))
    .toEqual([guardians, fireball?.id as string].sort());
  const raw = frames.join("\n");
  for (const s of ["Glyph", glyph])
    expect({ s, leaked: raw.includes(s) }).toEqual({ s, leaked: false });

  await player.context().close();
  await dm.context().close();
});
