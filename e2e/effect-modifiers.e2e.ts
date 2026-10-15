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
  const g = (await tokenNode(dm, goblin2Token))!;
  await dm.mouse.click(g.x, g.y, { button: "right" });
  await expect(dm.getByTestId("map-token-menu")).toBeVisible();
  await dm.getByTestId("mod-token-menu-apply").click();
  await dm.locator('[data-testid="mod-apply-preset"][data-value="bane"]').click();
  const apply = dm.getByTestId("mod-apply");
  await expect(apply).toBeVisible();
  await apply.getByTestId("mod-apply-submit").click();
  await expect(apply).toHaveCount(0);
  await expect(chips).toHaveCount(1);
  await expect(chips).toContainText("Bane");
});
