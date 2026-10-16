// e2e-bundle: effect-modifiers
// Thin effect-modifiers flow (MOD §13 E2E): DM + player-1. Mira (Blessed) attacks from her sheet
// in combat → the to-hit line "… + N Bless = T" for both and the DM's card total T; the DM applies
// Bane to Goblin 2 via the token menu → a chip for player-1. Rules, visibility, callers, crash:
// bun test (effect-modifiers *.test.ts).
import { expect, type Locator, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { openWindow } from "./support/shell";

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().getByTestId("cbt-init-row-name").getByText(name, { exact: true }),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

const BLESS_LINE = /Mira — Shortsword attack: (\d+) \+ 4 \+ (\d) Bless = (\d+)/;

test("FR-MOD-15 FR-MOD-16 FR-MOD-20 FR-MOD-28 sheet attack with Bless → line + card total; Bane via the token menu → chip for player-1", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const goblin2Token = recordId("goblin-2", "token");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // Player-1's sheet → Active effects: concentrating on Bless, Bless with its parts.
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const section = sheet.getByTestId("mod-section");
  await expect(
    section.locator('[data-testid="mod-active"][data-value="concentration"]'),
  ).toHaveCount(1);
  await expect(section.getByTestId("mod-active-parts")).toHaveText([
    "+1d4 attack rolls, saving throws",
  ]);

  // Mira's Shortsword Attack (to-hit only in combat, FR-CHARX-41) → cbt.attack with Bless.
  const init = await openWindow(dm, "cbt.initiative");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Shortsword" })
    .getByTestId("charx-roll-attack")
    .click();
  const lineOf = async (page: typeof dm) => {
    const log = await openWindow(page, "dice.log");
    const entry = log.getByTestId("dice-log-entry").filter({ hasText: "Bless" }).last();
    await expect(entry).toBeVisible();
    return (await entry.textContent()) ?? "";
  };
  const pm = BLESS_LINE.exec(await lineOf(player));
  const dmLine = BLESS_LINE.exec(await lineOf(dm));
  expect(pm).not.toBeNull();
  expect(dmLine?.[0]).toBe(pm?.[0]);
  const [, d20, part, total] = (pm ?? []).map(Number);
  expect(total).toBe((d20 ?? 0) + 4 + (part ?? 0));

  // The DM's card: the to-hit total includes Bless.
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup.getByTestId("cbt-popup-tohit")).toHaveValue(String(total));
  await expect(popup.locator('label[for="cbt-popup-tohit"]')).toContainText(`+ ${part} Bless`);
  await dm.getByTestId("cbt-popup-dismiss").click();

  // DM: view Goblin Ambush; Goblin 2's token → Apply effect ▸ Bane → Apply.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  const pinit = await openWindow(player, "cbt.initiative");
  const goblin2 = await idByName(init, "Goblin 2");
  const chips = pinit
    .locator(`[data-testid="cbt-init-row"][data-record-id="${goblin2}"]`)
    .locator('[data-testid="cbtx-init-row-effect"][data-value="custom"]');
  await expect(chips).toHaveCount(0); // "Cursed" is secret
  await expect.poll(async () => (await tokenNode(dm, goblin2Token)) !== null).toBe(true);
  // P3 E2: the token menu (taller than the room below or above Goblin 2) stays inside the
  // viewport, flipped / clamped and scrolling.
  const size = dm.viewportSize() ?? { width: 1280, height: 800 };
  const g = (await tokenNode(dm, goblin2Token))!;
  await dm.mouse.click(g.x, g.y, { button: "right" });
  const menu = dm.getByTestId("map-token-menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height);
  await menu.getByTestId("mod-token-menu-apply").scrollIntoViewIfNeeded();
  await expect(menu.getByTestId("mod-token-menu-apply")).toBeInViewport();
  await dm.getByTestId("mod-token-menu-apply").click();
  await dm.locator('[data-testid="mod-apply-preset"][data-value="bane"]').click();
  const apply = dm.getByTestId("mod-apply");
  await expect(apply).toBeVisible();
  await apply.getByTestId("mod-apply-submit").click();
  await expect(apply).toHaveCount(0);
  await expect(chips).toHaveCount(1);
  await expect(chips).toContainText("Bane");
});

