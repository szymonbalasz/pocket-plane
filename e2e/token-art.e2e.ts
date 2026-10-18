// e2e-bundle: compendium-full
// Token art (ENT §13 S4, thin): on `battlemap` the DM's and player-1's token nodes carry `art`
// (FR-ENT-28): the SRD / fixture Goblins and Elite Goblin Warrior `humanoid`, the dragon
// `dragon`, the Wolf with an image `image`, Plain Brute `initials`, the hidden Ogre `giant` (DM
// only; player-1 never gets it, FR-ENT-30). DM Art ▸ Initials on the SRD Goblin → both see
// `initials`; Art ▸ Creature type → `humanoid` again. Credits (FR-ENT-29): the Compendium list
// footer in both clients and the Creatures footer open the About dialog's "Token art" section.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

/** Token id → its node's `art` attr (and the glyph's `type`, if one is drawn). */
async function arts(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    type KNode = {
      id(): string;
      getAttr(k: string): unknown;
      findOne(s: string): KNode | undefined;
    };
    type KStage = { container(): HTMLElement; find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const stage = K?.stages.find((s) => s.container().isConnected);
    const out: Record<string, string> = {};
    for (const n of stage?.find(".map-token") ?? []) {
      const glyph = n.findOne(".map-token-art");
      out[n.id()] =
        `${String(n.getAttr("art"))}${glyph ? `/${String(glyph.getAttr("creature"))}` : ""}`;
    }
    return out;
  });
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function tokenArtCredits(page: Page) {
  const dialog = page.getByTestId("cmp-about-dialog");
  await expect(dialog).toBeVisible();
  const section = dialog.getByTestId("cmp-about-token-art");
  await expect(section.getByTestId("cmp-about-token-art-row")).toHaveCount(14);
  for (const s of ["Lorc", "Delapouite", "CC BY 3.0", "game-icons.net"]) {
    await expect(section).toContainText(s);
  }
  // The SRD attribution beside it (compendium-full imports the SRD).
  await expect(dialog.getByTestId("cmp-about-source")).toHaveAttribute("data-record-id", "srd-5.1");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("FR-ENT-28 FR-ENT-29 FR-ENT-30 token art per creature type for DM and player-1; Art ▸ Initials / Creature type; Credits in both clients", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const scene = recordId("battlemap", "scene");
  const tok = (i: number) => recordId("ent-art-tokens", "token", i);
  const [srdGoblin, fixtureGoblin, elite, dragon, wolf, brute, ogre] = [0, 1, 2, 3, 4, 5, 6].map(
    tok,
  ) as [string, string, string, string, string, string, string];

  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(`dm: ${m.text()}`);
  });
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${scene}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", scene);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await showToPlayers(dm, "Goblin Ambush");
  await scenes.getByTestId("ui-window-close").click();

  const expected = {
    [srdGoblin]: "humanoid/humanoid",
    [fixtureGoblin]: "humanoid/humanoid",
    [elite]: "humanoid/humanoid",
    [dragon]: "dragon/dragon",
    [wolf]: "image",
    [brute]: "initials",
  };
  await expect
    .poll(async () => {
      const a = await arts(dm);
      return [...Object.keys(expected), ogre].map((id) => a[id]);
    })
    .toEqual([...Object.values(expected), "giant/giant"]);

  // player-1: the six visible tokens with the same art; no Ogre (hidden, FR-ENT-30).
  const p1 = await rolePage(browser);
  p1.on("console", (m) => {
    if (m.type() === "error") errors.push(`player-1: ${m.text()}`);
  });
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await expect(p1.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", scene);
  await expect
    .poll(async () => {
      const a = await arts(p1);
      return [...Object.keys(expected).map((id) => a[id]), ogre in a];
    })
    .toEqual([...Object.values(expected), false]);

  // DM Art ▸ Initials on the SRD Goblin → "initials" for both; checked item follows.
  await dm.getByTestId("map-tool-fit").click();
  const openArt = async () => {
    const t = await tokenNode(dm, srdGoblin);
    if (!t) throw new Error("no SRD Goblin token");
    await dm.mouse.click(t.x, t.y, { button: "right" });
    await dm.getByTestId("ent-token-menu-art").click();
  };
  await openArt();
  await expect(dm.getByTestId("ent-token-menu-art-type")).toHaveAttribute("data-state", "checked");
  await expect(dm.getByTestId("ent-token-menu-art-type")).toHaveAttribute("data-value", "humanoid");
  await dm.getByTestId("ent-token-menu-art-initials").click();
  await expect.poll(async () => (await arts(dm))[srdGoblin]).toBe("initials");
  await expect.poll(async () => (await arts(p1))[srdGoblin]).toBe("initials");
  await openArt();
  await expect(dm.getByTestId("ent-token-menu-art-initials")).toHaveAttribute(
    "data-state",
    "checked",
  );
  await dm.getByTestId("ent-token-menu-art-type").click();
  await expect.poll(async () => (await arts(dm))[srdGoblin]).toBe("humanoid/humanoid");
  await expect.poll(async () => (await arts(p1))[srdGoblin]).toBe("humanoid/humanoid");

  // Credits: Compendium list footer (DM, player-1), Creatures footer (DM).
  const cmp = await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-credits").click();
  await tokenArtCredits(dm);
  await cmp.getByTestId("ui-window-close").click();
  const creatures = await openWindow(dm, "ent.creatures");
  await creatures.getByTestId("ent-list-credits").click();
  await tokenArtCredits(dm);
  const pCmp = await openWindow(p1, "cmp.compendium");
  await pCmp.getByTestId("cmp-credits").click();
  await tokenArtCredits(p1);

  expect(errors).toEqual([]);
});
