// e2e-bundle: cb-reorder-e2e
// Thin CB1 flows (CBTX §13.1 E2E): the DM drags Thorn to the top of the 12-tie with the mouse →
// player 2's Initiative shows Thorn first of the tie ≤ 1 s, a reload keeps it; the drop line's
// "→ 18" and Esc (nothing sent); Move down from the row menu (keyboard); attached companions have
// no grip; Move up across the turn row → the crossing hint toast (FR-CBT-165). Runs after
// cb-core.e2e.ts on the same server, so every step reads the order it finds. Rules: bun test.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** The walkthrough's DM viewport (CBTX §13.1: CB1 at 1440×900), so the rows need no scroll. */
async function dmPage(browser: Browser, secret: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dm = await ctx.newPage();
  await loginDm(dm, secret);
  await live(dm);
  return { dm, init: await openWindow(dm, "cbt.initiative") };
}

const rowsOf = (init: Locator) => init.locator('li[data-testid="cbt-init-row"]');

/** The Initiative's rows top to bottom: id, name, indented (riding its owner). */
const listed = (init: Locator) =>
  rowsOf(init).evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("data-record-id") as string,
      name:
        e
          .querySelector(':scope > [data-row-main] [data-testid="cbt-init-row-name"]')
          ?.textContent?.trim() ?? "",
      indent: e.getAttribute("data-indent") === "true",
    })),
  );

const row = (init: Locator, id: string) =>
  init.locator(`li[data-testid="cbt-init-row"][data-record-id="${id}"]`);
const grip = (init: Locator, id: string) =>
  init.locator(`[data-testid="cbtx-init-row-grip"][data-record-id="${id}"]`);

async function idOf(init: Locator, name: string): Promise<string> {
  const r = (await listed(init)).find((x) => x.name === name);
  if (!r) throw new Error(`No row ${name}`);
  return r.id;
}

/** Press a row's grip, pass the 4 px threshold, travel to `y` (viewport px), still pressed. */
/**
 * Press a row's grip, pass the 4 px threshold and travel to the top edge of `beforeId`'s row
 * (dropping there puts the block right above it); still pressed. The dragged row is scrolled to
 * the list's middle first, so a target a row or two away sits clear of the autoscroll edges.
 */
async function dragAbove(page: Page, init: Locator, id: string, beforeId: string) {
  await row(init, id).evaluate((e) => e.scrollIntoView({ block: "center" }));
  const target = await row(init, beforeId).boundingBox();
  const box = await grip(init, id).boundingBox();
  if (!box || !target) throw new Error("no grip / target");
  const x = box.x + box.width / 2;
  const y = target.y - 1;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2 + (y > box.y ? 6 : -6));
  await page.mouse.move(x, y, { steps: 8 });
}

