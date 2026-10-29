// e2e-bundle: rest-e2e
// Rest buttons (CHARX FR-CHARX-121–124, PARTY FR-PARTY-79): on Mira's sheet the DM's Rest → Short
// rest resets only Second Wind (short), Lucky (long) stays spent; then Party Manager's Rest the
// party… → Long rest with everyone ticked: Mira's Lucky, slot and HP and Thorn's HP reset, on the
// DM's sheet / Party status and on Player 1's own sheet, live. Rules, hit dice math, refusals,
// visibility: bun test (`char.rest`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const tab = (win: Locator, value: string) =>
  win.locator(`[data-testid="charx-tab"][data-value="${value}"]`).click();

/** The uses left of the feature row named `name` (`data-value`), on the Features tab. */
const left = (win: Locator, name: string) =>
  win
    .getByTestId("charx-feature")
    .filter({ hasText: name })
    .first()
    .getByTestId("charx-feature-left");

test("FR-CHARX-121 FR-CHARX-123 FR-PARTY-79 rest buttons: sheet short rest, party long rest, live on the player's sheet", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);

  // Sheet: Short rest → Second Wind back, Lucky still 1 / 3.
  const sheet = await openWindow(dm, "char.sheet");
  await pickSheet(sheet, recordId("char-mira", "entity"));
  await tab(sheet, "features");
  await expect(left(sheet, "Second Wind")).toHaveAttribute("data-value", "0");
  await expect(left(sheet, "Lucky")).toHaveAttribute("data-value", "1");
  await sheet.getByTestId("charx-rest").click();
  const pop = dm.getByTestId("charx-rest-popover");
  await expect(pop).toBeVisible();
  await expect(dm.locator('[data-testid="charx-rest-kind"][data-value="short"]')).toHaveAttribute(
    "data-state",
    "on",
  );
  await expect(dm.getByTestId("charx-rest-warning")).toHaveCount(0);
  await dm.getByTestId("charx-rest-confirm").click();
  await expect(pop).toHaveCount(0);
  await expect(left(sheet, "Second Wind")).toHaveAttribute("data-value", "1");
  await expect(left(sheet, "Lucky")).toHaveAttribute("data-value", "1");

  // Party Manager: Long rest for every character (all ticked).
  const pm = await openWindow(dm, "party.board");
  await pm.getByTestId("party-rest-open").click();
  const dialog = dm.getByTestId("party-rest-dialog");
  await expect(dialog).toBeVisible();
  const boxes = dialog.getByTestId("party-rest-character");
  await expect(
    boxes.and(dm.locator(`[data-record-id="${recordId("char-mira", "entity")}"]`)),
  ).toHaveAttribute("data-state", "checked");
  await expect(
    boxes.and(dm.locator(`[data-record-id="${recordId("char-thorn", "entity")}"]`)),
  ).toHaveAttribute("data-state", "checked");
  await dialog.locator('[data-testid="party-rest-kind"][data-value="long"]').click();
  await expect(dialog.getByTestId("party-rest-text")).toContainText("Restores HP");
  await dialog.getByTestId("party-rest-confirm").click();
  await expect(dialog).toHaveCount(0);

  // DM: Lucky back to 3 / 3; Thorn's Party status HP full.
  await expect(left(sheet, "Lucky")).toHaveAttribute("data-value", "3");
  const thorn = pm.getByTestId("party-companion-group").filter({
    has: dm.getByTestId("party-summary-name").getByText("Thorn", { exact: true }),
  });
  await expect(thorn.getByTestId("party-summary-hp")).toHaveAttribute("data-value", "10/10");
  await tab(sheet, "main");
  await expect(sheet.getByTestId("char-sheet-hp").first()).toContainText("12");

  // Player 1's own sheet, live: HP 12 / 12, slots 0 / 2, Lucky 3 / 3, Second Wind 1 / 1.
  const own = await openWindow(p1, "char.sheet");
  await expect(own.getByTestId("char-sheet")).toHaveAttribute(
    "data-record-id",
    recordId("char-mira", "entity"),
  );
  await expect(own.getByTestId("char-sheet-hp").first()).toHaveText(/^12\s*\/\s*12$/);
  await tab(own, "actions");
  await expect(own.locator('[data-testid="charx-slot"][data-value="1"]').first()).toHaveAttribute(
    "data-used",
    "0",
  );
  await expect(own.getByTestId("charx-rest")).toHaveCount(0);
  await tab(own, "features");
  await expect(left(own, "Lucky")).toHaveAttribute("data-value", "3");
  await expect(left(own, "Second Wind")).toHaveAttribute("data-value", "1");
  await dm.context().close();
  await p1.context().close();
});
