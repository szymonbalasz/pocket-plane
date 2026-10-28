// e2e-bundle: rule-triggers
// Thin rule-trigger sheet flow (MOD §13 walkthrough step 1, R6): player-1's Brakka → Active
// effects → Triggers "Divine Fury … = 1d6+2"; player-2's Thorn → "Sneak Attack = 3d6"; neither
// sees the other's or a monster's. DM: Creatures → the Elite's and the Wolf's Rule triggers…;
// Brakka's token menu → Rule triggers…. Visibility and lazy loads: bun test (effect-modifiers).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { pickSheet } from "./support/sheet";
import { openWindow, shellWindow } from "./support/shell";

async function triggersOn(page: Page, characterId?: string) {
  const sheet = await openWindow(page, "char.sheet");
  if (characterId) await pickSheet(sheet, characterId);
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const block = sheet.getByTestId("mod-triggers-block");
  await expect(block.getByTestId("mod-trigger-loading")).toHaveCount(0);
  return block;
}

test("FR-MOD-49 FR-MOD-47 FR-MOD-28 Triggers blocks per player; DM entries for monsters and PCs", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const brakka = await triggersOn(p1, recordId("char-brakka", "entity"));
  const df = brakka.getByTestId("mod-trigger");
  await expect(df).toHaveCount(1);
  await expect(df).toContainText("Divine Fury");
  await expect(df).toHaveAttribute("data-state", "on");
  await expect(df.getByTestId("mod-trigger-value")).toHaveAttribute("data-value", "1d6+2");
  await expect(df).toContainText("while Rage is on");
  await expect(df.getByTestId("mod-trigger-warning")).toHaveCount(0);

  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await expect(p2.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const thorn = await triggersOn(p2);
  const sa = thorn.getByTestId("mod-trigger");
  await expect(sa).toHaveCount(1);
  await expect(sa).toContainText("Sneak Attack");
  await expect(sa.getByTestId("mod-trigger-value")).toHaveAttribute("data-value", "3d6");
  // The other player's trigger never in this player's Triggers block (its public outcome lines
  // may be in the log: rule-triggers-combat shares this server); monster triggers nowhere.
  for (const [page, block, other] of [
    [p1, brakka, "Sneak Attack"],
    [p2, thorn, "Divine Fury"],
  ] as const) {
    await expect(block.getByText(other)).toHaveCount(0);
    for (const s of ["Martial Advantage", "Regeneration"]) {
      await expect(page.getByText(s)).toHaveCount(0);
    }
  }

  // DM: Creatures → the Elite (custom) and the Wolf (imported) definitions' triggers.
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const creatures = await openWindow(dm, "ent.creatures");
  const dialog = dm.getByTestId("mod-triggers-dialog");
  for (const [id, name, value] of [
    [recordId("enemy-custom", "entity"), "Martial Advantage", "2d6"],
    [recordId("enemy-2", "imported-entity"), "Regeneration", "10"],
  ] as const) {
    await creatures
      .locator(`[data-testid="mod-creature-triggers"][data-record-id="${id}"]`)
      .click();
    await expect(dialog).toBeVisible();
    const row = dialog.getByTestId("mod-trigger");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(name);
    await expect(row.getByTestId("mod-trigger-value")).toHaveAttribute("data-value", value);
    await dm.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }

  // DM: Brakka's token → Rule triggers… → her Triggers block.
  await creatures.getByTestId("ui-window-close").click();
  const scenes = await openWindow(dm, "map.scenes");
  const battlemap = recordId("battlemap", "scene");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${battlemap}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", battlemap);
  // Sprint 5: the Game log is wide (FR-DICE-38): close Scenes, park the log (neither refits) so
  // Brakka's token is on open canvas.
  await scenes.getByTestId("ui-window-close").click();
  await shellWindow(dm, "dice.log").getByTestId("ui-window-minimise").click();
  const token = recordId("char-brakka", "token");
  // The canvas may still be fitting the scene under load: right-click again until the menu opens.
  const entry = dm.getByTestId("mod-token-menu-triggers");
  await expect(async () => {
    const t = await tokenNode(dm, token);
    expect(t).not.toBeNull();
    if (!t) return;
    await dm.keyboard.press("Escape");
    await dm.mouse.click(t.x, t.y, { button: "right" });
    await expect(entry).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await entry.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("mod-trigger")).toContainText("Divine Fury");
  await expect(dialog.getByTestId("mod-trigger-edit")).toHaveCount(1);
});
