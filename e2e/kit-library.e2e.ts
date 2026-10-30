// e2e-bundle: kit-library
// Thin kit-parity K4 flow (§6.8–6.9): the DM's compendium is a table (sticky Name · Details ·
// Source head, the kit's 30-px rows since K13) and the Goblin opens as the kit card (one ruled
// AC · HP · Speed row, a six-column ability grid); Party status shows kit cards (medallion, level line, AC shield, HP
// bar) with the pet under Mira; player-1's sheet header has the square 56-px portrait. Markup,
// visibility and every FR detail: bun test (compendium, party-board, entities, character-sheet).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Drags the window's resize grip until the window is `w × h`. */
async function resizeTo(page: Page, win: Locator, w: number, h: number) {
  const box = await win.boundingBox();
  const grip = await win.getByTestId("ui-window-resize").boundingBox();
  if (!box || !grip) throw new Error("window not shown");
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++)
    await page.mouse.move(x + ((w - box.width) * i) / 5, y + ((h - box.height) * i) / 5);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = await win.boundingBox();
      return b && [Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([w, h]);
}

const LONG = "Grey Wolf with a really long companion name";

test("FR-KIT-76 FR-KIT-77 FR-KIT-82 FR-KIT-83 FR-KIT-85 kit library: compendium table + stat block card, party cards, sheet header", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  // FR-KIT-76: the table head over one-line rows; the Goblin row's details beside its name.
  const cmp = await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-search").fill("goblin");
  await expect(cmp.getByTestId("cmp-table-head")).toHaveText("NameDetailsSource");
  const goblin = cmp
    .getByTestId("cmp-result")
    .filter({ has: dm.getByTestId("cmp-result-name").getByText("Goblin", { exact: true }) })
    .first();
  await expect(goblin).toContainText("CR 1/4");
  const h = Math.round((await goblin.boundingBox())?.height ?? 0);
  // K13 (DM #363): the kit's 30-px rows.
  expect(h).toBeGreaterThanOrEqual(28);
  expect(h).toBeLessThanOrEqual(32);

  // FR-KIT-77: the card's ruled core row and the ability grid.
  await goblin.click();
  const core = cmp.getByTestId("cmp-statblock-core");
  await expect(core).toContainText("AC 15");
  await expect(core).toContainText("HP 7 (2d6)");
  await expect(core).toContainText("Speed");
  await expect(cmp.getByTestId("cmp-statblock-score")).toHaveCount(6);
  await expect(cmp.locator('[data-testid="cmp-statblock-score"][data-value="dex"]')).toHaveText(
    "DEX14+2",
  );
  // Evidence for the walkthrough (a fresh browser is Gilt & Stone, DM #355).
  await cmp.screenshot({ path: test.info().outputPath("app-statblock-gilt.png") });
  await cmp.getByTestId("cmp-back").click();
  await expect(cmp.getByTestId("cmp-table-head")).toBeVisible();
  await cmp.screenshot({ path: test.info().outputPath("app-compendium-gilt.png") });
  await cmp.getByTestId("ui-window-close").click();

  // FR-KIT-82 / -83: Mira's card and her pet's small medallion.
  const board = await openWindow(dm, "party.board");
  const mira = board.getByTestId("party-summary-row").filter({ hasText: "Mira" });
  await expect(mira.getByTestId("party-summary-medallion")).toHaveText("M");
  await expect(mira.getByTestId("party-summary-line")).toHaveText(/^Level \d+/);
  await expect(mira.getByTestId("party-summary-ac")).toHaveAttribute("aria-label", /^Armor Class/);
  await expect(mira.getByTestId("party-summary-hp").getByTestId("kit-hpbar")).toBeVisible();
  const owl = board.getByTestId("party-companion-row").filter({ hasText: "Owlbear" });
  await expect(owl.getByTestId("party-companion-medallion")).toHaveText("O");
  await board.screenshot({ path: test.info().outputPath("app-party-gilt.png") });

  // FR-KIT-83 (K4 walkthrough): a long companion name keeps the row on one line (truncated, the
  // full name in its Tooltip); at the 440 × 400 useful size every card and companion row is whole.
  await owl.getByTestId("party-companion-menu").click();
  await dm.getByTestId("party-companion-rename").click();
  await dm.getByTestId("party-companion-name-input").fill(LONG);
  await dm.getByTestId("party-companion-save").click();
  const longRow = board.getByTestId("party-companion-row").filter({ hasText: LONG });
  await expect(longRow).toHaveCount(1);
  await resizeTo(dm, board, 440, 400);
  const clip = await board
    .locator('[data-testid="party-status"] [data-radix-scroll-area-viewport]')
    .boundingBox();
  const rows = board.locator(
    '[data-testid="party-summary-row"], [data-testid="party-companion-row"]',
  );
  for (const r of await rows.all()) {
    const b = await r.boundingBox();
    expect(b && clip && b.y + b.height <= clip.y + clip.height + 0.5).toBe(true);
  }
  // At the minimum width (340) the name truncates; the row stays one line.
  await resizeTo(dm, board, 340, 400);
  expect(Math.round((await longRow.boundingBox())?.height ?? 0)).toBeLessThanOrEqual(24);
  const name = longRow.getByTestId("party-companion-name");
  expect(await name.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  // Nothing runs past the window's right edge (cards and rows keep the window's width).
  const right = ((await board.boundingBox())?.x ?? 0) + 340;
  for (const r of await rows.all())
    expect(
      ((await r.boundingBox())?.x ?? 0) + ((await r.boundingBox())?.width ?? 0),
    ).toBeLessThanOrEqual(right);
  await name.hover();
  await expect(dm.getByRole("tooltip").filter({ hasText: LONG })).toBeVisible();
  await board.screenshot({ path: test.info().outputPath("app-party-long-name-gilt.png") });

  // FR-KIT-85 (K4 walkthrough): an imported NPC's sheet at the default 320 px: the name is
  // readable (never "G.."), Derive to customise is a small button.
  const creatures = await openWindow(dm, "ent.creatures");
  await creatures.getByTestId("ent-list-custom-only").click(); // on by default: show the SRD rows
  await creatures.getByTestId("ent-list-search").fill("goblin");
  const gobRow = creatures
    .getByTestId("ent-list-row")
    .filter({ has: dm.getByTestId("ent-list-row-lock") })
    .filter({ has: dm.getByTestId("ent-list-row-name").getByText("Goblin", { exact: true }) })
    .first();
  await gobRow.getByTestId("charx-open-sheet").click();
  const npc = shellWindow(dm, "char.sheet");
  await expect(npc.getByTestId("char-sheet-name")).toHaveText("Goblin");
  const nm = npc.getByTestId("char-sheet-name").locator("span").last();
  expect(await nm.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  const derive = await npc.getByTestId("charx-derive").boundingBox();
  expect(Math.round(derive?.height ?? 0)).toBe(24);
  await npc.screenshot({ path: test.info().outputPath("app-npc-sheet-gilt.png") });

  // FR-KIT-85: player-1's sheet header, the square framed portrait (K11: the kit's 64 px).
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const sheet = await openWindow(p1, "char.sheet");
  await expect(sheet.getByTestId("char-sheet-name")).toHaveText("Mira");
  const box = await sheet.getByTestId("char-sheet-portrait").boundingBox();
  expect([Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)]).toEqual([64, 64]);
  await expect(sheet.getByTestId("charx-edit-toggle")).toBeVisible();
  await sheet.screenshot({ path: test.info().outputPath("app-sheet-gilt.png") });

  for (const page of [p1, dm]) await page.context().close();
});
