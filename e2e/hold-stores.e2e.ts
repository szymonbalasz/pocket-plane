// e2e-bundle: hold-stores-e2e
// Sprint 9 RS3 (strongholds FR-HOLD-28, party-loot FR-LOOT-32–36, party-board FR-PARTY-77;
// walkthrough RS-H H7, H10, H13): player-1 moves 20 gp Greystone's Stores → Party pot with the
// Stores tab's "Move to party" and takes Arrows ×20 to Mira; the Stores, the pot and the log update
// for both; the DM-only gem shows only for the DM; Inventory keeps Stores rows out. Then the DM
// shows the hidden tower (player-1's log names it), hides it (back to "Outside the party") and
// deletes it (its item and coin reach the party; player-1's frames never name it). Options, labels
// and payloads per viewer: `stores.test.tsx`; rights and redaction: the server's `stores.test.ts`.
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

/** Player-1 with every WS frame's text kept for the leak scans. */
async function playerPage(
  browser: Browser,
  name: string,
): Promise<{ page: Page; frames: string[] }> {
  const page = await rolePage(browser);
  const frames: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string") frames.push(f.payload);
    }),
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(e2eEnv().link(name));
  await live(page);
  return { page, frames };
}

const partyTab = (win: Locator, id: string) =>
  win.locator(`[data-testid="party-tab"][data-value="${id}"]`);

async function boardOn(page: Page, tab: string): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await partyTab(board, tab).click();
  await expect(partyTab(board, tab)).toHaveAttribute("aria-selected", "true");
  return board;
}

const holdRow = (scope: Locator, name: string) =>
  scope.getByTestId("hold-row").filter({ hasText: name });

/** Opens `name` from the Strongholds tab and goes to its Stores tab. */
async function openStores(page: Page, name: string): Promise<Locator> {
  const board = await boardOn(page, "strongholds");
  await holdRow(board, name).getByTestId("hold-row-open").click();
  const win = shellWindow(page, "hold.stronghold");
  await expect(win.getByTestId("hold-name")).toHaveText(name);
  await win.locator('[data-testid="hold-tab"][data-value="stores"]').click();
  await expect(win.getByTestId("hold-stores")).toBeVisible();
  return win;
}

const storesGp = (win: Locator) => win.locator('[data-testid="loot-stores-coin"][data-value="gp"]');
const potGp = (win: Locator) =>
  win.locator('[data-testid="loot-pot"] [data-testid="loot-pot-coin"][data-value="gp"]');
const gpOf = async (l: Locator) => Number((await l.innerText()).replace(/[^\d-]/g, ""));
const itemRow = (scope: Locator, name: string) =>
  scope.getByTestId("party-item-row").filter({ hasText: name });

test("FR-HOLD-28 FR-LOOT-34 FR-LOOT-35 FR-LOOT-36 FR-PARTY-77 player-1 moves 20 gp Stores → Party pot with Move to party and takes Arrows ×20 to Mira; Stores, pot and log update for both; the gem is the DM's only; Inventory keeps Stores rows out", async ({
  browser,
}) => {
  const miraId = e2eEnv().recordId("char-mira", "entity");
  const dm = await dmPage(browser);
  const { page: p1, frames } = await playerPage(browser, "Player 1");

  // The pot before, on the Loot tab.
  const pot0 = await gpOf(potGp(await boardOn(dm, "loot")));
  const dmWin = await openStores(dm, "Greystone Keep");
  const pWin = await openStores(p1, "Greystone Keep");
  for (const w of [dmWin, pWin]) await expect(storesGp(w)).toHaveText("120 gp");
  // H7: the DM sees the gem with eye-off; player-1 Rope and Arrows only.
  await expect(itemRow(dmWin, "HOLD-SECRET-GEM")).toHaveAttribute("data-dm-only", "true");
  await expect(dmWin.getByTestId("loot-stores-add")).toBeVisible();
  await expect(pWin.getByTestId("party-item-row")).toHaveCount(2);
  await expect(pWin.getByTestId("loot-stores-add")).toHaveCount(0);

  // Move to party: preset From = Greystone Keep Stores, To = Party pot.
  const move = pWin.getByTestId("loot-move");
  await expect(move).toHaveAttribute("data-preset", "stores");
  await expect(move.getByTestId("loot-move-title")).toHaveText("Move to party");
  await expect(move.getByTestId("loot-move-from")).toContainText("Greystone Keep Stores");
  await expect(move.getByTestId("loot-move-to")).toContainText("Party pot");
  await move.locator('[data-testid="loot-move-coin"][data-value="gp"]').fill("20");
  await move.getByTestId("loot-move-submit").click();
  for (const w of [dmWin, pWin]) await expect(storesGp(w)).toHaveText("100 gp");

  // Take Arrows ×20 to Mira (Party or Mira: a picker).
  const arrows = itemRow(pWin, "Arrows");
  await arrows.getByTestId("party-item-take").click();
  const take = pWin.getByTestId("party-item-take-form");
  await take.getByTestId("party-item-target").click();
  await p1
    .locator(`[data-testid="party-item-target-option"][data-value="character:${miraId}"]`)
    .click();
  await take.getByTestId("party-item-qty").fill("20");
  await take.getByTestId("party-item-submit").click();
  for (const w of [dmWin, pWin])
    await expect(itemRow(w, "Arrows").getByTestId("party-item-count")).toHaveText("×20");

  // The pot moved for both; FR-LOOT-35: the log names the Stores.
  const dmLoot = await boardOn(dm, "loot");
  const pLoot = await boardOn(p1, "loot");
  for (const w of [dmLoot, pLoot]) {
    await expect(potGp(w)).toHaveText(`${pot0 + 20} gp`);
    await expect(
      w.getByTestId("loot-entry-route").filter({ hasText: "Greystone Keep Stores → Party pot" }),
    ).toHaveCount(1);
    await expect(
      w
        .getByTestId("loot-entry-item")
        .filter({ hasText: "Greystone Keep Stores → Mira: Arrows ×20" }),
    ).toHaveCount(1);
  }

  // FR-PARTY-77: Inventory lists the party's rows only.
  const pInv = await boardOn(p1, "inventory");
  await expect(pInv.getByTestId("party-item-row").first()).toBeVisible();
  await expect(itemRow(pInv, "Arrows")).toHaveCount(0);
  await expect(pInv.locator('[data-testid="party-item-row"][data-holder="stores"]')).toHaveCount(0);

  expect(await p1.content()).not.toContain("HOLD-SECRET");
  expect(frames.join("\n")).not.toContain("HOLD-SECRET");
  await dm.context().close();
  await p1.context().close();
});

