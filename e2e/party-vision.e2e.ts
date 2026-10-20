// e2e-bundle: vision-party
// Thin party vision flow (FOG §13 sprint 4, V10: FR-FOG-21, -43, -48–51; walkthrough steps 21–25,
// 28). DM, player-1 (Mira, torch 30 ft) and player-2 (Thorn, darkvision 60 ft only) in separate
// contexts on Goblin Ambush:
// 1. party off: player-2's darkvision ring is grey (the red map art at (4.5, 6.5) has no hue,
//    read from the composited stage with `canvasPixel`), the DM's plain map keeps it red;
// 2. the fog bar's Party vision Switch → each player draws the other's `vision` (`shared`), a
//    player-1 drag previews for player-2 too; a reload keeps it (step 28); View as → Party vision
//    draws both players' rows; off again → own sight only;
// 3. in combat (the only UI that sets a PC condition): Blinded on Mira → player-1's chip "Blinded —
//    you can't see"; a secret Blinded → "You can't see", and with party vision on player-1 sees the
//    party's sight (no chip). Every state is put back (the next spec on this bundle,
//    `vision-drag`, starts from the bundle's state).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { gridPoint } from "./support/map";
import { canvasPixel, saturation } from "./support/pixels";
import { showToPlayers } from "./support/scenes";
import { launcherButton, openWindow } from "./support/shell";

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

/** Saturation of the composited pixel at grid point (gx, gy). */
async function satAt(page: Page, gx: number, gy: number) {
  const p = await gridPoint(page, gx, gy);
  return saturation(await canvasPixel(page, p.x, p.y));
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
}

const shared = async (page: Page) =>
  ((await attrOf(page, "fog-vision", "shared")) ?? []) as string[];

async function setup(browser: Parameters<typeof rolePage>[0]) {
  const env = e2eEnv();
  const ambush = env.recordId("battlemap", "scene");
  const dm = await rolePage(browser);
  const errors: string[] = [];
  dm.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await loginDm(dm, env.secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await live(dm);
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
    await page.goto(env.link(name));
    await live(page);
    await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
    await expect.poll(() => attrOf(page, "fog-vision", "player")).not.toBeNull();
  }
  return { ...env, dm, p1, p2, errors };
}

/** The fog bar's Party vision Switch to `on` (the Fog tool picked first). */
async function partyVision(dm: Page, on: boolean) {
  await dm.getByTestId("map-tool-fog").click();
  const sw = dm.getByTestId("fog-party-vision");
  await expect(sw).toBeVisible();
  if ((await sw.getAttribute("data-state")) !== (on ? "checked" : "unchecked")) await sw.click();
  await expect(sw).toHaveAttribute("data-state", on ? "checked" : "unchecked");
}

async function pickViewAs(dm: Page, value: string) {
  await dm.getByTestId("fog-view-as").click();
  await dm.locator(`[data-testid="fog-view-as-option"][data-value="${value}"]`).click();
  await expect(dm.getByTestId("fog-view-as")).toHaveAttribute("data-value", value);
}

test("FR-FOG-21 / -43 / -49–51 party vision: grey darkvision ring; the Switch shares each player's sight and drag previews; a reload keeps it; View as Party draws both; off → own only", async ({
  browser,
}) => {
  const { dm, p1, p2, recordId, errors } = await setup(browser);
  const mira = recordId("battlemap", "token", 0);
  const pid1 = recordId("player-1", "player");
  const pid2 = recordId("player-2", "player");

  // Step 25 (party off): Thorn sees only by darkvision, so (4.5, 6.5) lies in player-2's ring:
  // the red map art there turns grey; the DM's plain map (Select tool) keeps the red.
  await expect.poll(() => attrOf(p2, "fog-darkvision-grey", "on")).toBe(true);
  await expect.poll(() => satAt(p2, 4.5, 6.5)).toBeLessThanOrEqual(0.05);
  await dm.getByTestId("map-tool-select").click();
  await expect.poll(() => satAt(dm, 4.5, 6.5)).toBeGreaterThan(0.5);
  expect(await shared(p1)).toEqual([]);
  expect(await shared(p2)).toEqual([]);

  // Step 21: Party vision on → each player draws the other's record (Mira's polygon reaches P2).
  await partyVision(dm, true);
  await expect.poll(() => shared(p1)).toEqual([pid2]);
  await expect.poll(() => shared(p2)).toEqual([pid1]);
  expect((await attrOf(p2, "fog-vision", "src")) as string[]).toContain(mira);
  await expect(dm.getByTestId("fog-party-vision")).toHaveAttribute("data-state", "checked");

  // A party member's drag previews for the other player too (FR-FOG-54 through the union).
  await dragHold(p1, mira, 4, 7);
  await expect.poll(() => attrOf(p2, "fog-vision", "preview")).toBe(mira);
  await p1.keyboard.press("Escape");
  await p1.mouse.up();
  await expect.poll(() => attrOf(p2, "fog-vision", "preview")).toBeNull();
  await expect.poll(() => attrOf(p1, "fog-vision", "preview")).toBeNull();

  // Step 28: a fresh snapshot carries the other player's record while party vision is on.
  await p2.reload();
  await live(p2);
  await expect.poll(() => shared(p2)).toEqual([pid1]);

  // Step 24: View as → Party vision (one load) draws both players' rows; → Player 1: P1's view
  // (the party's records, party vision being on); → DM.
  await pickViewAs(dm, "party");
  await expect.poll(() => attrOf(dm, "fog-view-as", "player")).toBe("party");
  await expect(dm.getByTestId("fog-view-as")).not.toHaveAttribute("data-loading", /.*/);
  await expect.poll(async () => [...(await shared(dm))].sort()).toEqual([pid1, pid2].sort());
  await pickViewAs(dm, pid1);
  await expect.poll(() => attrOf(dm, "fog-view-as", "player")).toBe(pid1);
  await expect.poll(() => shared(dm)).toEqual([pid2]);
  await pickViewAs(dm, "dm");
  await expect.poll(() => attrOf(dm, "fog-view-as", "player")).toBeNull();

  // Off again: own sight only, on both players.
  await partyVision(dm, false);
  await expect.poll(() => shared(p1)).toEqual([]);
  await expect.poll(() => shared(p2)).toEqual([]);
  await dm.getByTestId("map-tool-select").click();
  expect(errors).toEqual([]);
});

