// e2e-bundle: kit-notices
// Kit parity K3 (kit-parity §6.5–6.6, §13): the notices and the damage card at 1440×900. Player-1
// rolls Attack + damage from the sheet → the DM's card toast: Medallion lead, text block with the
// relative time, the action inline. Its action opens the popup: title bar with the Later gem,
// Result-box lines, a compact target row; Apply resolves it and player-1's Notifications row shows
// the damage in a Result box. The DM's Next turn shows the turn card first in the stack.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-KIT-55 FR-KIT-57 FR-KIT-62 FR-KIT-64 FR-KIT-66 FR-KIT-59 card toast inline action → popup Apply → the player's boxed outcome; the DM's turn card", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);

  // Player-1: sheet Attack + damage → a damage card toast on the DM's stack.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet.getByTestId("charx-roll-attack-damage").first().click();
  const toast = dm.getByTestId("note-toast").filter({ has: dm.getByTestId("note-toast-action") });
  await expect(toast).toHaveCount(1);
  const cardId = (await toast.getAttribute("data-record-id")) as string;

  // FR-KIT-55 / -56: the causing player's medallion, the text, "just now" under it.
  await expect(toast.locator('[data-slot="kit-medallion"]')).toHaveText("P");
  await expect(toast.getByTestId("note-time")).toHaveText("just now");
  // FR-KIT-57: the action sits beside the text block (right of it or, too narrow, under it) and
  // the close is the card's last control, at its right edge.
  const card = await toast.boundingBox();
  const text = await toast.locator('[data-slot="toast-text"]').boundingBox();
  const action = await toast.getByTestId("note-toast-action").boundingBox();
  const close = await toast.getByTestId("note-toast-close").boundingBox();
  if (!card || !text || !action || !close) throw new Error("no toast boxes");
  const beside = action.x >= text.x + text.width - 1;
  const under = action.y >= text.y + text.height - 1;
  expect(beside || under).toBe(true);
  expect(close.x).toBeGreaterThan(action.x);
  expect(close.x + close.width).toBeGreaterThan(card.x + card.width - 24);

  // FR-KIT-62–65: the popup as a window.
  await toast.getByTestId("note-toast-action").click();
  const popup = dm.locator(`[data-testid="cbt-popup"][data-record-id="${cardId}"]`);
  await expect(popup).toBeVisible();
  const bar = popup.getByTestId("cbt-popup-drag");
  await expect(bar.locator("h2")).toHaveText(/^Mira — /);
  await expect(bar.getByTestId("cbt-popup-later")).toBeVisible();
  await expect(popup.locator('[data-slot="card-footer"]')).not.toContainText("Later");
  await expect(popup.getByTestId("cbt-popup-damage")).toHaveAttribute("data-slot", "kit-result");
  // A target: Goblin 2 from Add target → one compact row (Medallion + name · AC chip).
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.getByTestId("cbt-popup-target-option").filter({ hasText: "Goblin 2" }).click();
  const row = popup.getByTestId("cbt-popup-target-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-slot="card-target-chip"]')).toContainText("Goblin 2");
  const chip = await row.locator('[data-slot="card-target-chip"]').boundingBox();
  const mult = await row.getByTestId("cbt-popup-target-mult").boundingBox();
  if (!chip || !mult) throw new Error("no row boxes");
  expect(Math.abs(chip.y + chip.height / 2 - (mult.y + mult.height / 2))).toBeLessThan(4);
  // Hit (a manual total may miss the AC), then Apply.
  const hit = row.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);

  // FR-KIT-66: player-1's Notifications row: the outcome with the damage in a Result box.
  const history = await openWindow(p1, "note.history");
  const outcome = history
    .locator(`[data-testid="note-history-row"][data-record-id="${cardId}"]`)
    .getByTestId("cbt-card-outcome");
  await expect(outcome).toHaveAttribute("data-value", "resolved");
  await expect(outcome).toHaveText(/^Hit Goblin 2: \d+$/);
  await expect(outcome.locator('[data-slot="kit-result"]')).toHaveAttribute(
    "data-outcome",
    "damage",
  );

  // FR-KIT-59 (OQ-KIT-03 A): Next turn → the DM's turn card heads the stack.
  await init.getByTestId("cbt-init-next").click();
  const turnCard = dm.getByTestId("note-toasts").getByTestId("cbt-turn-card");
  await expect(turnCard).toHaveText(/^.+'s turn$/);
  await expect(turnCard.locator('[data-slot="turn-card-gem"]')).toHaveCount(2);

  await p1.context().close();
  await dm.context().close();
});
