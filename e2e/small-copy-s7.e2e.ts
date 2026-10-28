// e2e-bundle: fu-small-copy
// Sprint 7 FU4 small copy (play-shell §13 U15, U17), thin: the fixture Goblins' Compendium rows
// (FR-CMP-58), Creatures names whole at the default width (FR-ENT-42), the companion card's
// attacks inside its 320 × 360 rect (FR-CHARX-82), a Loot Move draft kept across a tab switch
// (FR-PARTY-50, FR-LOOT-29), a player's roll bar rolling as the sheet's PC with the pick kept
// across a reload (FR-DICE-77), a roll line's text with no stray space (FR-DICE-78). Texts, order
// and fallbacks: bun test (cmp-goblin-untyped.fixtures, pets-ui, companion, board, roll-actor,
// kind-contract).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { entryLine, pickRollOption } from "./support/log";
import { pickSheet } from "./support/sheet";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** player-1 has a waiting handout present in sim-10 (its modal popup): close it first. */
async function closePresent(page: Page) {
  const popup = page.getByTestId("party-present-popup");
  await popup.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  if (await popup.isVisible()) {
    await page.getByTestId("party-present-close").click();
    await expect(popup).toHaveCount(0);
  }
}

type Box = { x: number; y: number; width: number; height: number };
const inside = (b: Box, outer: Box) =>
  b.x >= outer.x - 0.5 &&
  b.y >= outer.y - 0.5 &&
  b.x + b.width <= outer.x + outer.width + 0.5 &&
  b.y + b.height <= outer.y + outer.height + 0.5;

/** A compendium result row's summary line (the second text span). */
async function resultLine(row: Locator): Promise<string> {
  return row.evaluate(
    (el) =>
      el.querySelector('[data-testid="cmp-result-name"]')?.nextElementSibling?.textContent ?? "",
  );
}

test("FR-CMP-58 FR-ENT-42 DM: fixture Goblin rows typed / type-less, no trailing space; Creatures names whole at 340 wide", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  const cmp = await openWindow(dm, "cmp.compendium");
  await cmp.getByTestId("cmp-search").fill("goblin");
  const row = (name: string, source: string) =>
    cmp
      .getByTestId("cmp-result")
      .filter({ has: dm.getByTestId("cmp-result-name").getByText(name, { exact: true }) })
      .filter({ hasText: source });
  await expect(row("Goblin", "fixture")).toHaveCount(1);
  expect(await resultLine(row("Goblin", "fixture"))).toBe("CR 1/4 · Small humanoid");
  expect(await resultLine(row("Goblin (untyped)", "fixture"))).toBe("CR 1/4 · Small");
  await cmp.getByTestId("ui-window-close").click();

  const creatures = await openWindow(dm, "ent.creatures");
  const box = await creatures.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(340);
  const names = creatures.getByTestId("ent-list-row-name");
  await expect(names.first()).toBeVisible();
  // Every row's name whole: nothing clipped (no ellipsis), at most two lines (sim-10 "Fire Elem…").
  const shown = await names.evaluateAll((els) =>
    els.map((e) => ({
      name: e.textContent ?? "",
      clipped: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1,
      lines: Math.round(
        e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight),
      ),
    })),
  );
  expect(shown.map((n) => n.name)).toEqual(
    expect.arrayContaining(["Elite Goblin Warrior", "Drake Companion"]),
  );
  expect(shown.filter((n) => n.clipped || n.lines > 2)).toEqual([]);
  await dm.context().close();
});