test("FR-CBTX-62 drag and drop: DM drags Thorn to the top of the 12-tie → player 2 follows ≤ 1 s and after reload; '→ 15' hint, Esc sends nothing", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const thorn = recordId("combat-1", "combatant", 1);
  const fe3 = recordId("cp-combat", "combatant", 4);
  const { dm, init } = await dmPage(browser, secret);
  const mira = await idOf(init, "Mira");
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  const pInit = await openWindow(p2, "cbt.initiative");
  const pOrder = async () =>
    (
      await pInit
        .locator('[data-testid="cbt-init-row"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")))
    ).filter((id) => id === thorn || id === fe3);

  // The first row of the 12-tie (the block right after Mira's): Thorn goes above it.
  const rows = await listed(init);
  const at = rows.findIndex((r) => r.id === mira);
  const first = rows.slice(at + 1).find((r) => !r.indent);
  if (!first) throw new Error("no tie row");
  expect(first.id).not.toBe(thorn); // cb-core left Fire Elemental 3 above Thorn
  await dragAbove(dm, init, thorn, first.id);
  const line = init.getByTestId("cbtx-init-drop");
  await expect(line).toHaveAttribute("data-after", mira);
  // Inside the tie: Thorn keeps 12, no "→".
  await expect(init.getByTestId("cbtx-init-drop-number")).toHaveCount(0);
  await dm.mouse.up();
  await expect(line).toHaveCount(0);
  await expect.poll(pOrder, { timeout: 1_000 }).toEqual([thorn, fe3]);
  await expect
    .poll(async () => (await listed(init)).slice(at + 1).find((r) => !r.indent)?.id)
    .toBe(thorn);

  // Fire Elemental 3 (12, Thorn's `own` summon) to just under Mira's block, above Thorn: it takes
  // Mira's number, "→ 15" (FR-CBTX-65 (a)); Esc → nothing sent.
  const before = await listed(init);
  await dragAbove(dm, init, fe3, thorn);
  await expect(line).toHaveAttribute("data-after", mira);
  await expect(init.getByTestId("cbtx-init-drop-number")).toHaveText("→ 15");
  await expect(row(init, fe3)).toHaveAttribute("data-lifted", "");
  await dm.keyboard.press("Escape");
  await expect(line).toHaveCount(0);
  await expect(row(init, fe3)).not.toHaveAttribute("data-lifted", "");
  await dm.mouse.up();
  await dm.waitForTimeout(300);
  expect(await listed(init)).toEqual(before);

  await p2.reload();
  await live(p2);
  const again = await openWindow(p2, "cbt.initiative");
  await expect
    .poll(async () =>
      (
        await again
          .locator('[data-testid="cbt-init-row"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")))
      ).filter((id) => id === thorn || id === fe3),
    )
    .toEqual([thorn, fe3]);
  // FR-CBTX-68: players have no grip.
  await expect(again.getByTestId("cbtx-init-row-grip")).toHaveCount(0);
});

test("FR-CBTX-63 keyboard move: Thorn's row menu by keyboard → Move down puts Thorn below the next block; ends disabled; attached rows have no grip", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const thorn = recordId("combat-1", "combatant", 1);
  const { dm, init } = await dmPage(browser, secret);
  const before = (await listed(init)).filter((r) => !r.indent).map((r) => r.id);
  const i = before.indexOf(thorn);
  const below = before[i + 1];
  if (!below) throw new Error("Thorn is last");

  const menu = row(init, thorn).locator(
    ':scope > [data-row-main] [data-testid="cbt-init-row-menu"]',
  );
  await menu.focus();
  await dm.keyboard.press("Enter");
  const down = dm.locator(`[data-testid="cbtx-init-row-move-down"][data-record-id="${thorn}"]`);
  await expect(down).toBeVisible();
  await down.focus();
  await dm.keyboard.press("Enter");
  await expect
    .poll(async () => (await listed(init)).filter((r) => !r.indent).map((r) => r.id))
    .toEqual([...before.slice(0, i), below, thorn, ...before.slice(i + 2)]);

  // The first row: Move up disabled.
  const first = before[0] as string;
  await row(init, first)
    .locator(':scope > [data-row-main] [data-testid="cbt-init-row-menu"]')
    .click();
  await expect(
    dm.locator(`[data-testid="cbtx-init-row-move-up"][data-record-id="${first}"]`),
  ).toHaveAttribute("data-disabled", "");
  await dm.keyboard.press("Escape");

  // Attached companions (indented rows, in-turn lines): no grip, Move up / down disabled.
  const rows = await listed(init);
  const attached = rows.filter((r) => r.indent);
  expect(attached.length).toBeGreaterThan(0);
  for (const r of attached) await expect(grip(init, r.id)).toHaveCount(0);
  await expect(
    init.locator('[data-testid="cbt-init-companion"] [data-testid="cbtx-init-row-grip"]'),
  ).toHaveCount(0);
  for (const r of rows.filter((x) => !x.indent)) await expect(grip(init, r.id)).toHaveCount(1);
  const pet = attached[0] as { id: string };
  await row(init, pet.id)
    .locator(':scope > [data-row-main] [data-testid="cbt-init-row-menu"]')
    .click();
  await expect(
    dm.locator(`[data-testid="cbtx-init-row-move-down"][data-record-id="${pet.id}"]`),
  ).toHaveAttribute("data-disabled", "");
  await dm.keyboard.press("Escape");
});

test("FR-CBT-165 crossing hint: Brakka moved above the turn row → 'Brakka now acts before …: no turn for it this round'; the turn stays", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const { dm, init } = await dmPage(browser, secret);
  const rows = (await listed(init)).filter((r) => !r.indent);
  const turnId = await init
    .locator('li[data-testid="cbt-init-row"][data-turn="true"]')
    .getAttribute("data-record-id");
  const turn = rows.find((r) => r.id === turnId);
  const brakka = rows.find((r) => r.name === "Brakka");
  if (!turn || !brakka) throw new Error("no turn / Brakka");
  expect(rows.indexOf(brakka)).toBe(rows.indexOf(turn) + 1);

  await row(init, brakka.id)
    .locator(':scope > [data-row-main] [data-testid="cbt-init-row-menu"]')
    .click();
  await dm.locator(`[data-testid="cbtx-init-row-move-up"][data-record-id="${brakka.id}"]`).click();
  await expect(dm.getByTestId("cbt-init-move-hint")).toHaveText(
    `Brakka now acts before ${turn.name}: no turn for it this round`,
  );
  await expect.poll(async () => (await listed(init))[0]?.id).toBe(brakka.id);
  // FR-CBT-164: the turn never moves.
  await expect(row(init, turn.id)).toHaveAttribute("data-turn", "true");
});