test("FR-LOOT-32 FR-LOOT-35 FR-LOOT-38 the DM shows the hidden tower (player-1's log names its Stores), hides it (back to Outside the party), then deletes it: item and coin reach the party, player-1 never reads its name or 'Stronghold deleted'", async ({
  browser,
}) => {
  const dm = await dmPage(browser);
  const { page: p1, frames } = await playerPage(browser, "Player 1");
  const outsideRoute = (w: Locator) =>
    w.getByTestId("loot-entry-route").filter({ hasText: "Outside the party → Party pot" });
  const towerRoute = (w: Locator) =>
    w.getByTestId("loot-entry-route").filter({ hasText: "HOLD-SECRET-TOWER Stores → Party pot" });

  const pLoot = await boardOn(p1, "loot");
  await expect(outsideRoute(pLoot)).toHaveCount(1);
  await expect(towerRoute(pLoot)).toHaveCount(0);

  // H10: show, then hide.
  const dmBoard = await boardOn(dm, "strongholds");
  const towerMenu = async () => {
    await holdRow(dmBoard, "HOLD-SECRET-TOWER").getByTestId("hold-row-menu").click();
  };
  await towerMenu();
  await dm.getByTestId("hold-show").click();
  await expect(holdRow(dmBoard, "HOLD-SECRET-TOWER")).toHaveAttribute("data-dm-only", "false");
  await expect(towerRoute(pLoot)).toHaveCount(1);
  await expect(outsideRoute(pLoot)).toHaveCount(0);
  await towerMenu();
  await dm.getByTestId("hold-show").click();
  await expect(holdRow(dmBoard, "HOLD-SECRET-TOWER")).toHaveAttribute("data-dm-only", "true");
  await expect(outsideRoute(pLoot)).toHaveCount(1);
  await expect(towerRoute(pLoot)).toHaveCount(0);
  expect(await p1.content()).not.toContain("HOLD-SECRET");
  const afterHide = frames.length;

  // H13: delete (1 item, 5 gp to the party).
  const pot0 = await gpOf(potGp(pLoot));
  await towerMenu();
  await dm.getByTestId("hold-delete").click();
  await expect(dm.getByTestId("hold-delete-summary")).toContainText("1 item");
  await expect(dm.getByTestId("hold-delete-summary")).toContainText("5 gp");
  await dm.getByTestId("hold-delete-confirm").click();
  await expect(holdRow(dmBoard, "HOLD-SECRET-TOWER")).toHaveCount(0);
  await expect(potGp(pLoot)).toHaveText(`${pot0 + 5} gp`);
  await expect(outsideRoute(pLoot)).toHaveCount(2);
  await expect(
    pLoot
      .getByTestId("loot-entry-item")
      .filter({ hasText: "Outside the party → Party: HOLD-SECRET-ITEM ×1" }),
  ).toHaveCount(1);
  const pInv = await boardOn(p1, "inventory");
  await expect(itemRow(pInv, "HOLD-SECRET-ITEM")).toHaveCount(1);
  // The DM's log keeps the tower's old moves as "Stores (removed)".
  const dmLoot = await boardOn(dm, "loot");
  await expect(
    dmLoot.getByTestId("loot-entry-route").filter({ hasText: "Stores (removed) → Party pot" }),
  ).not.toHaveCount(0);

  const late = frames.slice(afterHide).join("\n");
  expect(late).not.toContain("HOLD-SECRET-TOWER");
  expect(late).not.toContain("Stronghold deleted");
  expect(late).not.toContain('"world"},"to":{"kind":"party"');
  await dm.context().close();
  await p1.context().close();
});
