// e2e-bundle: character-sheet-full
// Thin character-sheet-full flow (CHARX §13 E2E): player-1 creates "Brin", sets DEX 16 + Stealth
// proficient, rolls Stealth → "+ 5" in the log; the DM approves; player-2 sees Brin's summary
// card only. Permission matrix, leak scan, merge, crash, restart: bun test (character-sheet).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const field = (sheet: Locator, path: string) =>
  sheet.locator(`[data-testid="charx-field"][data-value="${path}"]`);

test("FR-CHARX-08 FR-CHARX-21 FR-CHARX-10 FR-CHARX-32 Brin: create, edit, roll Stealth, approve; player-2 summary", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
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

  // Player 1: New character… → "Brin" → the draft opens in edit mode with the hint.
  const sheet1 = await openWindow(p1, "char.sheet");
  await sheet1.getByTestId("char-sheet-picker").selectOption({ label: "New character…" });
  await p1.getByTestId("charx-create-name").fill("Brin");
  await p1.getByTestId("charx-create-submit").click();
  await expect(sheet1.getByTestId("char-sheet-name")).toHaveText("Brin");
  await expect(sheet1.getByTestId("charx-draft")).toBeVisible();
  await expect(sheet1.getByTestId("char-sheet")).toHaveAttribute("data-editing", "true");
  await expect(sheet1.getByTestId("charx-create-hint")).toBeVisible();
  const brinId = (await sheet1.getByTestId("char-sheet").getAttribute("data-record-id")) as string;

  // DEX 16 (Enter commits) → Stealth +3; Stealth proficient → +5.
  const stealth = sheet1.locator('[data-testid="charx-skill-bonus"][data-value="stealth"]');
  await expect(stealth).toHaveText("+0");
  await field(sheet1, "abilities.dex").fill("16");
  await field(sheet1, "abilities.dex").press("Enter");
  await expect(stealth).toHaveText("+3");
  await field(sheet1, "skills.stealth").click();
  await expect(stealth).toHaveText("+5");
  await sheet1.getByTestId("charx-edit-toggle").click();
  await expect(sheet1.getByTestId("char-sheet")).toHaveAttribute("data-editing", "false");

  // Roll Stealth → one public line "Brin — Stealth check: … + 5 = …" for the DM.
  await openWindow(dm, "dice.log");
  await sheet1.locator('[data-testid="charx-roll-skill"][data-value="stealth"]').click();
  const line = dm.getByTestId("dice-log-entry").filter({ hasText: "Brin" });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(/Stealth check: .*\+ 5 = /);

  // DM approves Brin: the Draft badge goes on both sheets.
  const dmSheet = await openWindow(dm, "char.sheet");
  await dmSheet.getByTestId("char-sheet-picker").selectOption({ label: "Brin (Player 1) · Draft" });
  await dmSheet.getByTestId("charx-approve").click();
  await expect(dmSheet.getByTestId("charx-draft")).toHaveCount(0);
  await expect(sheet1.getByTestId("charx-draft")).toHaveCount(0);

  // Player 2: Brin in the Party group → summary card only, no sheet, no numbers.
  const sheet2 = await openWindow(p2, "char.sheet");
  await sheet2.getByTestId("char-sheet-picker").selectOption({ label: "Brin (Player 1)" });
  const card = sheet2.getByTestId("charx-summary");
  await expect(card).toHaveAttribute("data-record-id", brinId);
  await expect(card.getByTestId("charx-summary-level")).toHaveText("Level 1");
  await expect(card.getByTestId("charx-summary-owner")).toHaveText("Played by Player 1");
  await expect(sheet2.getByTestId("char-sheet")).toHaveCount(0);
  await expect(sheet2.getByTestId("charx-roll-skill")).toHaveCount(0);
  // FR-CHARX-36: no Brin creature-sheet and no stat block ever reached player 2.
  const frames = p2Frames.join("\n");
  expect(frames).not.toMatch(new RegExp(`"type":"creature-sheet","id":"${brinId}"`));
  expect(frames).not.toMatch(new RegExp(`"id":"${brinId}"[^}]*"statBlock"`));

  for (const page of [p2, p1, dm]) await page.context().close();
});
