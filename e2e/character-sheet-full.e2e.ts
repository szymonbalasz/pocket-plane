// e2e-bundle: character-sheet-full
// Thin character-sheet-full flow (CHARX §13 E2E): player-1 creates "Brin", sets DEX 16 + Stealth
// proficient, darkvision 60 (Senses line), rolls Stealth → "+ 5" in the log; the DM gets the draft card, Review → Approve;
// player-1 gets the approval toast; player-2 sees Brin's summary card only. Permission matrix, leak scan, merge, crash, restart: bun test (character-sheet).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const field = (sheet: Locator, path: string) =>
  sheet.locator(`[data-testid="charx-field"][data-value="${path}"]`);

/** Tab → an element only that tab's panel shows (Mira, CHARX §13 fixtures). */
const TAB_PROBES = [
  ["actions", "charx-attack"],
  ["features", "charx-feature"],
  ["inventory", "charx-wallet"],
  ["notes", "charx-notes"],
  ["main", "charx-skill"],
] as const;

for (const vp of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`FR-CHARX-26 every tab is reachable by mouse, DM and player, ${vp.width}×${vp.height}`, async ({
    browser,
  }) => {
    const { secret, link, recordId } = e2eEnv();
    const miraId = recordId("char-mira", "entity");
    const dm = await rolePage(browser);
    await dm.setViewportSize(vp);
    await loginDm(dm, secret);
    await live(dm);
    const p1 = await rolePage(browser);
    await p1.setViewportSize(vp);
    await p1.goto(link("Player 1"));
    await live(p1);
    for (const page of [p1, dm]) {
      const win = await openWindow(page, "char.sheet");
      await expect(win.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
      // CHAR §7 default geometry (shrunk only where the viewport has no room).
      const box = await win.boundingBox();
      if (vp.height >= 900) expect([box?.width, box?.height]).toEqual([320, 440]);
      const strip = win.getByRole("tablist");
      expect((await strip.boundingBox())?.height ?? 0).toBeGreaterThan(20);
      for (const [tab, probe] of TAB_PROBES) {
        const trigger = win.locator(`[data-testid="charx-tab"][data-value="${tab}"]`);
        // The strip scrolls at 320 px; then a real mouse click at the trigger's centre.
        await trigger.scrollIntoViewIfNeeded();
        const b = await trigger.boundingBox();
        expect(b?.height ?? 0).toBeGreaterThan(0);
        await page.mouse.click(
          (b?.x ?? 0) + (b?.width ?? 0) / 2,
          (b?.y ?? 0) + (b?.height ?? 0) / 2,
        );
        await expect(trigger).toHaveAttribute("aria-selected", "true");
        await expect(win.getByTestId(probe).first()).toBeVisible();
      }
    }
    for (const page of [p1, dm]) await page.context().close();
  });
}

test("FR-CHARX-08 FR-CHARX-21 FR-CHARX-45 FR-CHARX-46 FR-CHARX-10 FR-CHARX-32 FR-CHARX-47 Brin: create, edit, roll Stealth, draft card, approve; player-2 summary; picker memory", async ({
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
  // Sprint 3 (FR-CHARX-50 / -53): Senses line; darkvision 60 (Enter commits); Sees invisible is
  // the DM's (disabled for the owner).
  const senses = sheet1.getByTestId("charx-senses");
  // Sprint 4 (FR-CHARX-50): no stored vision reads "Vision normal" (999 ft).
  await expect(senses).toHaveText("Senses Vision normal");
  await field(sheet1, "senses.darkvisionFt").fill("60");
  await field(sheet1, "senses.darkvisionFt").press("Enter");
  await expect(senses).toHaveText("Senses Vision normal · Darkvision 60 ft");
  await expect(sheet1.getByTestId("charx-senses-invisible")).toBeDisabled();
  await sheet1.getByTestId("charx-edit-toggle").click();
  await expect(sheet1.getByTestId("char-sheet")).toHaveAttribute("data-editing", "false");

  // Roll Stealth → one public line "Brin — Stealth check: … + 5 = …" for the DM.
  await openWindow(dm, "dice.log");
  await sheet1.locator('[data-testid="charx-roll-skill"][data-value="stealth"]').click();
  const line = dm.getByTestId("dice-log-entry").filter({ hasText: "Brin" });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(/Stealth check: .*\+ 5 = /);

  // G8 (FR-CHARX-45): the DM's draft card → Review opens Brin's sheet → Approve; the Draft badge
  // goes on both sheets and the card closes.
  const card = dm.getByTestId("note-toast").filter({
    hasText: "Player 1 made a character: Brin. Awaiting your approval",
  });
  await expect(card).toHaveCount(1);
  await card.getByTestId("note-toast-action").click();
  const dmSheet = shellWindow(dm, "char.sheet");
  await expect(dmSheet.getByTestId("char-sheet")).toHaveAttribute("data-record-id", brinId);
  // P3 glitch 8: the sheet shows the draft → its toast closes; the row stays pending (bell).
  await expect(card).toHaveCount(0);
  await dmSheet.getByTestId("charx-approve").click();
  await expect(dmSheet.getByTestId("charx-draft")).toHaveCount(0);
  await expect(sheet1.getByTestId("charx-draft")).toHaveCount(0);
  await expect(card).toHaveCount(0);
  // FR-CHARX-46: Player 1's info toast; Player 2 gets none.
  await expect(
    p1.getByTestId("note-toast").filter({ hasText: "Brin was approved by the DM: ready to play" }),
  ).toHaveCount(1);
  await expect(p2.getByTestId("note-toast")).toHaveCount(0);

  // Player 2: Brin in the Party group → summary card only, no sheet, no numbers.
  const sheet2 = await openWindow(p2, "char.sheet");
  await sheet2.getByTestId("char-sheet-picker").selectOption({ label: "Brin (Player 1)" });
  const summary = sheet2.getByTestId("charx-summary");
  await expect(summary).toHaveAttribute("data-record-id", brinId);
  await expect(summary.getByTestId("charx-summary-level")).toHaveText("Level 1");
  await expect(summary.getByTestId("charx-summary-owner")).toHaveText("Played by Player 1");
  await expect(sheet2.getByTestId("char-sheet")).toHaveCount(0);
  await expect(sheet2.getByTestId("charx-roll-skill")).toHaveCount(0);
  // FR-CHARX-36: no Brin creature-sheet and no stat block ever reached player 2.
  const frames = p2Frames.join("\n");
  expect(frames).not.toMatch(new RegExp(`"type":"creature-sheet","id":"${brinId}"`));
  expect(frames).not.toMatch(new RegExp(`"id":"${brinId}"[^}]*"statBlock"`));
  // G8: no draft card and no approval card ever reached player 2.
  expect(frames).not.toContain('"kind":"charx-draft"');
  expect(frames).not.toContain('"kind":"charx-approved"');

  // FR-CHARX-47: Player 1 picks Mira (the default would be Brin, first by name); a reload keeps it.
  const miraId = e2eEnv().recordId("char-mira", "entity");
  await sheet1.getByTestId("char-sheet-picker").selectOption({ label: "Mira · Locked" });
  await expect(sheet1.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  await p1.reload();
  await live(p1);
  const again = await openWindow(p1, "char.sheet");
  await expect(again.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);

  for (const page of [p2, p1, dm]) await page.context().close();
});
