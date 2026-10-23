// e2e-bundle: hold-ui-e2e
// Sprint 9 RS2 (strongholds FR-HOLD-22–34, party-board FR-PARTY-72, -76, play-shell FR-SHELL-170;
// walkthrough RS-H H1–H5, H8, H10 (hide), H11): the DM's Strongholds tab lists Greystone Keep and
// the DM-only tower; player-1's only Greystone; each opens the Stronghold window (DM 6 facilities,
// player 5, no secret); a DM order edit reaches the player live; a reload reopens the window on
// Greystone; hiding it takes the tab and the window's content away from the player; the tab strip
// keeps every label whole and scrolls. Rows per viewer, totals and texts: `strongholds.test.tsx`.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function dmPage(browser: Browser): Promise<Page> {
  const page = await rolePage(browser);
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginDm(page, e2eEnv().secret);
  await live(page);
  return page;
}

async function playerPage(browser: Browser, name: string): Promise<Page> {
  const page = await rolePage(browser);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(e2eEnv().link(name));
  await live(page);
  return page;
}

const partyTab = (win: Locator, id: string) =>
  win.locator(`[data-testid="party-tab"][data-value="${id}"]`);

/** The Party Manager on its Strongholds tab. */
async function strongholdsTab(page: Page): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await partyTab(board, "strongholds").click();
  await expect(partyTab(board, "strongholds")).toHaveAttribute("aria-selected", "true");
  return board;
}

const row = (scope: Locator, name: string) =>
  scope.getByTestId("hold-row").filter({ hasText: name });
const facility = (win: Locator, name: string) =>
  win.getByTestId("hold-facility").filter({
    has: win.page().getByTestId("hold-facility-name").getByText(name, { exact: true }),
  });

test("FR-HOLD-22 FR-HOLD-23 FR-HOLD-25 FR-PARTY-72 FR-SHELL-170 DM and player-1 open Greystone Keep from the Strongholds tab; a DM order edit reaches the player; a reload reopens it; hiding it takes it away", async ({
  browser,
}) => {
  const dm = await dmPage(browser);
  const p1 = await playerPage(browser, "Player 1");

  // H1: the DM's list, the tower with "DM only".
  const dmBoard = await strongholdsTab(dm);
  await expect(dmBoard.getByTestId("hold-row")).toHaveCount(2);
  await expect(row(dmBoard, "HOLD-SECRET-TOWER")).toHaveAttribute("data-dm-only", "true");
  await expect(row(dmBoard, "Greystone Keep")).toHaveAttribute("data-dm-only", "false");
  await expect(row(dmBoard, "Greystone Keep").getByTestId("hold-row-summary")).toHaveText(
    "3 built · 1 building · 1 planned · 1 replaced",
  );
  // H3: open it (no launcher entry for the Stronghold window).
  await expect(
    dm.locator('[data-testid="ui-launcher-button"][data-record-id^="hold."]'),
  ).toHaveCount(0);
  await row(dmBoard, "Greystone Keep").getByTestId("hold-row-open").click();
  const dmWin = shellWindow(dm, "hold.stronghold");
  await expect(dmWin.getByTestId("hold-name")).toHaveText("Greystone Keep");
  await expect(dmWin.getByTestId("hold-facility")).toHaveCount(6);
  await expect(facility(dmWin, "HOLD-SECRET-VAULT")).toHaveAttribute("data-dm-only", "true");
  await expect(facility(dmWin, "Steam Rooms").getByTestId("hold-facility-replaces")).toHaveText(
    "Replaces Old Bathhouse",
  );
  await expect(facility(dmWin, "Forge Hall").getByTestId("hold-facility-staff")).toHaveText(
    "Brenna",
  );
  await expect(dmWin.getByTestId("hold-totals")).toHaveText(
    "Upkeep 8 gp · Wages 8 gp (incl. DM only)",
  );

  // H2 / H4: player-1 sees Greystone only, five facilities, no secret.
  const pBoard = await strongholdsTab(p1);
  await expect(pBoard.getByTestId("hold-row")).toHaveCount(1);
  await row(pBoard, "Greystone Keep").getByTestId("hold-row-open").click();
  const pWin = shellWindow(p1, "hold.stronghold");
  await expect(pWin.getByTestId("hold-facility")).toHaveCount(5);
  await expect(pWin.getByTestId("hold-defenders")).toHaveAttribute("data-value", "12");
  await expect(pWin.getByTestId("hold-totals")).toHaveText("Upkeep 8 gp · Wages 3 gp");
  await pWin.locator('[data-testid="hold-tab"][data-value="staff"]').click();
  await expect(pWin.getByTestId("hold-staff")).toHaveCount(2);
  expect(await p1.content()).not.toContain("HOLD-SECRET");

  // H5: the DM edits Forge Hall's order (suggestions offer "Craft: arrows"); player-1 sees it.
  await facility(dmWin, "Forge Hall").getByTestId("hold-facility-menu").click();
  await dm.getByTestId("hold-facility-edit").click();
  const form = dm.getByTestId("hold-facility-form");
  await expect(
    form.locator('[data-testid="hold-facility-form-suggestions"] option[value="Craft: arrows"]'),
  ).toHaveCount(1);
  await form.getByTestId("hold-facility-form-order").fill("Craft: shields");
  await form.getByTestId("hold-facility-form-save").click();
  await expect(form).toHaveCount(0);
  await pWin.locator('[data-testid="hold-tab"][data-value="facilities"]').click();
  await expect(facility(pWin, "Forge Hall").getByTestId("hold-facility-order")).toHaveText(
    "Order: Craft: shields",
  );

  // H11: a reload reopens the window on Greystone.
  await p1.reload();
  await live(p1);
  const again = shellWindow(p1, "hold.stronghold");
  await expect(again.getByTestId("hold-name")).toHaveText("Greystone Keep");
  await expect(again.getByTestId("hold-facility")).toHaveCount(5);

  // H10 (hide): the DM hides Greystone → player-1's window says it isn't available and the
  // Strongholds tab leaves the Party Manager; showing it again brings both back.
  await dmWin.getByTestId("hold-show").click();
  await expect(dmWin.getByTestId("hold-show")).toHaveAttribute("data-value", "false");
  await expect(again.getByTestId("hold-gone")).toBeVisible();
  await expect(partyTab(shellWindow(p1, "party.board"), "strongholds")).toHaveCount(0);
  expect(await p1.content()).not.toContain("HOLD-SECRET");
  await dmWin.getByTestId("hold-show").click();
  await expect(dmWin.getByTestId("hold-show")).toHaveAttribute("data-value", "true");
  await expect(again.getByTestId("hold-facility")).toHaveCount(5);
  await expect(partyTab(shellWindow(p1, "party.board"), "strongholds")).toHaveCount(1);

  await dm.context().close();
  await p1.context().close();
});

