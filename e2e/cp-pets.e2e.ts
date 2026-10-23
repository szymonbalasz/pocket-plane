// e2e-bundle: cp-pets-e2e
// Thin pets flow (CP1, CBT §13.3 C1 / C2 parts; ENT FR-ENT-32, -39; PARTY FR-PARTY-41–46):
// the DM's Party Manager → Party status → New pet…: "owl" → Owlbear, Pet of Mira, After the owner,
// Create (FR-PARTY-62); the DM and player-1 see "59 / 59" under Mira, player-2 no row (a pet not
// yet present); Creatures shows the "Pet of Mira" badge; the DM releases it from the row menu.
// Tabs fit at Party Manager's min width (FR-PARTY-46). Rules, visibility and leak scans: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const tab = (win: Locator, value: string) =>
  win.locator(`[data-testid="party-tab"][data-value="${value}"]`);

/** Party Manager on its Party status tab, where companions sit under their PCs (FR-PARTY-61). */
async function companions(page: Page): Promise<Locator> {
  const board = await openWindow(page, "party.board");
  await tab(board, "status").click();
  await expect(tab(board, "status")).toHaveAttribute("aria-selected", "true");
  await expect(board.getByTestId("party-status")).toBeVisible();
  return board;
}

/** Drags the window's resize corner by (dx, dy); the shell clamps to the min size. */
async function resizeBy(page: Page, win: Locator, dx: number, dy: number) {
  const h = await win.getByTestId("ui-window-resize").boundingBox();
  if (!h) throw new Error("no resize handle");
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up();
}