test("FR-CHARX-82 FR-PARTY-50 FR-LOOT-29 player-1: the Owlbear's attack buttons inside the 320 × 360 card; a Loot Move draft survives Inventory and back, gone after close", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1600, height: 1000 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresent(p1);

  const card = await openWindow(p1, "charx.companion");
  const picker = card.getByTestId("charx-companion-picker");
  const owlbear = await picker.evaluate(
    (el) =>
      [...(el as HTMLSelectElement).options].find((o) => o.text.includes("Owlbear"))?.value ?? "",
  );
  await picker.selectOption(owlbear);
  await expect(card.getByTestId("charx-companion-name")).toHaveText("Owlbear");
  const rect = (await card.boundingBox()) as Box;
  expect([Math.round(rect.width), Math.round(rect.height)]).toEqual([320, 360]);
  const rows = card.getByTestId("charx-companion-attack");
  await expect(rows.first()).toBeVisible();
  for (const i of [0, 1]) {
    const buttons = rows.nth(i).getByTestId("charx-companion-roll");
    await expect(buttons).toHaveCount(3);
    for (const b of await buttons.all()) {
      expect(inside((await b.boundingBox()) as Box, rect)).toBe(true);
    }
  }
  await card.getByTestId("ui-window-close").click();

  const board = await openWindow(p1, "party.board");
  const tab = (value: string) => board.locator(`[data-testid="party-tab"][data-value="${value}"]`);
  await tab("loot").click();
  const move = board.getByTestId("loot-move");
  const gp = move.locator('[data-testid="loot-move-coin"][data-value="gp"]');
  await gp.fill("5");
  await move.getByTestId("loot-move-text").fill("for the ferry");
  await tab("inventory").click();
  await expect(tab("inventory")).toHaveAttribute("aria-selected", "true");
  await expect(move).toBeHidden();
  await tab("loot").click();
  await expect(gp).toHaveValue("5");
  await expect(move.getByTestId("loot-move-text")).toHaveValue("for the ferry");
  // Closing the window drops the draft.
  await board.getByTestId("ui-window-close").click();
  const again = await openWindow(p1, "party.board");
  await expect(
    again.getByTestId("loot-move").locator('[data-testid="loot-move-coin"][data-value="gp"]'),
  ).toHaveValue("");
  await p1.context().close();
});

test("FR-DICE-77 FR-DICE-78 the roll bar rolls as the sheet's PC; a manual pick survives a reload; a line's text has no stray space", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("char-mira", "entity");
  const brakka = recordId("char-brakka", "entity");
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1600, height: 1000 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await closePresent(p1);

  // A fresh browser: the sheet shows its first own PC (Brakka) without a pick; the bar follows.
  const sheet = await openWindow(p1, "char.sheet");
  await expect(sheet.getByTestId("char-sheet-picker")).toHaveAttribute("data-value", brakka);
  const log = await openWindow(p1, "dice.log");
  const opts = log.getByTestId("dice-roll-options");
  if ((await opts.getAttribute("data-state")) !== "open") await opts.click();
  await expect(log.getByTestId("dice-roll-actor")).toHaveAttribute("data-value", brakka);
  await pickSheet(sheet, mira);
  await expect(log.getByTestId("dice-roll-actor")).toHaveAttribute("data-value", mira);
  const rolled = log.getByTestId("dice-log-entry").filter({ hasText: "— 1d20+2:" });
  const before = await rolled.count();
  await log.getByTestId("dice-roll-expression").fill("1d20+2");
  await log.getByTestId("dice-roll-expression").press("Enter");
  await expect(log.getByTestId("dice-roll-expression")).toHaveValue("");
  await expect(rolled).toHaveCount(before + 1);
  await expect(rolled.last()).toContainText("Mira — 1d20+2");
  await expect(rolled.last().getByTestId("dice-log-entry-actor")).toHaveText("Mira");

  // A manual pick (Brakka) is kept with the Options state across a reload.
  const options = log.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  await expect(log.getByTestId("dice-roll-actor")).toHaveAttribute("data-value", mira);
  await pickRollOption(log, "dice-roll-actor", brakka);
  await p1.reload();
  await live(p1);
  await closePresent(p1);
  const after = await openWindow(p1, "dice.log");
  await expect(after.getByTestId("dice-roll-actor")).toHaveAttribute("data-value", brakka);
  await after.getByTestId("dice-roll-actor").click();
  await expect(p1.getByTestId("dice-roll-actor-option")).toHaveText(["Me", "Brakka", "Mira"]);
  await p1.keyboard.press("Escape");

  // FR-DICE-78: the DM's subtracted group closes on its last die with no space before ")".
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const dlog = await openWindow(dm, "dice.log");
  await dlog.getByTestId("dice-roll-expression").fill("1d20-3d4");
  await dlog.getByTestId("dice-roll-expression").press("Enter");
  const line = dlog.getByTestId("dice-log-entry").filter({ hasText: "1d20-3d4" }).last();
  await expect(line).toBeVisible();
  // Kit parity K1 (FR-KIT-45): the full line with its chips is the row's Tooltip.
  const full = await entryLine(line);
  await expect(full.getByTestId("dice-log-die").first()).toHaveAttribute("data-value", /\d/);
  const text = (await full.textContent()) ?? "";
  expect(text).toMatch(/- \(\d \+ \d \+ \d\) = /);
  for (const bad of ["( ", " )", "  "]) expect(text).not.toContain(bad);
  await expect(shellWindow(dm, "dice.log")).toBeVisible();
  await dm.context().close();
  await p1.context().close();
});
