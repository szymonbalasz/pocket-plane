// e2e-bundle: notifications
// Thin notifications flow (NOTE §13 E2E): DM sends a pending test notification to Player 1 →
// player toast with Done → click → DM row "Resolved by Player 1". Other rules: bun test.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

test("FR-NOTE-13 FR-NOTE-16 FR-NOTE-17 FR-NOTE-22 pending to player-1 → toast → Done → DM row resolved", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  // FR-NOTE-15: summary on load for the DM's own pending (`pending-dm`).
  await expect(dm.getByTestId("note-toast-pending-summary")).toHaveAttribute("data-count", "1");

  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await expect(player.getByTestId("note-toast-pending-summary")).toHaveAttribute("data-count", "1");
  await expect(player.getByTestId("note-toast")).toHaveCount(0); // snapshots never toast per item

  const win = await openWindow(dm, "note.history");
  const pendingP1 = recordId("notifications-test", "notification", 4);
  await expect(
    win.locator(`[data-testid="note-history-row"][data-record-id="${pendingP1}"]`),
  ).toHaveAttribute("data-state", "pending");
  await win.getByTestId("note-test-text").fill("Roll DEX save");
  const p1Option = win.getByTestId("note-test-audience").locator("option", { hasText: "Player 1" });
  const p1Value = (await p1Option.getAttribute("value")) as string;
  await win.getByTestId("note-test-audience").selectOption(p1Value);
  await win.getByTestId("note-test-owner").selectOption(p1Value);
  await win.getByTestId("note-test-label").fill("Done");
  await win.getByTestId("note-test-send").click();

  // Player: sticky toast with Done; DM (not the owner): no toast, row Pending tagged "Player 1".
  const toast = player.getByTestId("note-toast").filter({ hasText: "Roll DEX save" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-sticky", "true");
  const dmRow = win.getByTestId("note-history-row").filter({ hasText: "Roll DEX save" });
  await expect(dmRow).toHaveAttribute("data-state", "pending");
  await expect(dmRow.getByTestId("note-history-audience")).toHaveText("Player 1");
  await expect(dm.getByTestId("note-toast").filter({ hasText: "Roll DEX save" })).toHaveCount(0);

  await toast.getByTestId("note-toast-action").click();
  await expect(toast).toHaveCount(0);
  await expect(dmRow).toHaveAttribute("data-state", "resolved");
  await expect(dmRow.getByTestId("note-history-state")).toHaveText("Resolved by Player 1");
  // No SECRET-NOTE anywhere on the player's page.
  await expect(player.getByText(/SECRET-NOTE/)).toHaveCount(0);

  await player.context().close();
  await dm.context().close();
});

test("FR-NOTE-14 FR-NOTE-15 DM reconnect: the sticky toast stays and the summary toast comes back", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  const status = dm.getByTestId("sync-connection-status");
  await expect(status).toHaveAttribute("data-state", "live");
  const summary = dm.getByTestId("note-toast-pending-summary");
  await expect(summary).toBeVisible();
  const before = Number(await summary.getAttribute("data-count"));
  await summary.getByTestId("note-toast-close").click();
  await expect(summary).toHaveCount(0);

  const win = await openWindow(dm, "note.history");
  await win.getByTestId("note-test-text").fill("Reconnect card");
  await win.getByTestId("note-test-audience").selectOption("dm");
  await win.getByTestId("note-test-owner").selectOption("dm");
  await win.getByTestId("note-test-label").fill("Apply");
  await win.getByTestId("note-test-send").click();
  const card = dm.getByTestId("note-toast").filter({ hasText: "Reconnect card" });
  await expect(card).toHaveAttribute("data-sticky", "true");

  const probes = await openWindow(dm, "sync.probes");
  await probes.getByTestId("sync-drop-connection").click();
  await expect(status).not.toHaveAttribute("data-state", "live");
  await expect(status).toHaveAttribute("data-state", "live");
  await expect(card).toBeVisible();
  await expect(summary).toHaveAttribute("data-count", String(before + 1));
  await expect(dm.getByTestId("note-toast")).toHaveCount(1); // no per-item toasts replayed

  await dm.context().close();
});

test("FR-NOTE-24 a handled action leaves the bell: 1 while pending, none after Resolve (NOTE §13 step 12)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  // A opens Notifications (marks everything seen), then closes it.
  await openWindow(dm, "note.history");
  const badge = dm.getByTestId("note-launcher-badge");
  await expect(badge).toHaveCount(0);
  await shellWindow(dm, "note.history").getByTestId("ui-window-close").click();

  // B sends a test notification with an action; its owner is the DM.
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const pwin = await openWindow(player, "note.history");
  await pwin.getByTestId("note-test-text").fill("Apply 2 damage?");
  await pwin.getByTestId("note-test-label").fill("Apply");
  await pwin.getByTestId("note-test-send").click();

  const toast = dm.getByTestId("note-toast").filter({ hasText: "Apply 2 damage?" });
  await expect(toast).toHaveAttribute("data-sticky", "true");
  await expect(badge).toHaveAttribute("data-count", "1");
  await toast.getByTestId("note-toast-action").click();
  await expect(toast).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  const win = await openWindow(dm, "note.history");
  const row = win.getByTestId("note-history-row").filter({ hasText: "Apply 2 damage?" });
  await expect(row.getByTestId("note-history-state")).toHaveText("Resolved by DM");

  await player.context().close();
  await dm.context().close();
});