test("FR-ENT-32 FR-PARTY-41 FR-PARTY-42 FR-ENT-39 FR-PARTY-43 New pet: owl → Owlbear for Mira; owner sees HP, player-2 nothing; Creatures badge; release", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  const board = await companions(dm);
  // FR-PARTY-62: no companions → nothing under the PCs (no empty line).
  await expect(board.getByTestId("party-summary-row").first()).toBeVisible();
  await expect(board.getByTestId("party-companion-row")).toHaveCount(0);
  const b1 = await companions(p1);
  const b2 = await companions(p2);
  await expect(b2.getByTestId("party-companion-row")).toHaveCount(0);
  await expect(b2.getByTestId("party-companion-new")).toHaveCount(0);

  // C1: New pet… → "owl" → Owlbear; Pet of Mira; After the owner; Create.
  await board.getByTestId("party-companion-new").click();
  const dialog = dm.getByTestId("ent-pet-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("ent-pet-submit")).toBeDisabled();
  await dialog.getByTestId("ent-pet-lookup").fill("owl");
  const owl = dm.getByTestId("cbt-lookup-option").filter({ hasText: "Owlbear" });
  await expect(owl.first()).toBeVisible();
  await owl.first().click();
  await expect(dialog.getByTestId("ent-pet-base")).toContainText("Owlbear");
  await dialog.getByTestId("ent-pet-owner").click();
  await dm.getByTestId("ent-pet-owner-option").filter({ hasText: "Mira" }).click();
  await expect(dialog.getByTestId("ent-pet-name")).toHaveValue("Owlbear");
  const mode = (v: string) => dialog.locator(`[data-testid="ent-pet-mode"][data-value="${v}"]`);
  await expect(mode("after-owner")).toHaveAttribute("data-state", "on");
  await dialog.getByTestId("ent-pet-submit").click();
  await expect(dialog).toBeHidden();

  const row = (win: Locator) =>
    win.getByTestId("party-companion-row").filter({ hasText: "Owlbear" });
  await expect(row(board)).toBeVisible();
  await expect(row(board).getByTestId("party-companion-hp")).toHaveAttribute("data-value", "59/59");
  await expect(row(board).getByTestId("party-companion-mode-icon")).toHaveAttribute(
    "data-value",
    "after-owner",
  );
  await expect(row(board).getByTestId("party-companion-base")).toHaveText("Owlbear");
  const group = board.getByTestId("party-companion-group").filter({ hasText: "Mira" });
  await expect(group.getByTestId("party-companion-row")).toHaveCount(1);
  // Owner: HP numbers; another player: nothing at all (not present yet, FR-ENT-37).
  await expect(row(b1).getByTestId("party-companion-hp")).toHaveAttribute("data-value", "59/59");
  await expect(b2.getByTestId("party-companion-row")).toHaveCount(0);

  // C2 part: Creatures lists it with the customs, badged "Pet of Mira".
  const creatures = await openWindow(dm, "ent.creatures");
  // FR-ENT-39 (walkthrough step 7): at the default width every row's name stays readable beside
  // its actions (Make pet… added one): the name line ≥ 96 px, the name text visible.
  await expect(creatures.getByTestId("ent-list-row").first()).toBeVisible();
  const widths = await creatures
    .getByTestId("ent-list-row-main")
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(widths.length).toBeGreaterThan(3);
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(96);
  expect(
    await creatures
      .getByTestId("ent-list-row-name")
      .evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width < 24).length),
  ).toBe(0);
  await creatures.getByTestId("ent-list-search").fill("owlbear");
  await expect(creatures.getByTestId("ent-list-row-pet")).toHaveText("Pet of Mira");
  // Make pet… on the row prefills the creature; the name rule gives "Owlbear (Mira)".
  const petRow = creatures
    .getByTestId("ent-list-row")
    .filter({ has: dm.getByTestId("ent-list-row-pet") });
  await petRow.getByTestId("ent-pet-make").click();
  await expect(dialog.getByTestId("ent-pet-base")).toContainText("Owlbear");
  await dialog.getByTestId("ent-pet-owner").click();
  await dm.getByTestId("ent-pet-owner-option").filter({ hasText: "Mira" }).click();
  await expect(dialog.getByTestId("ent-pet-name")).toHaveValue("Owlbear (Mira)");
  await dialog.getByTestId("ent-pet-name").fill("owlbear");
  await expect(dialog.getByTestId("ent-pet-name-error")).toHaveText("Name taken");
  await expect(dialog.getByTestId("ent-pet-submit")).toBeDisabled();
  await dm.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // FR-PARTY-43: Release… → confirm → a plain creature: gone from every list. Creatures at its
  // useful size may have auto-minimised Party (FR-SHELL-77): bring it back first.
  await openWindow(dm, "party.board");
  await row(board).getByTestId("party-companion-menu").click();
  await dm.getByTestId("party-companion-release").click();
  await dm.getByTestId("party-companion-release-confirm").click();
  await expect(board.getByTestId("party-companion-row")).toHaveCount(0);
  await expect(b1.getByTestId("party-companion-row")).toHaveCount(0);
  await expect(creatures.getByTestId("ent-list-row-pet")).toHaveCount(0);

  for (const page of [p2, p1, dm]) await page.context().close();
});

test("FR-PARTY-46 tabs fit at min width: every label whole, the strip scrolls to Loot", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const board = await openWindow(p1, "party.board");
  // Narrow past the min width: the shell clamps at 340 px.
  const now = (await board.boundingBox())?.width ?? 0;
  await resizeBy(p1, board, 340 - now - 100, 0);
  await expect.poll(async () => Math.round((await board.boundingBox())?.width ?? 0)).toBe(340);
  const strip = board.getByTestId("party-tabs");
  const cut = await strip.evaluate((list) =>
    [...list.querySelectorAll('[data-testid="party-tab"]')].flatMap((t) => {
      const el = t as HTMLElement;
      // A label is cut if its text overflows its trigger.
      return el.scrollWidth > el.clientWidth + 1 ? [el.textContent ?? ""] : [];
    }),
  );
  expect(cut).toEqual([]);
  const lastTab = tab(board, "loot");
  await lastTab.scrollIntoViewIfNeeded();
  await expect(lastTab).toBeInViewport();
  const s = await strip.boundingBox();
  const c = await lastTab.boundingBox();
  if (!s || !c) throw new Error("no boxes");
  // Wholly inside the visible strip after scrolling.
  expect(c.x).toBeGreaterThanOrEqual(s.x - 1);
  expect(c.x + c.width).toBeLessThanOrEqual(s.x + s.width + 1);
  await lastTab.click();
  await expect(board.getByTestId("loot-log")).toBeVisible();
  await p1.context().close();
});
