// e2e-bundle: character-sheet
// Thin character-sheet flows (CHAR §13 E2E): player-1 damages Mira from the sheet → the DM's
// sheet shows 9 / 12; player-1 attacks → one line (to-hit + damage) in dice.log for the DM and
// player-2. Authorize matrix, visibility, leak scan, restart: bun test (character-sheet).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
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
  await expect(sheet1.getByTestId("char-sheet-attack")).toHaveText(
    "Shortsword +4 \u00b7 1d6+2 piercing",
  );
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

  // Attack → one line with both rolls, for the DM and player-2.
  await openWindow(dm, "dice.log");
  await openWindow(p2, "dice.log");
  await expect(entries(dm)).toHaveCount(0);
  await sheet1.getByTestId("char-sheet-roll-attack").click();
  for (const page of [dm, p2]) {
    await expect(entries(page)).toHaveCount(1);
    await expect(entries(page).first()).toContainText("Mira");
    await expect(entries(page).first()).toContainText("Shortsword attack");
    await expect(entries(page).first()).toContainText("Shortsword damage (piercing)");
  }
  // Pip: no speed, no scores → "Speed —", "No ability scores", no Check / Save (FR-CHAR-18/19).
  await sheet1.getByTestId("char-sheet-picker").selectOption({ label: "Pip" });
  await expect(sheet1.getByTestId("char-sheet-speed")).toHaveText("—");
  await expect(sheet1.getByTestId("char-sheet-abilities-empty")).toHaveText("No ability scores");
  await expect(sheet1.getByTestId("char-sheet-roll-save")).toHaveCount(0);

  // player-2 never received Mira's HP (sheet data, FR-CHAR-14).
  expect(p2Frames.join("\n")).not.toMatch(new RegExp(`"id":"${miraId}"[^}]*"hpCurrent"`));

  for (const page of [p2, p1, dm]) await page.context().close();
});