const initRow = (init: Locator, name: string) =>
  init.locator('[data-testid="cbt-init-row"]').filter({
    has: init.page().getByTestId("cbt-init-row-name").getByText(name, { exact: true }),
  });

test("FR-FOG-48 / -21 Blinded chip: Blinded → 'Blinded — you can't see'; secret → 'You can't see'; party vision on → the party's sight, no chip", async ({
  browser,
}) => {
  const { dm, p1, p2, recordId, errors } = await setup(browser);
  const chip = p1.getByTestId("fog-blind");

  // Start "Ambush at the Ford": the Initiative rows carry the condition menus.
  const enc = await openWindow(dm, "cbt.encounters");
  await enc
    .locator(
      `[data-testid="cbt-enc-row"][data-record-id="${recordId("encounter-1", "encounter")}"]`,
    )
    .click();
  await enc.getByTestId("cbt-enc-start").click();
  await dm.getByTestId("cbt-enc-start-confirm").click();
  await expect(launcherButton(dm, "cbt.encounters")).toHaveAttribute("data-state", "minimised");
  const init = await openWindow(dm, "cbt.initiative");
  const mira = initRow(init, "Mira");
  await expect(mira).toHaveCount(1);
  const toggleBlinded = async () => {
    await mira.getByTestId("cbt-init-row-menu").click();
    await dm.getByTestId("cbtx-init-row-conditions").hover();
    await dm
      .locator('[data-testid="cbtx-init-row-conditions-option"][data-value="blinded"]')
      .click();
    await dm.keyboard.press("Escape");
  };

  // Step 23: Blinded (party off) → the dark screen with the Blinded chip; player-2 unaffected.
  await expect(chip).toHaveCount(0);
  await toggleBlinded();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-reason", "blinded");
  await expect(chip).toHaveText("Blinded — you can't see");
  await expect(p2.getByTestId("fog-blind")).toHaveCount(0);
  await toggleBlinded();
  await expect(chip).toHaveCount(0);

  // A secret Blinded (Effect…, Hidden from players): the generic chip, no condition name.
  await mira.getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbtx-init-row-effect-new").click();
  await dm.getByTestId("cbtx-effect-condition").click();
  await dm.locator('[data-testid="cbtx-effect-condition-option"][data-value="blinded"]').click();
  await dm.getByTestId("cbtx-effect-secret").click();
  await dm.getByTestId("cbtx-effect-save").click();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("data-reason", "unknown");
  await expect(chip).toHaveText("You can't see");
  await expect(p1.getByText("Blinded")).toHaveCount(0);
  await expect(p2.getByText("Blinded")).toHaveCount(0);

  // Party vision on: player-1 sees the party's sight (Thorn's), no chip; player-2 draws player-1's
  // record as a non-source (no polygon). (Initiative minimised: it sits over the fog bar.)
  await init.getByTestId("ui-window-minimise").click();
  await partyVision(dm, true);
  await expect(chip).toHaveCount(0);
  await expect.poll(() => shared(p2)).toEqual([recordId("player-1", "player")]);
  expect((await attrOf(p2, "fog-vision", "src")) as string[]).not.toContain(
    recordId("battlemap", "token", 0),
  );
  await partyVision(dm, false);
  await expect(chip).toBeVisible();

  // Put everything back: end the effect and the encounter.
  await dm.getByTestId("map-tool-select").click();
  await openWindow(dm, "cbt.initiative");
  // The chip, or (a narrower Initiative: placement stops it 12 px before a PC, FR-SHELL-57) its
  // "+N" fold (FR-CBTX-33): the folded effect's submenu holds the same End.
  const blindedChip = mira.locator('[data-testid="cbtx-init-row-effect"][data-value="blinded"]');
  if (await blindedChip.isVisible()) {
    await blindedChip.click();
  } else {
    const effectId = await blindedChip.getAttribute("data-record-id");
    await mira.getByTestId("cbtx-init-row-effect-more").click();
    await dm
      .locator(`[data-testid="cbtx-init-row-effect-more-item"][data-record-id="${effectId}"]`)
      .click();
  }
  await dm.getByTestId("cbtx-init-row-effect-end").click();
  await expect(chip).toHaveCount(0);
  const enc2 = await openWindow(dm, "cbt.encounters");
  await enc2.getByTestId("cbt-enc-end").click();
  await dm.getByTestId("cbt-enc-end-confirm").click();
  await expect(init.getByTestId("cbt-init-row")).toHaveCount(0);
  expect(errors).toEqual([]);
});