test("FR-MOD-12 preset dialog fits the viewport", async ({ browser }) => {
  const { link } = e2eEnv();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const player = await ctx.newPage();
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // Sheet → Active effects → Start from ▸ Rage: the tallest form (4 parts + Uses + note).
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  await sheet.getByTestId("mod-preset-from-menu").click();
  await player.locator('[data-testid="mod-preset-from"][data-value="rage"]').click();
  const dialog = player.getByTestId("mod-preset-dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? Infinity)).toBeLessThanOrEqual(720);
  const save = dialog.getByTestId("mod-editor-save");
  await expect(save).toBeInViewport({ ratio: 1 });
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(sheet.getByTestId("mod-preset").filter({ hasText: "Rage" })).toHaveCount(1);
});

test("FR-MOD-49 FR-MOD-50 FR-MOD-28 triggers: player writes one on the sheet; DM writes a monster's (never sent to the player)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const player = await ctx.newPage();
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // Sheet → Active effects: the lazy load settles on the empty block.
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const block = sheet.getByTestId("mod-triggers-block");
  await expect(block.getByTestId("mod-trigger-loading")).toHaveCount(0);
  await expect(block).toContainText("No triggers yet");

  // New: the editor fits 1280×720; a bad name errors inline; the live value is Mira's.
  await block.getByTestId("mod-trigger-new").click();
  const editor = player.getByTestId("mod-trig-editor-dialog");
  await expect(editor).toBeVisible();
  const box = await editor.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? Infinity)).toBeLessThanOrEqual(720);
  await editor.getByTestId("mod-trig-editor-name").fill("Bonus");
  const formula = editor.getByTestId("mod-trig-editor-formula");
  await formula.fill("1d4 + foo");
  await expect(editor.getByTestId("mod-trig-editor-formula-error")).toContainText(
    "Unknown name ‘foo’ at 7",
  );
  await expect(editor.getByTestId("mod-trig-editor-save")).toBeDisabled();
  await formula.fill("1d4 + prof");
  await expect(editor.getByTestId("mod-trig-editor-formula-value")).toHaveAttribute(
    "data-value",
    /^1d4\+\d$/,
  );
  await expect(editor.getByTestId("mod-trig-editor-preview")).toContainText("Once per turn");
  await expect(editor.getByTestId("mod-trig-editor-save")).toBeInViewport({ ratio: 1 });
  await editor.getByTestId("mod-trig-editor-save").click();
  await expect(editor).toHaveCount(0);
  const row = block.getByTestId("mod-trigger");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-state", "on");
  await expect(row.getByTestId("mod-trigger-value")).toHaveAttribute("data-value", /^1d4\+\d$/);
  await row.getByTestId("mod-trigger-enabled").click();
  await expect(row).toHaveAttribute("data-state", "off");

  // DM: Creatures → a monster's Rule triggers… → Start from ▸ Martial Advantage → Save.
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const creatures = await openWindow(dm, "ent.creatures");
  await creatures.getByTestId("mod-creature-triggers").first().click();
  const dialog = dm.getByTestId("mod-triggers-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("mod-trigger-loading")).toHaveCount(0);
  await dialog.getByTestId("mod-trigger-from-menu").click();
  await dm.locator('[data-testid="mod-trigger-from"][data-value="martial-advantage"]').click();
  const dmEditor = dm.getByTestId("mod-trig-editor-dialog");
  await expect(dmEditor.getByTestId("mod-trig-editor-formula-value")).toHaveAttribute(
    "data-value",
    "2d6",
  );
  await dmEditor.getByTestId("mod-trig-editor-save").click();
  await expect(dmEditor).toHaveCount(0);
  await expect(
    dialog.getByTestId("mod-trigger").filter({ hasText: "Martial Advantage" }),
  ).toHaveCount(1);

  // The player's block keeps its one row; the monster trigger never reaches the player.
  await expect(row).toHaveCount(1);
  await expect(player.getByText("Martial Advantage")).toHaveCount(0);
});
