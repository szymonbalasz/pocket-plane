// e2e-bundle: rules-effects
// Thin weapon-parts flow in combat (S4-1b; MOD §13.1 steps 3–4, FR-CBT-81, -82, -84, -85): the
// bundle gives Brakka a Flame Tongue greatsword +1 (`2d6+4` slashing + `2d6` fire) and Fire Ward
// on Goblin; player-1 rolls Flame Tongue Attack + damage → the card lists both parts; the DM's
// popup shows the fire chip preset "Half (Fire Ward)" on Goblin → Apply → the players' line reads
// "— DM: hit. … slashing + … fire (half) damage". Rules, leaks, crits: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

test("FR-CBT-81 FR-CBT-82 FR-CBT-84 FR-CBT-85 Flame Tongue: parts on the card, fire chip Half (Fire Ward), players' line credits the DM", async ({
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
  const goblin = await idByName(init, "Goblin");
  const brakka = recordId("char-brakka", "entity");

  // Player 1: Brakka's sheet → Actions → Flame Tongue Attack + damage.
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, brakka);
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Flame Tongue" })
    .getByTestId("charx-roll-attack-damage")
    .click();

  // DM: the pending card lists both parts; the popup's fire chip on Goblin presets Half.
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(/\d+ slashing \+ \d+ fire/);
  // The d20 is real: the card marks a natural 1 / 20 (FR-CBT-57), which sets the players' words.
  const natural = /\(natural (1|20)\)/.exec((await card.textContent()) ?? "")?.[1];
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await expect(
    popup.locator('[data-testid="cbt-popup-damage-part"][data-value="1"]'),
  ).toBeVisible();
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  const part = trow.locator('[data-testid="cbt-popup-target-part"][data-value="0"]');
  await expect(part).toContainText("fire");
  await expect(part.getByTestId("cbt-popup-target-part-mult")).toHaveAttribute(
    "data-value",
    "half",
  );
  await expect(part.getByTestId("mod-popup-part-defense")).toHaveText("Half (Fire Ward)");
  await expect(trow.getByTestId("cbt-popup-target-mult")).toHaveAttribute("data-value", "normal");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);

  // The outcome line: players read "— DM: hit." (BL-10), "— DM: critical hit!" on a natural 20,
  // "(natural 1) — DM ruled hit." when the DM rules a natural 1 a hit (FR-CBT-58, full stop per
  // FR-CBT-95); the DM's line keeps its own words.
  const words =
    natural === "1"
      ? "\\(natural 1\\) — DM ruled hit\\."
      : natural === "20"
        ? "— DM: critical hit!"
        : "— DM: hit\\.";
  const p1Log = await openWindow(p1, "dice.log");
  await expect(
    p1Log
      .getByTestId("dice-log-entry")
      .filter({ hasText: new RegExp(`${words} \\d+ slashing \\+ \\d+ fire \\(half\\) damage`) }),
  ).toHaveCount(1);
  const dmLog = await openWindow(dm, "dice.log");
  await expect(
    dmLog.getByTestId("dice-log-entry").filter({ hasText: /vs AC \d+ — .*fire \(half\)/ }),
  ).toHaveCount(1);
});
