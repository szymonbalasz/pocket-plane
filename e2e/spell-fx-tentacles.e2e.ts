// e2e-bundle: spell-fx
// Spell FX template anchor (FR-VFX-40–43, #456): player-2 presses Cast on Thorn's Evard's Black
// Tentacles → the AoE tool asks for one placement (Placing…); a press on a grid corner and a drag
// cast it → a `vfx-aura` (preset black-tentacles, on its kept template) on the DM's and both
// players' maps, and player-2's tool goes back; End → no aura and no template anywhere. DM,
// player-1, player-2 in their own contexts. Canvas nodes per AGENTS §9.5.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { gridPoint, mapPoint } from "./support/map";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Attrs (+ `id`) of every Konva node named `name` on the page's stages. */
function nodes(page: Page, name: string): Promise<Record<string, unknown>[]> {
  return page.evaluate((name) => {
    type KNode = { attrs: Record<string, unknown> };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages ?? []).flatMap((s) =>
      s.find(`.${name}`).map((n) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(n.attrs)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
        }
        return out;
      }),
    );
  }, name);
}

const tentacles = async (page: Page) =>
  (await nodes(page, "vfx-aura"))
    .filter((a) => a.preset === "black-tentacles")
    .map((a) => (a.templateId as string | undefined) ?? "");

test("FR-VFX-40 FR-VFX-41 FR-VFX-42 FR-VFX-43 Cast Black Tentacles → point on the map → tentacles on all three; End → gone with the template", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  const pages = [dm, p1, p2];
  for (const p of pages) await live(p);
  for (const p of pages) await expect.poll(() => nodes(p, "map-token")).not.toHaveLength(0);
  for (const p of pages) expect(await tentacles(p)).toEqual([]);

  // FR-VFX-41: Cast asks for a placement.
  const sheet = await openWindow(p2, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const cast = sheet.getByTestId("vfx-cast").last();
  await expect(cast).toHaveAttribute("data-state", "cast");
  await cast.click();
  await expect(cast).toHaveAttribute("data-state", "placing");
  await expect(p2.getByTestId("scn-aoe-request")).toHaveText("Place Evard's Black Tentacles");
  await shellWindow(p2, "char.sheet").getByTestId("ui-window-close").click();

  // Press a grid corner, drag toward +x +y, release: the cast.
  await mapPoint(p2, 10, 4, { margin: 3 });
  const from = await gridPoint(p2, 10, 4);
  const to = await gridPoint(p2, 12, 6);
  await p2.mouse.move(from.x, from.y);
  await p2.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await p2.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
  }
  await p2.mouse.up();

  // FR-VFX-42: on every map, on one kept template; player-2's tool goes back.
  for (const p of pages) await expect.poll(() => tentacles(p)).toHaveLength(1);
  const [templateId] = await tentacles(p2);
  expect(templateId).toBeTruthy();
  for (const p of pages) expect(await tentacles(p)).toEqual([templateId]);
  await expect(p2.getByTestId("scn-aoe-panel")).toHaveCount(0);
  const kept = (await nodes(dm, "scn-template")).filter((t) => t.id === templateId);
  expect(kept).toHaveLength(1);

  // FR-VFX-43: End → the aura and its template go everywhere.
  const sheet2 = await openWindow(p2, "char.sheet");
  await sheet2.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const end = sheet2.getByTestId("vfx-cast").last();
  await expect(end).toHaveAttribute("data-state", "end");
  await end.click();
  for (const p of pages) {
    await expect.poll(() => tentacles(p)).toEqual([]);
    await expect
      .poll(async () => (await nodes(p, "scn-template")).filter((t) => t.id === templateId))
      .toHaveLength(0);
  }
});
