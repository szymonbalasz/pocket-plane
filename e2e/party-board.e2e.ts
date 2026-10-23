// e2e-bundle: party-board
// Thin party-board flow (PARTY §13 E2E, handout part): the DM shares h5 "Ship Manifest" with
// player-1 → player-1 gets the toast and opens it from there; player-2's board has no h5; the DM
// unshares → player-1's open viewer shows "No longer shared"; player-1 takes a potion → Mira's
// sheet Inventory tab shows it. Visibility per player, events, loads, reconnects, the move matrix:
// bun test (party-board leak.test.ts, commands.test.ts, items.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

/** Party Manager on its Handouts tab (Party status is the landing tab since FR-PARTY-60). */
async function openHandouts(page: Page): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="handouts"]').click();
  return board;
}

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
  const [mayor, thievesMap, shipManifest] = [h(0), h(1), h(4)];
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
  const dmBoard = await openHandouts(dm);
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
  const p1Board = await openHandouts(p1);
  await expect(p1Board.getByTestId("party-handout-row")).toHaveCount(3);
  await expect(p1Board.getByTestId("party-handout-row").first()).toHaveAttribute(
    "data-record-id",
    shipManifest,
  );
  await expect(row(p1Board, shipManifest)).toHaveAttribute("data-new", "false");
  await expect(row(p1Board, shipManifest)).toContainText("Shared with you");
  await expect(row(p1Board, thievesMap)).toHaveAttribute("data-new", "true");

  // Player-2: only the Mayor's Letter; nothing of h5 anywhere.
  const p2Board = await openHandouts(p2);
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

test("FR-PARTY-15 FR-PARTY-14 FR-PARTY-13 FR-PARTY-10 DM creates Wanted Poster with an image → Share with everyone → player-2 opens it; reload keeps the marks", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const poster = recordId("handout-images", "asset", 1);
  const mayor = recordId("handouts-1", "handout", 0);

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  const dmBoard = await openHandouts(dm);
  await dmBoard.getByTestId("party-handout-create").click();
  const editor = shellWindow(dm, "party.handout");
  await expect(editor.getByTestId("party-editor-save")).toBeDisabled(); // no title yet
  await editor.getByTestId("party-editor-title").fill("Wanted Poster");
  await editor.getByTestId("party-editor-body").fill("Reward 50 gp");
  await editor.getByTestId("asset-attach-library").click();
  await dm.locator(`[data-testid="asset-picker-item"][data-record-id="${poster}"]`).click();
  await dm.getByTestId("asset-picker-select").click();
  await expect(editor.getByTestId("party-editor-image")).toHaveAttribute("data-record-id", poster);
  await editor.getByTestId("party-editor-save").click();

  // Saved: the viewer shows it, unshared; the board lists it first, "Not shared".
  const view = editor.getByTestId("party-handout-view");
  await expect(view.getByTestId("party-handout-title")).toHaveText("Wanted Poster");
  await expect(view.getByTestId("party-handout-image")).toHaveAttribute("data-record-id", poster);
  const id = (await view.getAttribute("data-record-id")) as string;
  await expect(row(dmBoard, id)).toHaveAttribute("data-shared", "none");

  const p2Board = await openHandouts(p2);
  await expect(row(p2Board, mayor)).toBeVisible();
  await expect(row(p2Board, id)).toHaveCount(0);

  // One click: Share with everyone → player-2 toast + row (New).
  await view.getByTestId("party-share-everyone").click();
  await expect(row(dmBoard, id)).toHaveAttribute("data-shared", "all");
  await expect(
    p2.getByTestId("note-toast").filter({ hasText: "New handout: Wanted Poster" }),
  ).toBeVisible();
  await expect(row(p2Board, id)).toHaveAttribute("data-new", "true");
  await expect(p2Board.getByTestId("party-handout-row").first()).toHaveAttribute(
    "data-record-id",
    id,
  );
  await row(p2Board, id).getByRole("button").first().click();
  const p2View = shellWindow(p2, "party.handout").getByTestId("party-handout-view");
  await expect(p2View.getByTestId("party-handout-body")).toHaveText("Reward 50 gp");
  await expect(p2View.getByTestId("party-handout-image")).toHaveAttribute("data-record-id", poster);
  await expect(p2View.getByTestId("party-handout-edit")).toHaveCount(0); // read only
  await expect(row(p2Board, id)).toHaveAttribute("data-new", "false");

  // DM edits the text → player-2's row is marked Updated, the open viewer shows the new text.
  await view.getByTestId("party-handout-edit").click();
  await editor.getByTestId("party-editor-body").fill("Reward 80 gp");
  await editor.getByTestId("party-editor-save").click();
  await expect(p2View.getByTestId("party-handout-body")).toHaveText("Reward 80 gp");

  // Reload: skeleton, then the same list; seen marks survive (this browser).
  await p2.reload();
  await live(p2);
  const again = await openHandouts(p2);
  await expect(row(again, id)).toBeVisible();
  await expect(row(again, mayor)).toHaveAttribute("data-new", "true");

  for (const page of [p2, dm]) await page.context().close();
});

test("FR-PARTY-22 FR-PARTY-24 player-1 takes a potion → Mira's Inventory tab shows it; Give… lists only Mira's items", async ({
  browser,
}) => {
  const { link, recordId } = e2eEnv();
  const potion = recordId("party-items-1", "party-item", 0);
  const miraId = recordId("char-mira", "entity");
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  const board = await openWindow(p1, "party.board");
  await board.locator('[data-testid="party-tab"][data-value="inventory"]').click();
  const potionRow = board.locator(`[data-testid="party-item-row"][data-record-id="${potion}"]`);
  await expect(potionRow.getByTestId("party-item-count")).toHaveText("×2");
  await potionRow.getByTestId("party-item-take").click();
  // One own character: no picker, the target is Mira.
  await expect(potionRow.getByTestId("party-item-target")).toHaveAttribute(
    "data-value",
    `character:${miraId}`,
  );
  await potionRow.getByTestId("party-item-qty").fill("3");
  await expect(potionRow.getByTestId("party-item-error")).toHaveText("Only 2 left");
  await expect(potionRow.getByTestId("party-item-submit")).toBeDisabled();
  await potionRow.getByTestId("party-item-qty").fill("1");
  await potionRow.getByTestId("party-item-submit").click();
  await expect(potionRow.getByTestId("party-item-count")).toHaveText("×1");

  const sheet = await openWindow(p1, "char.sheet");
  await expect(sheet.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);
  const tab = sheet.locator('[data-testid="charx-tab"][data-value="inventory"]');
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(
    sheet.getByTestId("charx-item").filter({ hasText: "Potion of healing" }),
  ).toBeVisible();

  // Give…: only Mira's sheet items are sources (never Thorn's Torch row).
  await board.getByTestId("party-item-give").click();
  const sources = board.getByTestId("party-item-source");
  await expect(sources.filter({ hasText: "Potion of healing" })).toHaveCount(1);
  for (const s of await sources.all()) await expect(s).toHaveAttribute("data-character-id", miraId);

  await p1.context().close();
});
