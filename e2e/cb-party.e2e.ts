// e2e-bundle: cb-party-e2e
// Thin CB3 flows (CBTX §13.1 E2E, FR-PARTY-51–55; sprint 9: in Party Manager's Party status tab,
// FR-PARTY-61): player 1 opens Party Manager from the launcher at 1280×720 → the Party status tab
// first: own Mira and Brakka on top, Thorn "10/10" with "+5" temp and his AC, no monster row; the
// DM damages Thorn by 4 → player 1's row reads "+1" ≤ 1 s and the DM's tab shows the same; player
// 1's own row opens the sheet, Thorn's row has no action. Rows, figures and visibility per viewer:
// bun test (`status-tab.test.tsx`, `party-status.test.ts`, `party-manager.test.ts`).
import { type Browser, expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function page1280(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  return ctx.newPage();
}

test("FR-PARTY-51 FR-PARTY-52 FR-PARTY-55 FR-PARTY-61 Party status tab: player 1 sees Thorn's HP, temp HP and AC; DM damage → the row updates ≤ 1 s; own row opens the sheet", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("char-mira", "entity");
  const brakka = recordId("char-brakka", "entity");
  const thorn = recordId("char-thorn", "entity");
  const thornC = recordId("combat-1", "combatant", 1);

  const p1 = await page1280(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  // sim-11 presents an image to the party: close the popup first.
  const popup = p1.getByTestId("party-present-popup");
  if (await popup.count()) {
    await p1.getByTestId("party-present-close").click();
    await expect(popup).toHaveCount(0);
  }
  // In the launcher at 1280×720 (not the "⋯" menu), loads closed; opens on Party status.
  await expect(launcherButton(p1, "party.board")).toBeVisible();
  await expect(shellWindow(p1, "party.board")).toHaveCount(0);
  const win = await openWindow(p1, "party.board");
  await expect(win.locator('[data-testid="party-tab"][data-value="status"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const rows = win.getByTestId("party-summary-row");
  await expect(rows).toHaveCount(3);
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));
  expect(order.slice(0, 2).sort()).toEqual([mira, brakka].sort());
  expect(order[2]).toBe(thorn);
  const thornRow = win.locator(`[data-testid="party-summary-row"][data-record-id="${thorn}"]`);
  await expect(thornRow.getByTestId("party-summary-hp")).toHaveAttribute("data-value", "10/10");
  await expect(thornRow.getByTestId("party-summary-temp")).toHaveText("+5");
  await expect(thornRow.getByTestId("party-summary-ac")).toHaveAttribute("data-value", /^\d+$/);
  await expect(thornRow).toHaveAttribute("data-can-open", "false");
  // Monsters never: only PCs and owned companions.
  for (const name of ["Goblin", "Wolf", "Elite Goblin Warrior"]) {
    await expect(win.getByText(name, { exact: true })).toHaveCount(0);
  }

  // The DM damages Thorn by 4 (Initiative row menu → Damage / heal): the temp HP takes it.
  const dm = await page1280(browser);
  await loginDm(dm, secret);
  await live(dm);
  const init = await openWindow(dm, "cbt.initiative");
  const thornInit = init.locator(`li[data-testid="cbt-init-row"][data-record-id="${thornC}"]`);
  await thornInit.getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-hp-adjust").click();
  await dm.getByTestId("cbt-hp-amount").fill("4");
  const sent = Date.now();
  await dm.getByTestId("cbt-hp-damage").click();
  await expect(thornRow.getByTestId("party-summary-temp")).toHaveText("+1", { timeout: 1_000 });
  expect(Date.now() - sent).toBeLessThan(1_000);
  await expect(thornRow.getByTestId("party-summary-hp")).toHaveAttribute("data-value", "10/10");
  // The DM's Party status tab: the same numbers from the full record.
  const dmWin = await openWindow(dm, "party.board");
  const dmThorn = dmWin.locator(`[data-testid="party-summary-row"][data-record-id="${thorn}"]`);
  await expect(dmThorn.getByTestId("party-summary-temp")).toHaveText("+1");
  await expect(dmThorn).toHaveAttribute("data-can-open", "true");

  // FR-PARTY-54: player 1's own row opens Mira's sheet.
  await win.locator(`[data-testid="party-summary-row"][data-record-id="${mira}"]`).click();
  const sheet = shellWindow(p1, "char.sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("char-sheet-name")).toHaveText("Mira");
});
