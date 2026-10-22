// e2e-bundle: table-tools-e2e
// Roll requests (dice-extras §13 T4–T6; FR-DICEX-78, -79, -83, -91, FR-NOTE-59, -60): the open hidden
// Perception (DC 15) reaches player-1 and player-2 as pending prompts without the DC. Player-1
// rolls from the prompt → "Rolled N" and a hidden line only DM + player-1 see, and the total with
// ✓ / ✗ on the DM's Requests card only (FR-DICEX-85, -87); player-2 declines → the card closes.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow } from "./support/shell";

const live = (p: Page) =>
  expect(p.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/**
 * session-sim-10 presents a handout to Player 1 (a modal over the map): close it if it shows (a
 * spec of this bundle that ran first may have closed it already: the server remembers).
 */
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

test("FR-DICEX-78 FR-DICEX-79 FR-DICEX-83 FR-DICEX-91 FR-DICEX-87 FR-DICEX-88 FR-NOTE-59 hidden Perception: prompts without DC, Roll → hidden line (DM + roller), total ✓ / ✗ on the DM card, Decline closes it", async ({
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
  const frames2: string[] = [];
  p2.on("websocket", (ws) => ws.on("framereceived", (f) => frames2.push(String(f.payload))));
  await p2.goto(link("Player 2"));
  await live(p2);

  // T4 + FR-DICEX-91: the open prompt is back as a card toast after the load (no summary for it).
  for (const p of [p1, p2]) {
    const card = p.locator('[data-testid="note-toast"][data-class="card"]');
    await expect(card.getByTestId("dicex-prompt")).toHaveCount(1);
    await expect(card.getByTestId("dicex-prompt")).not.toContainText("DC");
    await expect(p.getByTestId("note-toast-pending-summary")).toHaveCount(0);
  }
  // Each player's pending prompt in the history, no DC.
  const prompt = (p: Page) =>
    p
      .locator(
        '[data-testid="ui-window"][data-record-id="note.history:main"] [data-testid="dicex-prompt"]',
      )
      .first();
  const h1 = await openWindow(p1, "note.history");
  await expect(prompt(p1)).toHaveAttribute("data-state", "pending");
  await expect(prompt(p1)).toContainText("DM: Perception");
  await expect(prompt(p1)).not.toContainText("DC");
  const h2 = await openWindow(p2, "note.history");
  await expect(prompt(p2)).toHaveAttribute("data-state", "pending");

  // T5: B rolls from the prompt → "Rolled N"; the hidden line reaches A (eye-off), never C.
  const dmLog = await openWindow(dm, "dice.log");
  const p2Log = await openWindow(p2, "dice.log");
  const asked = (log: typeof dmLog) =>
    log.getByTestId("dice-log-entry").filter({ hasText: "Mira" }).filter({ hasText: "Perception" });
  const [dmBefore, p2Before] = [await asked(dmLog).count(), await asked(p2Log).count()];
  await h1.getByTestId("dicex-prompt-roll").click();
  await expect(prompt(p1)).toHaveAttribute("data-state", "resolved");
  await expect(h1.getByTestId("dicex-prompt-outcome").first()).toHaveText(/^Rolled \d+$/);
  await expect(asked(dmLog)).toHaveCount(dmBefore + 1);
  // A: the Requests card: Mira's total with pass / fail, Thorn waiting; the launcher badge = 1.
  await expect(dm.getByTestId("dicex-launcher-badge")).toHaveAttribute("data-count", "1");
  const requests = await openWindow(dm, "dicex.requests");
  const card = requests.locator('[data-testid="dicex-request-card"][data-state="open"]');
  const row = (id: string) =>
    card.locator(`[data-testid="dicex-request-target-row"][data-record-id="${id}"]`);
  await expect(row(mira)).toHaveAttribute("data-state", "rolled");
  await expect(row(mira)).toHaveAttribute("data-total", /^\d+$/);
  await expect(row(mira)).toHaveAttribute("data-success", /^(true|false)$/);
  await expect(row(mira)).toContainText(/\d+ [✓✗]/);
  await expect(row(thorn)).toContainText("Waiting");
  await expect(asked(dmLog).last().getByTestId("dice-log-entry-hidden")).toHaveCount(1);
  await p2.waitForTimeout(300);
  await expect(asked(p2Log)).toHaveCount(p2Before);

  // T6: C declines → resolved "Declined".
  await h2.getByTestId("dicex-prompt-decline").click();
  await expect(prompt(p2)).toHaveAttribute("data-state", "resolved");
  await expect(h2.getByTestId("dicex-prompt-outcome").first()).toHaveText("Declined");
  const closed = requests.locator('[data-testid="dicex-request-card"][data-state="closed"]');
  await expect(
    closed.locator(`[data-testid="dicex-request-target-row"][data-record-id="${thorn}"]`),
  ).toHaveAttribute("data-state", "declined");
  await expect(
    launcherButton(dm, "dicex.requests").getByTestId("dicex-launcher-badge"),
  ).toHaveCount(0);

  // FR-DICEX-92: no request row, DC or pass / fail ever reaches C.
  for (const leak of ['"type":"roll-request"', '"success"', '"dc":15']) {
    expect([leak, frames2.some((f) => f.includes(leak))]).toEqual([leak, false]);
  }
  for (const page of [p1, p2, dm]) await page.context().close();
});
