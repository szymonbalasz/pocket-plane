// e2e-bundle: combat
// Thin combat flow (CBT §13 E2E): DM + player-1. Encounter card, Start on Goblin Ambush, roll
// monsters, Mira's sheet initiative + Attack (routed to cbt.*), round 1, DM targets Goblin in the
// popup, applies half → player sees the band; Undo. Visibility matrix, hooks, crash-resume:
// bun test (combat-tracker sync.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const row = (scope: Page | Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

test("FR-CBT-07 FR-CBT-19 FR-CBT-20 FR-CBT-25 FR-CBT-30 start, sheet rolls, apply half, band, undo", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const encounterId = recordId("encounter-1", "encounter");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // DM views Goblin Ambush and shows it to players.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await dm.getByTestId("map-show-to-players").click();

  // Step 1: the encounter card.
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${encounterId}"]`).click();
  await expect(enc.getByTestId("cbt-enc-rating")).toHaveText("Deadly");
  await expect(enc.getByTestId("cbt-enc-xp-base")).toHaveText("250");
  await expect(enc.getByTestId("cbt-enc-xp-adjusted")).toHaveText("625");
  await expect(enc.getByTestId("cbt-enc-total-cr")).toHaveText("1.25");
  await expect(
    player.locator('[data-testid="ui-launcher-button"][data-record-id="cbt.initiative"]'),
  ).toHaveCount(0);

  // Step 3: Start → preview all bound → confirm.
  await enc.getByTestId("cbt-enc-start").click();
  await expect(dm.getByTestId("cbt-enc-binding")).toHaveCount(6);
  await expect(dm.locator('[data-testid="cbt-enc-binding"][data-bound="false"]')).toHaveCount(0);
  await dm.getByTestId("cbt-enc-start-confirm").click();
  await expect(enc.getByTestId("cbt-enc-status")).toHaveText("started");
  await shellWindow(dm, "cbt.encounters").getByTestId("ui-window-close").click();

  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.getByTestId("cbt-init-row")).toHaveCount(6);
  await expect(init.locator('[data-testid="cbt-init-row"][data-hidden="true"]')).toHaveCount(2);
  const pinit = await openWindow(player, "cbt.initiative");
  await expect(pinit.getByTestId("cbt-init-row")).toHaveCount(4);

  // Step 4: Roll monsters; Mira rolls from her sheet (routed to cbt.rollInitiative); DM sets
  // Thorn; Start round 1.
  await init.getByTestId("cbt-init-roll-monsters").click();
  await expect(init.getByTestId("cbt-init-roll-monsters")).toBeDisabled();
  const mira = await idByName(init, "Mira");
  const sheet = await openWindow(player, "char.sheet");
  await expect(sheet.getByTestId("char-sheet-combat")).toBeVisible();
  await expect(pinit.getByTestId("cbt-init-hint")).toBeVisible();
  await sheet.getByTestId("char-sheet-roll-init").click();
  await expect(row(pinit, mira).getByTestId("cbt-init-row-init")).not.toHaveText("—");
  await expect(pinit.getByTestId("cbt-init-hint")).toHaveCount(0);
  const thorn = await idByName(init, "Thorn");
  const thornInput = init.locator(`[data-testid="cbt-init-row-init"][data-record-id="${thorn}"]`);
  await thornInput.fill("10");
  await thornInput.press("Enter");
  await expect(row(pinit, thorn).getByTestId("cbt-init-row-init")).toHaveText("10");
  await init.getByTestId("cbt-init-next").click();
  await expect(init.getByTestId("cbt-init-round")).toHaveAttribute("data-value", "1");
  await expect(pinit.getByTestId("cbt-init-round")).toHaveAttribute("data-value", "1");

  // Step 5–6: Mira attacks from the sheet → card pending for the DM; target Goblin, hit,
  // 8 damage, Half → 7 → 3 (bloodied for the player, no HP numbers).
  await sheet.getByTestId("char-sheet-roll-attack").click();
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await card.click();
  const goblin = await idByName(init, "Goblin");
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await popup.getByTestId("cbt-popup-target").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  await expect(popup.getByTestId("cbt-popup-vs")).toContainText("vs AC 15");
  await popup.locator('[data-testid="cbt-popup-hit-option"][data-value="hit"]').click();
  await popup.getByTestId("cbt-popup-damage").fill("8");
  await popup.locator('[data-testid="cbt-popup-mult-option"][data-value="half"]').click();
  await expect(popup.getByTestId("cbt-popup-preview")).toHaveText("Goblin 7 → 3");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(row(pinit, goblin).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "bloodied",
  );
  await expect(row(init, goblin).getByTestId("cbt-init-row-hp")).toHaveText("HP 3/7");

  // Undo → band back; the card is pending again.
  await init.getByTestId("cbt-init-undo").click();
  await expect(row(pinit, goblin).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "healthy",
  );
  await expect(init.getByTestId("cbt-init-card")).toHaveCount(1);

  const raw = frames.join("\n");
  for (const s of ["Elite Goblin Warrior", "Ambush at the Ford", '"position"', "hp-change"]) {
    expect({ s, leaked: raw.includes(s) }).toEqual({ s, leaked: false });
  }
  await player.context().close();
  await dm.context().close();
});

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().getByTestId("cbt-init-row-name").getByText(name, { exact: true }),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}
