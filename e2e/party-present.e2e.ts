// e2e-bundle: party-s5
// Thin handout present flow (PARTY §13.1 E2E, walkthrough S5-1, S5-4–S5-7 on fixture handouts):
// player-1 connects to the waiting present (h2) → popup over the map, Close → gone, also after a
// reload; the DM shares h5 with player-1 + "Also open it on the screens…" → popup with no toast,
// Open in Party → viewer; Open on screens… → Close on all screens; a present survives a reload
// until closed; player-2 never gets a popup. Present / close / access-loss rules, leaks and
// reconnects: bun test (party-board present.test.ts, present-leak.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const row = (win: Locator, id: string) =>
  win.locator(`[data-testid="party-handout-row"][data-record-id="${id}"]`);

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** The element at the popup's centre is inside it: nothing (window, toast) is drawn above. */
async function onTop(page: Page) {
  const popup = page.getByTestId("party-present-popup");
  const box = await popup.boundingBox();
  if (!box) throw new Error("popup has no box");
  const inside = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('[data-testid="party-present-popup"]') !== null,
    { x: box.x + box.width / 2, y: box.y + 24 },
  );
  expect(inside).toBe(true);
}

test("FR-PARTY-36 popup on connect FR-PARTY-37 close: h2 waits for player-1, opens over everything, Close → gone for good; player-2 none", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const thievesMap = recordId("handouts-1", "handout", 1);

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const dmBoard = await openWindow(dm, "party.board");
  // h2 is presented to player-1 (`handout-present-1`); a spec file earlier in this bundle may
  // have closed it, so present it again while player-1 is offline (the row waits either way).
  await row(dmBoard, thievesMap).getByTestId("party-handout-menu").click();
  await dm
    .locator(`[role="menuitem"][data-testid="party-present-open"][data-record-id="${thievesMap}"]`)
    .click();
  await dm.getByTestId("party-present-submit").click();
  await expect(dm.getByTestId("party-present-dialog")).toHaveCount(0);
  const badge = row(dmBoard, thievesMap).getByTestId("party-present-count");
  await expect(badge).toHaveAttribute("data-value", "1");
  await expect(badge).toHaveText("On screen: 1");
  await expect(dm.getByTestId("party-present-popup")).toHaveCount(0); // never on the DM

  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const popup = p1.getByTestId("party-present-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute("data-record-id", thievesMap);
  await expect(p1.getByTestId("party-present-title")).toContainText("Thieves' Map");
  await expect(p1.getByTestId("party-present-image")).toHaveCount(1);
  await expect(p1.getByTestId("party-present-close")).toBeFocused();
  await onTop(p1);

  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  await expect(p2.getByTestId("ui-play-page")).toBeVisible();
  await expect(p2.getByTestId("party-present-popup")).toHaveCount(0);

  await p1.getByTestId("party-present-close").click();
  await expect(popup).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await p1.reload();
  await live(p1);
  await expect(p1.getByTestId("ui-play-page")).toBeVisible();
  await expect(popup).toHaveCount(0);

  for (const page of [p2, p1, dm]) await page.context().close();
});

