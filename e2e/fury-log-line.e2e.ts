// e2e-bundle: fury-log-line
// Thin Divine Fury dice flow (S4-5; MOD §13.1 step 4, FR-MOD-57): DM Next → Brakka's turn;
// player-1 turns Rage on and rolls Greataxe Attack + damage → the damage roll line shows the
// offered d6 dashed ("Divine Fury (on a hit)"); the DM applies to Mira (visible) with the chip → the
// outcome line "+ N radiant (Divine Fury)" then its d6 chip for the player and the DM. Sources,
// monster triggers, DM edits, leaks: bun test (effect-modifiers). Own bundle (`session-sim-7` as
// `fury-log-line`): it leaves Brakka's turn, Rage on and Divine Fury used, which
// `trigger-state.e2e.ts` expects untouched.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { entryDice } from "./support/log";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/**
 * A log line's die chips labelled `label` (the inner shape's accessible name), from the row's
 * Tooltip (kit parity K1, FR-KIT-45).
 */
const chips = async (entry: Locator, label: string) =>
  (await entryDice(entry)).filter({
    has: entry.page().locator(`[data-testid="dicex-die"][aria-label^="${label} d6"]`),
  });

test("FR-MOD-57 Divine Fury's d6: offered (dashed) on the roll line, a chip after '(Divine Fury)' on the outcome line for the player and the DM", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  const init = await openWindow(dm, "cbt.initiative");
  const brakka = await idByName(init, "Brakka");
  await init.getByTestId("cbt-init-next").click();
  await expect(
    init.locator(`[data-testid="cbt-init-row"][data-record-id="${brakka}"]`),
  ).toHaveAttribute("data-turn", "true");

  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption(recordId("char-brakka", "entity"));
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const rage = sheet.getByTestId("mod-toggle").first();
  await rage.getByRole("switch").click();
  await expect(rage).toHaveAttribute("data-state", "on");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Greataxe" })
    .getByTestId("charx-roll-attack-damage")
    .click();

  // The damage roll line: the offered d6 dashed (offered, not struck), for the player.
  const p1Log = await openWindow(p1, "dice.log");
  const rollLine = p1Log.getByTestId("dice-log-entry").filter({ hasText: "on a hit" });
  await expect(rollLine).toHaveCount(1);
  // FR-DICE-40: the numbers show once this client's dice land.
  await expect(rollLine).toHaveAttribute("data-landed", "true", { timeout: 10_000 });
  // The dice are real: a natural 20 (5%) doubles the trigger's dice too (FR-CBT-16), 2d6.
  const crit = (await rollLine.textContent())?.includes("natural 20") ?? false;
  const offered = await chips(rollLine, "Divine Fury (on a hit)");
  await expect(offered).toHaveCount(crit ? 2 : 1);
  const dice: number[] = [];
  for (const d of await offered.all()) {
    await expect(d).toHaveAttribute("data-offered", "true");
    await expect(d).toHaveAttribute("data-kept", "true");
    const v = Number(await d.getAttribute("data-value"));
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(6);
    dice.push(v);
  }
  // Brakka is Barbarian 5: 1d6 + 2 (2d6 + 2 on a crit).
  const n = dice.reduce((a, b) => a + b, 0) + 2;

  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  // session-sim-7 hides the ambushers (lines naming them are DM-only): the target is Mira, a
  // creature everyone sees, so the line is public.
  const target = await idByName(init, "Mira");
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${target}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${target}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await expect(trow.getByTestId("mod-popup-part")).toHaveAttribute("data-state", "on");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);

  // The outcome line for both: the part's text, then its d6 chip (kept, not offered).
  for (const page of [p1, dm]) {
    const log = await openWindow(page, "dice.log");
    const outcome = log
      .getByTestId("dice-log-entry")
      .filter({ hasText: `+ ${n} radiant (Divine Fury)` });
    await expect(outcome).toHaveCount(1);
    const chip = await chips(outcome, "Divine Fury");
    await expect(chip).toHaveCount(dice.length);
    for (const [i, die] of dice.entries()) {
      await expect(chip.nth(i)).toHaveAttribute("data-value", String(die));
      await expect(chip.nth(i)).toHaveAttribute("data-offered", "false");
    }
  }
});
