// e2e-bundle: rem-ui-e2e
// Thin Reminders flow (REM §13 E2E, FR-REM-17–21, -26; FR-PARTY-71): the DM adds a party reminder
// with a roll in the Party Manager's Reminders tab → player-1 sees it at once; player-1 clicks the
// roll → the DM's Game log shows it rolled by Player 1 ("Me", no character); player-2's tab has no
// Mira group. Groups, rights, roll-as and the effects line in detail: bun test (reminders).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (p: Page) =>
  expect(p.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** A handout presented to a player (a modal) is closed if it shows. */
async function closePresented(page: Page) {
  const popup = page.getByTestId("party-present-popup");
  const shown = await popup
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  await page.getByTestId("party-present-close").click();
  await expect(popup).toHaveCount(0);
}

async function remindersTab(page: Page): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="reminders"]').click();
  await expect(board.getByTestId("rem-tab")).toHaveAttribute("data-state", "ready");
  return board;
}

const groups = (board: Locator) =>
  board
    .getByTestId("rem-group")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));

const TEXT = "E2E night watch: roll once per long rest";

test("FR-REM-17 FR-REM-19 FR-REM-21 FR-PARTY-71 DM adds a party reminder with a roll → player-1 sees it and rolls it as Me; player-2 has no Mira group", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("char-mira", "entity");
  const thorn = recordId("char-thorn", "entity");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresented(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  await closePresented(p2);

  // DM: Party first, then every character by name; REM-SECRET-THORN with its eye-off Badge.
  const dmBoard = await remindersTab(dm);
  expect((await groups(dmBoard))[0]).toBe("party");
  expect(await groups(dmBoard)).toEqual(expect.arrayContaining([mira, thorn]));
  await expect(
    dmBoard.getByTestId("rem-row").filter({ hasText: "REM-SECRET-THORN" }),
  ).toHaveAttribute("data-dm-only", "true");

  // Add on the Party group: text + one roll.
  await dmBoard.locator('[data-testid="rem-group-add"][data-record-id="party"]').click();
  const editor = dm.getByTestId("rem-editor");
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId("rem-editor-save")).toBeDisabled();
  await editor.getByTestId("rem-editor-text").fill(TEXT);
  await editor.getByTestId("rem-editor-roll-add").click();
  await editor.getByTestId("rem-editor-roll-label").fill("Watch");
  await editor.getByTestId("rem-editor-roll-expression").fill("1q20");
  await expect(editor.getByTestId("rem-editor-save")).toBeDisabled();
  await editor.getByTestId("rem-editor-roll-expression").fill("1d20+1");
  await editor.getByTestId("rem-editor-save").click();
  await expect(editor).toHaveCount(0);
  await expect(dmBoard.getByTestId("rem-row").filter({ hasText: TEXT })).toHaveCount(1);

  // Player-1: Party + Mira; the new row arrives live; read-only (the DM's row).
  const p1Board = await remindersTab(p1);
  expect(await groups(p1Board)).toEqual(["party", mira]);
  const row = p1Board.getByTestId("rem-row").filter({ hasText: TEXT });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("rem-row-menu")).toHaveCount(0);
  await expect(p1Board.getByText("REM-SECRET-THORN")).toHaveCount(0);
  // FR-REM-26: at the Party Manager's size nothing scrolls sideways.
  const overflow = await p1Board
    .getByTestId("rem-tab")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // The roll: a plain dice.roll by Player 1 (no character), labelled "Watch".
  const dmLog = await openWindow(dm, "dice.log");
  await row.getByTestId("rem-row-roll").click();
  const entry = dmLog.getByTestId("dice-log-entry").filter({ hasText: "Watch" });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByTestId("dice-log-entry-actor").first()).toHaveText("Player 1");

  // Player-2: Party + Thorn only, never Mira's reminders.
  const p2Board = await remindersTab(p2);
  expect(await groups(p2Board)).toEqual(["party", thorn]);
  await expect(p2Board.getByTestId("rem-row").filter({ hasText: TEXT })).toHaveCount(1);
  await expect(p2Board.getByText("REM-MIRA-CHARM")).toHaveCount(0);
  await expect(p2Board.getByText("REM-THORN-OWN")).toHaveCount(1);

  for (const p of [p2, p1, dm]) await p.context().close();
});
