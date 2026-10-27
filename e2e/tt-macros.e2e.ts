// e2e-bundle: table-tools-e2e
// Saved macros (dice-extras §13 T1–T3; FR-DICEX-66–71): the tray's Macros popover per viewer
// (player-1 Sneak Attack + Luck, player-2 Inspiration read-only); Sneak Attack rolls a plain
// `dice.roll` line the DM sees; "Save as macro" from the tray's Options files a new one under Mira,
// unseen by player-2.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSelect } from "./support/select";
import { openWindow, shellWindow } from "./support/shell";

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

test("FR-DICEX-66 FR-DICEX-68 FR-DICEX-69 FR-DICEX-70 tray macros per player; a macro rolls dice.roll; Save as macro", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const sneak = recordId("dicex-macros", "roll-macro", 0);
  const insp = recordId("dicex-macros", "roll-macro", 3);
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresented(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  const macros = (p: Page) => p.locator('[data-testid="dicex-macros"] [data-testid="dicex-macro"]');
  const names = async (p: Page) =>
    (await macros(p).getByTestId("dicex-macro-roll").allTextContents()).map((s) => s.trim());

  // T1: B sees Sneak Attack (Mira) and Luck; C only Inspiration, without ✎.
  const tray = await openWindow(p1, "dicex.tray");
  await tray.getByTestId("dicex-tray-macros").click();
  await expect(macros(p1)).toHaveCount(2);
  expect(await names(p1)).toEqual(["Sneak Attack", "Luck"]);
  const tray2 = await openWindow(p2, "dicex.tray");
  await tray2.getByTestId("dicex-tray-macros").click();
  await expect(macros(p2)).toHaveCount(1);
  await expect(macros(p2).first()).toHaveAttribute("data-record-id", insp);
  await expect(macros(p2).getByTestId("dicex-macro-edit")).toHaveCount(0);
  await p2.keyboard.press("Escape");

  // T2 (server roll): Sneak Attack → a "Sneak Attack" line in the DM's log.
  const dmLog = await openWindow(dm, "dice.log");
  await p1.locator(`[data-testid="dicex-macro-roll"][data-record-id="${sneak}"]`).click();
  await expect(dmLog.getByTestId("dice-log-entry").filter({ hasText: "Sneak Attack" })).toHaveCount(
    1,
  );
  await p1.keyboard.press("Escape");

  // T3: tray `1d20+2` → Options → Save as macro → name it → Save → under Mira, first after ↑.
  await tray.getByTestId("dicex-tray-palette").first().click(); // a fresh free request
  await tray.getByTestId("dicex-tray-expression").fill("1d20+2");
  await tray.getByTestId("dicex-tray-options").click();
  await pickSelect(tray, "dicex-tray-actor", { label: "Mira" });
  await tray.getByTestId("dicex-tray-save-macro").click();
  const form = p1.getByTestId("dicex-macro-form");
  await expect(form.getByTestId("dicex-macro-expression")).toHaveValue("1d20+2");
  await form.getByTestId("dicex-macro-name").fill("Quick");
  await form.getByTestId("dicex-macro-save").click();
  await expect(p1.getByTestId("dicex-macros")).toBeVisible();
  await expect.poll(() => names(p1)).toEqual(["Sneak Attack", "Quick", "Luck"]);
  await expect(macros(p2)).toHaveCount(0); // popover closed; reopen to check C again
  await tray2.getByTestId("dicex-tray-macros").click();
  await expect(macros(p2)).toHaveCount(1);
  await expect(shellWindow(p2, "dicex.tray")).toBeVisible();

  for (const page of [p1, p2, dm]) await page.context().close();
});
