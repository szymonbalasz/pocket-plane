// e2e-bundle: reminders-strongholds
// Full text, reachable rows (fix/sheet-full-text walkthrough, defects A and E). A: one word wider
// than the window wraps inside it, in an inventory note, a stronghold facility's effect and a
// reminder's roll label: the scroll area's inner table doesn't grow, so every row stays in reach.
// E: a reminder row with the "Hidden with the stronghold" badge keeps its text wide at 280 px, the
// badge and the menu taking the next line. Classes per row: bun test.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow, shellWindow } from "./support/shell";
import { brokenWords, dmIntent, moveTo, pastTheEdge, resizeTo } from "./support/text-fit";

const WORD =
  "Thisnoteisonegiantunbrokenwordthatisfarlongerthanthewindowcouldeverholdonasinglelineofthepartyboardinventorytabrow";

const tab = (board: Locator, value: string) =>
  board.locator(`[data-testid="party-tab"][data-value="${value}"]`);

const fits = async (win: Locator, where: string) => {
  expect({ where, broken: await brokenWords(win), ...(await pastTheEdge(win)) }).toEqual({
    where,
    broken: [],
    past: [],
    scrolls: [],
  });
};

async function dmPage(browser: Browser): Promise<Page> {
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, e2eEnv().secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  return dm;
}

test("full text: one word wider than the window wraps inside it: inventory notes, stronghold effect, reminder roll label; every row stays in reach", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await dmPage(browser);
  await dmIntent(dm, secret, "party.addItem", { name: "Rope", qty: 1, notes: WORD });
  await dmIntent(dm, secret, "party.addItem", {
    name: "A Very Long Named Bag of Holding Number Two",
    qty: 2,
    notes: "",
  });
  await dmIntent(dm, secret, "hold.saveFacility", {
    strongholdId: recordId("hold-greystone", "stronghold"),
    facility: { name: "Wordy", state: "built", effect: WORD.slice(0, 75) },
  });
  await dmIntent(dm, secret, "rem.save", {
    target: { kind: "party" },
    text: "Long roll label",
    rolls: [{ label: WORD.slice(0, 40), expression: "1d6", category: "other" }],
  });

  // Inventory: the note whole, and Remove on every row inside the window.
  const board = await openWindow(dm, "party.board");
  await tab(board, "inventory").click();
  for (const w of [600, 340]) {
    await resizeTo(dm, board, w);
    await fits(board, `inventory at ${w}`);
    await expect(board.getByTestId("party-item-notes").filter({ hasText: WORD })).toHaveText(WORD);
    const right = await board.evaluate((b) => b.getBoundingClientRect().right);
    for (const remove of await board.getByTestId("party-item-remove").all()) {
      const box = await remove.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(right);
    }
  }
  await board.screenshot({ path: test.info().outputPath("inventory-340.png") });

  // The reminder's roll button keeps its dice in the window.
  await tab(board, "reminders").click();
  await expect(board.getByTestId("rem-tab")).toHaveAttribute("data-state", "ready");
  await fits(board, "reminders at 340");
  await expect(
    board.getByTestId("rem-row-roll").filter({ hasText: WORD.slice(0, 40) }),
  ).toContainText("1d6");
  await board.screenshot({ path: test.info().outputPath("reminders-340.png") });

  // Every other tab of the same window, at its minimum.
  for (const key of ["status", "handouts", "strongholds"]) {
    await tab(board, key).click();
    await fits(board, `${key} at 340`);
  }

  // Stronghold: the effect whole, the row's Income and menu in the window.
  await board
    .getByTestId("hold-row")
    .filter({ hasText: "Greystone Keep" })
    .getByTestId("hold-row-open")
    .click();
  const hold = shellWindow(dm, "hold.stronghold");
  await expect(hold.getByTestId("hold-name")).toHaveText("Greystone Keep");
  await resizeTo(dm, hold, 340);
  await fits(hold, "facilities at 340");
  await expect(
    hold.getByTestId("hold-facility-effect").filter({ hasText: WORD.slice(0, 75) }),
  ).toHaveText(WORD.slice(0, 75));
  await hold.getByTestId("hold-facility-effect").last().scrollIntoViewIfNeeded();
  await hold.screenshot({ path: test.info().outputPath("stronghold-340.png") });
});

test('full text: a reminder row with the "Hidden with the stronghold" badge keeps its text wide at 280 px; the badge and menu take the next line', async ({
  browser,
}) => {
  const { recordId } = e2eEnv();
  const dm = await dmPage(browser);
  const win = await openWindow(dm, "char.sheet");
  await pickSheet(win, recordId("char-mira", "entity"));
  await moveTo(dm, win, 250, 60);
  await win.locator('[data-testid="charx-tab"][data-value="section:rem.reminders"]').click();
  const row = win.getByTestId("rem-row").filter({ hasText: "REM-SECRET-VAULT" });
  await expect(row).toBeVisible();

  await resizeTo(dm, win, 280);
  await fits(win, "reminders at 280");
  const text = await row.getByTestId("rem-row-text").boundingBox();
  const menu = await row.getByTestId("rem-row-menu").boundingBox();
  const box = await row.boundingBox();
  // The whole row's width, not a thin column; the menu is below the text, not beside it.
  expect(text?.width ?? 0).toBeGreaterThan((box?.width ?? 0) * 0.8);
  expect(menu?.y ?? 0).toBeGreaterThanOrEqual((text?.y ?? 0) + (text?.height ?? 0));
  await row.scrollIntoViewIfNeeded();
  await win.screenshot({ path: test.info().outputPath("reminder-280.png") });

  // Room for both: an ordinary row stays on one line, the menu beside its text.
  await resizeTo(dm, win, 680);
  const wideText = await row.getByTestId("rem-row-text").boundingBox();
  const wideMenu = await row.getByTestId("rem-row-menu").boundingBox();
  expect(wideMenu?.y ?? 0).toBeLessThan((wideText?.y ?? 0) + (wideText?.height ?? 0));
});
