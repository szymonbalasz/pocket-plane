// e2e-bundle: h4-rules-e2e
// Sprint 10 H4 (BL-98, BL-102, BL-104): the palette's rule rows and the Compendium's Open in
// Rules land ON the card (its page, expanded, its heading in view), whether Rules was closed or
// already open; a card's `srd:` link tokens read as words and open their card in the window;
// indented quotes render as quotes (no literal ">"); a DM-only house rule is marked collapsed.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

const card = (win: Locator, name: string) =>
  win.locator('[data-testid="cmp-rules-card"]').filter({
    has: win.page().locator("span.font-medium", { hasText: new RegExp(`^${name}$`) }),
  });

/** The card's heading row lies whole inside every scrolling box around it (and the viewport). */
async function headingInView(c: Locator): Promise<boolean> {
  return c.evaluate((el) => {
    const head = el.querySelector("button")?.getBoundingClientRect();
    if (!head || head.height === 0) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (!/(auto|scroll)/.test(s.overflowY)) continue;
      const r = p.getBoundingClientRect();
      if (head.top < r.top - 0.5 || head.bottom > r.bottom + 0.5) return false;
    }
    return head.top >= 0 && head.bottom <= window.innerHeight;
  });
}

/** Open, its heading in view, and still so a moment later (no late jump). */
async function landed(c: Locator) {
  await expect(c).toHaveAttribute("data-state", "open");
  await expect.poll(() => headingInView(c), { timeout: 5_000 }).toBe(true);
  await c.page().waitForTimeout(600);
  expect(await headingInView(c)).toBe(true);
}

async function paletteOpen(page: Page, q: string, name: string) {
  await page.getByTestId("map-canvas").focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("ui-palette")).toBeVisible();
  await page.getByTestId("ui-palette-input").fill(q);
  const row = page
    .locator('[data-testid="ui-palette-item"][data-value="Rules"]')
    .filter({ hasText: name })
    .first();
  await row.click();
  await expect(page.getByTestId("ui-palette")).toBeHidden();
}

test("FR-CMP-66 FR-CMP-69 BL-98 DM: palette 'cover' lands on the Cover card from closed Rules; 'opportunity' and Open in Rules land on theirs with Rules open", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  // Rules closed → the palette opens it on the Combat page at Cover.
  await expect(shellWindow(dm, "cmp.rules")).toHaveCount(0);
  await paletteOpen(dm, "cover", "Cover");
  const win = shellWindow(dm, "cmp.rules");
  await expect(win.getByTestId("cmp-rules-window")).toHaveAttribute("data-value", "combat");
  await landed(card(win, "Cover"));

  // Already open, scrolled to the top: "opportunity" lands on Opportunity Attacks.
  await win.getByTestId("cmp-rules-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await paletteOpen(dm, "opportunity", "Opportunity Attacks");
  await landed(card(win, "Opportunity Attacks"));

  // Compendium → a rule entry → Open in Rules (Rules open) lands on Grappling.
  const cmp = await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-search").fill("grappling");
  await cmp.getByTestId("cmp-result").filter({ hasText: "Grappling" }).first().click();
  await cmp.getByTestId("cmp-rule-open").click();
  await landed(card(win, "Grappling"));

  // …and with Rules closed first.
  await win.getByTestId("ui-window-close").click();
  await expect(win).toHaveCount(0);
  // (The placer may have put the Compendium away while Rules was in front: FR-SHELL-152.)
  await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-rule-open").click();
  await landed(card(shellWindow(dm, "cmp.rules"), "Grappling"));
});

test("FR-CMP-61 FR-CMP-67 BL-102 BL-104 DM: Grappling reads 'grappled' (a link to the Grappled card) and quotes Contests in Combat; the DM-only house rule is marked collapsed", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const win = await openWindow(dm, "cmp.rules");
  const grappling = card(win, "Grappling");
  await grappling.getByRole("button", { name: /Grappling/ }).click();
  await expect(grappling).toHaveAttribute("data-state", "open");
  await expect(grappling).toContainText("you subject the target to the grappled condition.");
  await expect(grappling).not.toContainText("srd:");
  const quote = grappling.locator("blockquote");
  await expect(quote).toContainText("Contests in Combat");
  await expect(quote).toContainText("Battle often involves pitting your prowess");
  expect(await grappling.innerText()).not.toMatch(/(^|\n)\s*>/);

  await grappling.locator('[data-testid="cmp-rules-link"][data-value="grappled"]').click();
  await expect(win.getByTestId("cmp-rules-window")).toHaveAttribute("data-value", "conditions");
  await landed(card(win, "Grappled"));

  // (Keyboard: the pending-requests toast may sit over the tabs, BL-101.)
  await win.locator('[data-testid="cmp-rules-page"][data-value="house"]').focus();
  await expect(win.getByTestId("cmp-rules-window")).toHaveAttribute("data-value", "house");
  const fumbles = win.getByTestId("cmp-rules-card").filter({ hasText: "Critical fumbles" });
  await expect(fumbles).toHaveAttribute("data-state", "closed");
  await expect(fumbles.getByTestId("cmp-rules-dm-only")).toBeVisible();
  const flanking = win.getByTestId("cmp-rules-card").filter({ hasText: "Flanking" });
  await expect(flanking.getByTestId("cmp-rules-dm-only")).toHaveCount(0);
});
