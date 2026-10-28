// e2e-bundle: s14-toasts-e2e
// Thin sprint-14 F2 flows on session-sim-13 (a started fight, sim-12's pending cards). BL-137: a
// player's own attack card, pending on the DM, is listed under "Waiting" in their Notifications,
// never under History. BL-131: Initiative squeezed to 380 high with its Pending cards keeps a
// two-row list (Pending lines capped, the rest scroll). BL-137: Next turn scrolls the
// row list to the active row.
// Rules: bun test (`alerts-fold.test.ts`, `keep-out-s14.test.ts`, `popup-place.test.ts`,
// combat-tracker `pending-cap.test.ts`, server `waiting-leak.test.ts`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function rect(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

/** Drags the window's resize corner by (dx, dy); the shell clamps to the min size. */
async function resizeBy(page: Page, win: Locator, dx: number, dy: number) {
  const h = await rect(win.getByTestId("ui-window-resize"));
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up();
}

/**
 * The rows whose name line (their top 24 px) shows in the row list's box (a row with in-turn
 * companion lines is taller than the list's two-row minimum), and the list's height.
 */
async function rowsInView(init: Locator): Promise<{ rows: number; listH: number }> {
  const list = await rect(init.getByTestId("cbt-init-list"));
  let rows = 0;
  for (const r of await init.getByTestId("cbt-init-row").all()) {
    const b = await r.boundingBox();
    if (b && b.y >= list.y - 1 && b.y + 24 <= list.y + list.height + 1) rows++;
  }
  return { rows, listH: Math.round(list.height) };
}

test("BL-137 BL-131 FR-NOTE-17 FR-CBT-77: Player 1's card waits under Waiting; Initiative at 380 high keeps a 112-px row list (2 names) beside its Pending lines and scrolls to the turn's row", async ({
  browser,
}) => {
  const env = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, env.secret);
  await live(dm);
  await dm.getByTestId("ui-launcher-menu").click();
  await dm.getByTestId("ui-launcher-reset").click();
  const player = await rolePage(browser);
  await player.setViewportSize({ width: 1280, height: 720 });
  await player.goto(env.link("Player 1"));
  await live(player);
  const present = player.getByTestId("party-present-popup");
  if (
    await present.waitFor({ timeout: 3_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await present.getByTestId("party-present-close").click();
  }

  // Two "Attack + damage" cards from Player 1's sheet: pending on the DM.
  const init = await openWindow(dm, "cbt.initiative");
  const cards = init.getByTestId("cbt-init-card");
  const before = await cards.count();
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  for (let i = 1; i <= 2; i++) {
    await sheet.getByTestId("charx-roll-attack-damage").first().click();
    await expect(cards).toHaveCount(before + i);
  }
  await player.getByTestId("ui-window-close").first().click();

  // BL-137: the player's Notifications: their cards under Waiting, History holds no pending row.
  const notes = await openWindow(player, "note.history");
  const waiting = notes.getByTestId("note-history-waiting");
  await expect(waiting.getByTestId("note-history-row")).not.toHaveCount(0);
  await expect(waiting).toContainText("Waiting");
  await expect(
    notes.locator(
      '[data-testid="note-history-closed"] [data-testid="note-history-row"][data-state="pending"]',
    ),
  ).toHaveCount(0);

  // BL-131: Initiative squeezed to 380 high: ≤ 2 Pending lines, 2 combatant rows whole.
  const h = (await rect(init)).height;
  await resizeBy(dm, init, 0, 380 - h);
  await expect.poll(async () => Math.round((await rect(init)).height)).toBe(380);
  const lines = init.getByTestId("cbt-init-pending-lines");
  await expect(lines).toHaveAttribute("data-lines", /^[12]$/);
  await expect.poll(async () => (await rowsInView(init)).rows).toBeGreaterThanOrEqual(2);
  expect((await rowsInView(init)).listH).toBeGreaterThanOrEqual(112);

  // BL-137: each Next keeps the turn's row in the list's box (the list scrolls to it).
  for (let i = 0; i < 6; i++) {
    await init.getByTestId("cbt-init-next").click();
    const turn = init.locator('[data-testid="cbt-init-row"][data-turn="true"]');
    await expect(turn).toHaveCount(1);
    await expect
      .poll(async () => {
        const list = await rect(init.getByTestId("cbt-init-list"));
        const r = await rect(turn);
        return r.y >= list.y - 1 && r.y + r.height <= list.y + list.height + 1;
      })
      .toBe(true);
  }
  await player.context().close();
  await dm.context().close();
});