test("FR-PARTY-38 FR-PARTY-36 FR-PARTY-37 share + open on screens → popup, no toast; Open in Party; Open on screens… → Close on all screens; reload keeps it until closed", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mayor = recordId("handouts-1", "handout", 0);
  const shipManifest = recordId("handouts-1", "handout", 4);
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
  const p1Popup = p1.getByTestId("party-present-popup");

  // S5-4: Share… → Chosen: Player 1 + "Also open it on the screens…" ("Opens on: Player 1").
  const dmBoard = await openWindow(dm, "party.board");
  await row(dmBoard, shipManifest).getByTestId("party-handout-menu").click();
  await expect(dm.getByTestId("party-present-open")).toHaveCount(0); // not shared yet
  await dm.getByTestId("party-share-open").click();
  await expect(dm.getByTestId("party-share-present")).toHaveCount(0); // hidden for Not shared
  await dm.locator('[data-testid="party-share-mode"][data-value="players"]').click();
  await dm.locator(`[data-testid="party-share-player"][data-record-id="${p1Id}"]`).click();
  await expect(dm.getByTestId("party-share-present-names")).toHaveText("Opens on: Player 1");
  await expect(dm.getByTestId("party-share-present")).toHaveAttribute("data-state", "unchecked");
  await dm.getByTestId("party-share-present").click();
  await dm.getByTestId("party-share-submit").click();

  await expect(p1Popup).toBeVisible();
  await expect(p1Popup).toHaveAttribute("data-record-id", shipManifest);
  await expect(p1.getByTestId("party-present-body")).toContainText("PARTY-PREP-5");
  await onTop(p1);
  // No extra toast: the popup hides the "New handout" toast for the same handout.
  await expect(
    p1.getByTestId("note-toast").filter({ hasText: "New handout: Ship Manifest" }),
  ).toHaveCount(0);
  await expect(p2.getByTestId("party-present-popup")).toHaveCount(0);
  await expect(p2.getByText("Ship Manifest")).toHaveCount(0);
  const rowBadge = row(dmBoard, shipManifest).getByTestId("party-present-count");
  await expect(rowBadge).toHaveAttribute("data-value", "1");

  // S5-5: Open in Party → popup closes, the viewer opens on it; the DM's badge goes.
  await p1.getByTestId("party-present-open-board").click();
  await expect(p1Popup).toHaveCount(0);
  await expect(shellWindow(p1, "party.handout").getByTestId("party-handout-view")).toHaveAttribute(
    "data-record-id",
    shipManifest,
  );
  await expect(rowBadge).toHaveCount(0);

  // S5-6: viewer → Open on screens… → Everyone it's shared with → Open; Close on all screens.
  await row(dmBoard, shipManifest).getByRole("button").first().click();
  const viewer = shellWindow(dm, "party.handout");
  await expect(viewer.getByTestId("party-handout-view")).toHaveAttribute(
    "data-record-id",
    shipManifest,
  );
  await viewer.getByTestId("party-present-open").click();
  const dialog = dm.getByTestId("party-present-dialog");
  await expect(
    dialog.locator('[data-testid="party-present-mode"][data-value="all"]'),
  ).toHaveAttribute("data-state", "checked");
  await dialog.getByTestId("party-present-submit").click();
  await expect(dialog).toHaveCount(0);
  await expect(p1Popup).toHaveAttribute("data-record-id", shipManifest);
  await expect(viewer.getByTestId("party-present-count")).toHaveAttribute("data-value", "1");
  await viewer.getByTestId("party-present-close-all").click();
  await expect(p1Popup).toHaveCount(0);
  await expect(viewer.getByTestId("party-present-count")).toHaveCount(0);

  // S5-7: row menu → Open on screens… → Chosen: Player 1 (h1 is everyone's) → reload keeps it.
  await row(dmBoard, mayor).getByTestId("party-handout-menu").click();
  await dm
    .locator(`[role="menuitem"][data-testid="party-present-open"][data-record-id="${mayor}"]`)
    .click();
  await dialog.locator('[data-testid="party-present-mode"][data-value="players"]').click();
  await expect(dialog.getByTestId("party-present-submit")).toBeDisabled(); // none ticked
  await expect(dialog.getByTestId("party-present-player")).toHaveCount(2);
  await dialog.locator(`[data-testid="party-present-player"][data-record-id="${p1Id}"]`).click();
  await dialog.getByTestId("party-present-submit").click();
  await expect(p1Popup).toHaveAttribute("data-record-id", mayor);
  await expect(p2.getByTestId("party-present-popup")).toHaveCount(0);
  await p1.reload();
  await live(p1);
  await expect(p1Popup).toHaveAttribute("data-record-id", mayor);
  await p1.keyboard.press("Escape");
  await expect(p1Popup).toHaveCount(0);
  await expect(row(dmBoard, mayor).getByTestId("party-present-count")).toHaveCount(0);
  await p1.reload();
  await live(p1);
  await expect(p1.getByTestId("ui-play-page")).toBeVisible();
  await expect(p1Popup).toHaveCount(0);

  for (const page of [p2, p1, dm]) await page.context().close();
});
