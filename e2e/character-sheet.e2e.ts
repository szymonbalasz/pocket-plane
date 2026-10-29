// e2e-bundle: character-sheet
// Thin character-sheet flows (CHAR §13 E2E): player-1 damages Mira from the sheet → the DM's
// sheet shows 9 / 12; on the Actions tab (N4) player-1 rolls Shortsword Attack (to-hit only),
// Damage (Alt+click: at once), then Damage again through the Dice tray (a click stages it,
// #385; no Attack + damage) → lines in dice.log for the DM and player-2.
// Authorize matrix, visibility, leak scan, restart: bun test (character-sheet).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { rollNow } from "./support/rolls";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const entries = (page: Page) => page.getByTestId("dice-log-entry");

test("FR-CHAR-10 FR-CHAR-08 player-1 damages Mira and attacks; DM and player-2 see it live", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const miraId = recordId("char-mira", "entity");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await expect(p1.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => {
    ws.on("framereceived", (f) => p2Frames.push(String(f.payload)));
  });
  await p2.goto(link("Player 2"));
  await expect(p2.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // Player sheet is open by default on Mira; the DM opens Sheets (Mira first by name).
  const sheet1 = await openWindow(p1, "char.sheet");
  await expect(sheet1.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  await expect(sheet1.getByTestId("char-sheet-hp")).toHaveText("12 / 12");
  // FR-CHARX-44: no attack row on Main.
  await expect(sheet1.getByTestId("char-sheet-attack")).toHaveCount(0);
  await expect(sheet1.getByTestId("char-sheet-roll-attack")).toHaveCount(0);
  await expect(sheet1.getByTestId("char-sheet-speed")).toHaveText("30 ft");
  await expect(sheet1.getByTestId("char-sheet-prof")).toHaveText("Prof +2");
  await expect(
    sheet1.locator('[data-testid="char-sheet-roll-save"][data-value="str"]'),
  ).toContainText("+4");
  const dmSheet = await openWindow(dm, "char.sheet");
  await expect(dmSheet.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  await expect(dmSheet.getByTestId("char-sheet-hp")).toHaveText("12 / 12");

  // Damage 3 → 9 / 12 on the DM's sheet.
  await sheet1.getByTestId("char-sheet-hp-input").fill("3");
  await sheet1.getByTestId("char-sheet-hp-damage").click();
  await expect(sheet1.getByTestId("char-sheet-hp")).toHaveText("9 / 12");
  await expect(dmSheet.getByTestId("char-sheet-hp")).toHaveText("9 / 12");

  // Actions tab, Shortsword (FR-CHARX-126): Attack → to-hit only; Damage → damage only (both
  // Alt+click: at once); a click stages the tray, its Roll → the damage line. Each for the DM and
  // player-2.
  await openWindow(dm, "dice.log");
  await openWindow(p2, "dice.log");
  await expect(entries(dm)).toHaveCount(0);
  await sheet1.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const sword = sheet1.getByTestId("charx-attack").filter({ hasText: "Shortsword" });
  await expect(sword).toContainText("Shortsword +4 · 1d6+2 piercing");
  const steps = [
    ["charx-roll-attack", "Shortsword attack", "Shortsword damage"],
    ["charx-roll-damage", "Shortsword damage (piercing)", "Shortsword attack"],
  ] as const;
  for (const [i, [testId, has, hasNot]] of steps.entries()) {
    await rollNow(sword.getByTestId(testId));
    for (const page of [dm, p2]) {
      await expect(entries(page)).toHaveCount(i + 1);
      const line = entries(page).filter({ hasText: has });
      await expect(line).toHaveCount(1);
      await expect(line).toContainText("Mira");
      await expect(line).not.toContainText(hasNot);
    }
  }
  await expect(sword.getByTestId("charx-roll-attack-damage")).toHaveCount(0);
  await sword.getByTestId("charx-roll-damage").click();
  await expect(entries(dm)).toHaveCount(2);
  await p1.getByTestId("dicex-tray-roll").click();
  for (const page of [dm, p2]) {
    await expect(entries(page)).toHaveCount(3);
    await expect(entries(page).filter({ hasText: "Shortsword damage (piercing)" })).toHaveCount(2);
  }
  // Pip: no speed, no scores → "Speed —", "No ability scores", no Check / Save (FR-CHAR-18/19).
  await pickSheet(sheet1, { label: "Pip" });
  await expect(sheet1.getByTestId("char-sheet-speed")).toHaveText("—");
  await expect(sheet1.getByTestId("char-sheet-abilities-empty")).toHaveText("No ability scores");
  await expect(sheet1.getByTestId("char-sheet-roll-save")).toHaveCount(0);

  // player-2 gets Mira's HP figures since ADR-0063 (party status), never her sheet data.
  const p2Text = p2Frames.join("\n");
  expect(p2Text).toMatch(new RegExp(`"id":"${miraId}"[^}]*"hpCurrent":9`));
  expect(p2Text).not.toMatch(new RegExp(`"id":"${miraId}"[^}]*"statBlock"`));

  for (const page of [p2, p1, dm]) await page.context().close();
});
