// e2e-bundle: party-board
// Thin party-board flow (PARTY §13 E2E, handout part): the DM shares h5 "Ship Manifest" with
// player-1 → player-1 gets the toast and opens it from there; player-2's board has no h5; the DM
// unshares → player-1's open viewer shows "No longer shared". Visibility per player, events,
// loads, reconnects: bun test (party-board leak.test.ts, commands.test.ts).
// The "player-1 takes a potion" part comes with slice 4 (party inventory moves).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const row = (win: Locator, id: string) =>
  win.locator(`[data-testid="party-handout-row"][data-record-id="${id}"]`);

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

test("FR-PARTY-05 FR-PARTY-06 FR-PARTY-07 FR-PARTY-09 FR-PARTY-16 DM shares Ship Manifest with player-1 → toast + open; player-2 never sees it; unshare → No longer shared", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const h = (i: number) => recordId("handouts-1", "handout", i);
  const [mayor, thievesMap, , , shipManifest] = [0, 1, 2, 3, 4].map(h) as string[];
  const p1Id = recordId("player-1", "player");

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  // DM board: all five, newest first; h5 unshared.
  const dmBoard = await openWindow(dm, "party.board");
  await expect(dmBoard.getByTestId("party-handout-row")).toHaveCount(5);
  await expect(dmBoard.getByTestId("party-handout-row").first()).toHaveAttribute(
    "data-record-id",
    shipManifest,
  );
  await expect(row(dmBoard, shipManifest)).toHaveAttribute("data-shared", "none");
  await expect(row(dmBoard, shipManifest)).toContainText("Not shared");

  // Share… → Chosen players → Player 1 → Share (≤ 3 clicks after the menu).
  await row(dmBoard, shipManifest).getByTestId("party-handout-menu").click();
  await dm.getByTestId("party-share-open").click();
  await expect(dm.getByTestId("party-share-hint")).toContainText(
    "players keep images they've already seen",
  );
  await expect(dm.getByTestId("party-share-submit")).toBeDisabled();
  await dm.locator('[data-testid="party-share-mode"][data-value="players"]').click();
  await expect(dm.getByTestId("party-share-submit")).toBeDisabled(); // none ticked
  await dm.locator(`[data-testid="party-share-player"][data-record-id="${p1Id}"]`).click();
  await dm.getByTestId("party-share-submit").click();
  await expect(row(dmBoard, shipManifest)).toHaveAttribute("data-shared", "players");
  await expect(row(dmBoard, shipManifest)).toContainText("Player 1");

  // Player-1: toast, Open → viewer with the text.
  const toast = p1.getByTestId("note-toast").filter({ hasText: "New handout: Ship Manifest" });
  await expect(toast).toBeVisible();
  await toast.getByTestId("party-note-open").click();
  const viewer = shellWindow(p1, "party.handout");
  await expect(viewer.getByTestId("party-handout-view")).toHaveAttribute(
    "data-record-id",
    shipManifest,
  );
  await expect(viewer.getByTestId("party-handout-title")).toHaveText("Ship Manifest");
  await expect(viewer.getByTestId("party-handout-body")).toContainText("PARTY-PREP-5");

  // Player-1's board: h5 newest shared, seen (opened); h2 / h1 New; never another player's name.
  const p1Board = await openWindow(p1, "party.board");
  await expect(p1Board.getByTestId("party-handout-row")).toHaveCount(3);
  await expect(p1Board.getByTestId("party-handout-row").first()).toHaveAttribute(
    "data-record-id",
    shipManifest,
  );
  await expect(row(p1Board, shipManifest)).toHaveAttribute("data-new", "false");
  await expect(row(p1Board, shipManifest)).toContainText("Shared with you");
  await expect(row(p1Board, thievesMap)).toHaveAttribute("data-new", "true");

  // Player-2: only the Mayor's Letter; nothing of h5 anywhere.
  const p2Board = await openWindow(p2, "party.board");
  await expect(p2Board.getByTestId("party-handout-row")).toHaveCount(1);
  await expect(row(p2Board, mayor)).toContainText("Everyone");
  await expect(row(p2Board, shipManifest)).toHaveCount(0);
  await expect(p2.getByText("Ship Manifest")).toHaveCount(0);

  // DM unshares from the row menu while player-1's viewer is open.
  await row(dmBoard, shipManifest).getByTestId("party-handout-menu").click();
  await dm.getByTestId("party-handout-unshare").click();
  await expect(row(dmBoard, shipManifest)).toHaveAttribute("data-shared", "none");
  await expect(viewer.getByTestId("party-handout-gone")).toHaveText("No longer shared");
  await expect(row(p1Board, shipManifest)).toHaveCount(0);

  for (const page of [p2, p1, dm]) await page.context().close();
});