/** Every tab label whole (no ellipsis, nothing clipped) and the strip's widths. */
async function stripCheck(board: Locator) {
  return board.getByTestId("party-tabs").evaluate((strip) => {
    const labels = [...strip.querySelectorAll<HTMLElement>('[data-testid="party-tab"]')];
    return {
      cut: labels
        .filter(
          (l) => l.scrollWidth > l.clientWidth || getComputedStyle(l).textOverflow === "ellipsis",
        )
        .map((l) => l.textContent),
      labels: labels.map((l) => l.textContent),
      stripW: strip.clientWidth,
      contentW: strip.scrollWidth,
    };
  });
}

test("FR-PARTY-76 the Party Manager's tab labels stay whole at the default width and the min width; the strip scrolls to Strongholds", async ({
  browser,
}) => {
  for (const page of [await dmPage(browser), await playerPage(browser, "Player 1")]) {
    const board = await openWindow(page, "party.board");
    const wide = await stripCheck(board);
    expect(wide.labels.at(-1)).toBe("Strongholds");
    expect(wide.cut).toEqual([]);
    console.log(
      `FR-PARTY-76 strip at the default width: ${wide.stripW} px, labels ${wide.contentW} px`,
    );
    // The min width (340): narrow the window frame itself (no drag needed for a layout check).
    await page.addStyleTag({
      content:
        '[data-testid="ui-window"][data-record-id="party.board:main"]{width:340px!important}',
    });
    const narrow = await stripCheck(board);
    expect(narrow.cut).toEqual([]);
    expect(narrow.contentW).toBeGreaterThan(narrow.stripW);
    const tab = partyTab(board, "strongholds");
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(board.getByTestId("hold-list")).toBeVisible();
    await page.context().close();
  }
});
