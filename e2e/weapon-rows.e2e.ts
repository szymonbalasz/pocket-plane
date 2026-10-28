// e2e-bundle: character-sheet-full
// Thin magic weapon row flow (S4-1a, CHARX FR-CHARX-54–57): player-1 gives Pip a "Flame Tongue
// greatsword" in edit mode (Magic +1, an extra part: "7d6" and no type are refused inline, then
// 2d6 fire); the view reads "+8 · 2d6+5 slashing + 2d6 fire" with a "+1" Badge; Damage → one
// line with both parts for player-1 and the DM; player-2's frames never carry the row. Specs,
// manual counts, mods, leak scan, creature form: bun test (character-sheet, combat-tracker).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const field = (scope: Locator, path: string) =>
  scope.locator(`[data-testid="charx-field"][data-value="${path}"]`);

test("FR-CHARX-56 FR-CHARX-55 FR-CHARX-57 Flame Tongue on Pip: edit, view, damage line with both parts; player-2 never gets the row", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => {
    ws.on("framereceived", (f) => p2Frames.push(String(f.payload)));
  });
  await p2.goto(link("Player 2"));
  await live(p2);

  // Player 1: Pip (no attacks) → Actions → Edit → add an attack row.
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, recordId("char-pip", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet.getByTestId("charx-edit-toggle").click();
  await sheet.locator('[data-testid="charx-row-add"][data-value="attacks"]').click();
  const row = sheet.getByTestId("charx-attack");
  await expect(row).toHaveCount(1);
  const id = (await row.getAttribute("data-record-id")) as string;
  const commit = async (path: string, value: string) => {
    await field(row, path).fill(value);
    await field(row, path).press("Enter");
    await expect(field(row, path)).toBeEnabled();
  };
  await commit(`attacks.${id}.name`, "Flame Tongue greatsword");
  await commit(`attacks.${id}.toHit`, "7");
  await commit(`attacks.${id}.damage`, "2d6+4");
  await field(row, `attacks.${id}.damageType`).selectOption("slashing");
  const magic = row.getByTestId("charx-attack-bonus");
  await expect(magic).toBeEnabled();
  await magic.selectOption("1");
  await expect(magic).toHaveAttribute("data-value", "1");

  // Add damage type: "7d6" and a missing type are refused inline; 2d6 fire commits.
  await row.getByTestId("charx-attack-extra-add").click();
  const dice = field(row, `attacks.${id}.extraDamage.0.damage`);
  await dice.fill("7d6");
  await dice.press("Enter");
  const error = row.getByTestId("charx-attack-extra-error");
  await expect(error).toHaveText("Use NdM+K: up to 6d12+10");
  await dice.fill("2d6");
  await dice.press("Enter");
  await expect(error).toHaveText("Pick a damage type");
  await row.locator('[data-testid="charx-attack-extra-type"][data-value="0"]').selectOption("fire");
  await expect(row.locator('[data-testid="charx-attack-extra"]')).toHaveCount(1);
  await expect(error).toHaveCount(0);
  await expect(row.getByTestId("charx-attack-extra-add")).toBeEnabled();
  await sheet.getByTestId("charx-edit-toggle").click();

  // View: "+8 · 2d6+5 slashing + 2d6 fire" with a "+1" Badge (bonus folded in).
  await expect(row.getByTestId("charx-attack-numbers")).toHaveText(
    "+8 · 2d6+5 slashing + 2d6 fire",
  );
  await expect(row.getByTestId("charx-attack-bonus")).toHaveText("+1");

  // Damage → one public line with both parts, typed, one total.
  const dmLog = await openWindow(dm, "dice.log");
  const p1Log = await openWindow(p1, "dice.log");
  await row.getByTestId("charx-roll-damage").click();
  for (const log of [dmLog, p1Log]) {
    const line = log.getByTestId("dice-log-entry").filter({ hasText: "Flame Tongue" });
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(
      /Pip — Flame Tongue greatsword damage: 2d6\+5 \(\d+ \+ \d+\) slashing \+ 2d6 \(\d+ \+ \d+\) fire = \d+/,
    );
  }

  // Player 2: Pip is another player's character: no weapon row ever reached them.
  await expect(p2.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const frames = p2Frames.join("\n");
  expect(frames).not.toContain("extraDamage");
  expect(frames).not.toMatch(
    new RegExp(`"id":"${recordId("char-pip", "entity")}"[^}]*"statBlock"`),
  );

  for (const page of [p2, p1, dm]) await page.context().close();
});
