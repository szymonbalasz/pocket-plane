// e2e-bundle: sp-rules-e2e
// Thin Rules window flow (CMP §13.3 E2E): player-1 opens Rules from the launcher → Combat → the
// Cover card's SRD text; About shows the SRD 5.1 statement and the "split into cards" line; House
// rules lists only the shared one. The DM's House rules lists both, the hidden one marked. Page
// bodies, ETags, visibility and leak scans: bun test (compendium rules-rest.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** session-sim-9 presents the "Thieves' Map" handout to player-1 (until the first close). */
async function closePresented(page: Page) {
  await page
    .getByTestId("party-present-close")
    .click({ timeout: 3_000 })
    .catch(() => {});
}

/** FR-CMP-66: a page tab, or below 420 px the Select's option (rendered in a portal). */
async function pickPage(page: Page, win: Locator, id: string) {
  const select = win.getByTestId("cmp-rules-page-select");
  if (await select.isVisible()) await select.click();
  const scope = (await select.isVisible()) ? page : win;
  await scope.locator(`[data-testid="cmp-rules-page"][data-value="${id}"]`).click();
  await expect(win.getByTestId("cmp-rules-window")).toHaveAttribute("data-value", id);
}

test("FR-CMP-63 FR-CMP-66 FR-CMP-68 FR-CMP-70 player-1 reads Cover on the Combat page, About credits the SRD; House rules shared only (DM sees both)", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();

  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresented(p1);
  const win = await openWindow(p1, "cmp.rules");
  await expect(win.getByTestId("cmp-rules-window")).toHaveAttribute("data-value", "combat");
  const cover = win.locator('[data-testid="cmp-rules-card"]').filter({ hasText: /^Cover/ });
  await expect(cover).toHaveAttribute("data-state", "closed");
  await cover.getByRole("button", { name: /Cover/ }).click();
  await expect(cover).toHaveAttribute("data-state", "open");
  await expect(cover).toContainText("half cover");
  await expect(cover).toContainText("SRD 5.1");

  await win.getByTestId("cmp-rules-about").click();
  const about = p1.getByTestId("cmp-about-dialog");
  await expect(about.getByTestId("cmp-about-text")).toContainText("System Reference Document 5.1");
  await expect(about.getByTestId("cmp-about-rules")).toHaveText(
    "Rules text from the SRD 5.1, split into cards at its headings and reformatted; wording unchanged.",
  );
  await p1.keyboard.press("Escape");

  await pickPage(p1, win, "house");
  const house = win.getByTestId("cmp-rules-card");
  await expect(house).toHaveCount(1);
  await expect(house).toContainText("Flanking");

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const dmWin = await openWindow(dm, "cmp.rules");
  await pickPage(dm, dmWin, "house");
  await expect(dmWin.getByTestId("cmp-rules-card")).toHaveCount(2);
  const secretCard = dmWin.getByTestId("cmp-rules-card").filter({ hasText: "Critical fumbles" });
  await secretCard.getByRole("button", { name: /Critical fumbles/ }).click();
  await expect(secretCard).toContainText("DM only");
  await expect(dmWin.getByTestId("cmp-rules-new-house")).toBeVisible();
});

test("FR-CMP-63 useful size (FR-SHELL-100 criterion): at 420 × 360 on 1280×720 the page Tabs and three card headings show whole", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 720 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresented(p1);
  const win = await openWindow(p1, "cmp.rules");
  const box = await win.boundingBox();
  const handle = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !handle) throw new Error("window not shown");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await p1.mouse.move(x, y);
  await p1.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await p1.mouse.move(x + ((420 - box.width) * i) / 5, y + ((360 - box.height) * i) / 5);
  }
  await p1.mouse.up();
  await expect
    .poll(async () => {
      const b = await win.boundingBox();
      return b && [Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([420, 360]);
  await expect(win.getByTestId("cmp-rules-page-select")).toHaveCount(0);
  await expect(win.locator('[data-testid="cmp-rules-page"]')).toHaveCount(8);
  const m = await win.getByTestId("ui-window-body").evaluate((body) => {
    const b = body.getBoundingClientRect();
    const whole = (sel: string) =>
      [...body.querySelectorAll(sel)].filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.height > 0 &&
          r.top >= b.top - 0.5 &&
          r.bottom <= b.bottom + 0.5 &&
          r.left >= b.left - 0.5 &&
          r.right <= b.right + 0.5
        );
      }).length;
    return {
      tabs: whole('[data-testid="cmp-rules-page"]'),
      cards: whole('[data-testid="cmp-rules-card"]'),
    };
  });
  console.log(`useful-size cmp.rules: ${JSON.stringify(m)}`);
  expect(m.tabs).toBe(8);
  expect(m.cards).toBeGreaterThanOrEqual(3);
});
