// e2e-bundle: rule-triggers
// Thin Divine Fury dice flow (S4-5; MOD §13.1 step 4, FR-MOD-57): DM Next → Brakka's turn;
// player-1 turns Rage on and rolls Greataxe Attack + damage → the damage roll line shows the
// offered d6 dashed ("Divine Fury (on a hit)"); the DM applies to Goblin with the chip → the
// outcome line "+ N radiant (Divine Fury)" then its d6 chip for the player and the DM. Sources,
// monster triggers, DM edits, leaks: bun test (effect-modifiers).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/** A log line's die chips labelled `label` (the inner shape's accessible name). */
const chips = (entry: Locator, label: string) =>
  entry
    .getByTestId("dice-log-die")
    .filter({ has: entry.page().locator(`[data-testid="dicex-die"][aria-label^="${label} d6"]`) });

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
  const offered = chips(rollLine, "Divine Fury (on a hit)");
  await expect(offered).toHaveCount(1);
  await expect(offered).toHaveAttribute("data-offered", "true");
  await expect(offered).toHaveAttribute("data-kept", "true");
  const die = Number(await offered.getAttribute("data-value"));
  expect(die).toBeGreaterThanOrEqual(1);
  expect(die).toBeLessThanOrEqual(6);
  // Brakka is Barbarian 5: 1d6 + 2.
  const n = die + 2;

  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  const goblin = await idByName(init, "Goblin");
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
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
    const chip = chips(outcome, "Divine Fury");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-value", String(die));
    await expect(chip).toHaveAttribute("data-offered", "false");
  }
});
