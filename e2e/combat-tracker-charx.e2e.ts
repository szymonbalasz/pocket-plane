// e2e-bundle: session-sim
// Thin combat routes flow (CHARX slice 4, FR-CHARX-24, OQ-CHARX-12/13): player-1 makes a draft
// "Brin", which the whole party leaves out at Start; Mira's second attack (Light crossbow) from
// the sheet's Actions tab → a damage card naming it → DM applies to Goblin; the DM picks Elite's
// second attack (Shortbow) from the Initiative row. Its own encounter, ended at the end: the
// bundle's server is shared with scenes-map-fit, which starts encounter-1. Spell attacks, ids, forbidden rows and
// hpRules: bun test (combat-tracker charx-routes.test.ts, roll-route.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const row = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

async function idByName(scope: Locator, name: string): Promise<string> {
  // By the full name: the row splits "Goblin 2" into "Goblin" + " 2" (CBTX `RowName`).
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

test("FR-CHARX-24 FR-CHARX-11 OQ-CHARX-12 sheet attack 2 → card → apply; DM attack picker; draft not in the whole party", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const goblinDef = recordId("enemy-1", "imported-entity");
  const eliteDef = recordId("enemy-custom", "entity");
  const miraId = recordId("char-mira", "entity");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // Player 1 makes a draft "Brin" (FR-CHARX-08), then goes back to Mira.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.getByTestId("char-sheet-picker").selectOption({ label: "New character…" });
  await p1.getByTestId("charx-create-name").fill("Brin");
  await p1.getByTestId("charx-create-submit").click();
  await expect(sheet.getByTestId("charx-draft")).toBeVisible();
  const brinId = (await sheet.getByTestId("char-sheet").getAttribute("data-record-id")) as string;
  await sheet.getByTestId("charx-edit-toggle").click();
  await sheet.getByTestId("char-sheet-picker").selectOption(miraId);
  await expect(sheet.getByTestId("char-sheet")).toHaveAttribute("data-record-id", miraId);

  // DM views Goblin Ambush; a new encounter (whole party) with Goblin + Elite: Brin unticked,
  // marked Draft; not bound at Start.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.getByTestId("cbt-enc-new").click();
  for (const [def, text] of [
    [goblinDef, "gob"],
    [eliteDef, "eli"],
  ] as const) {
    await enc.getByTestId("cbt-lookup-input").fill(text);
    await dm.locator(`[data-testid="cbt-lookup-option"][data-record-id="${def}"]`).click();
    await expect(enc.locator(`[data-testid="cbt-enc-entry"][data-record-id="${def}"]`)).toHaveCount(
      1,
    );
  }
  const party = (id: string) =>
    enc.locator(`[data-testid="cbt-enc-party"][data-record-id="${id}"]`);
  await expect(party(brinId)).toHaveAttribute("data-state", "unchecked");
  await expect(party(miraId)).toHaveAttribute("data-state", "checked");
  await expect(enc.locator(`label[for="cbt-party-${brinId}"]`)).toContainText("Draft");
  await dm.waitForTimeout(800); // debounced save lands before Start
  // P3 glitch 7: the builder rates the PCs Start adds by default, so both cards agree.
  const builderXp = await enc.getByTestId("cbt-enc-xp-adjusted").textContent();
  await enc.getByTestId("cbt-enc-start").click();
  await expect(dm.getByRole("dialog").getByTestId("cbt-enc-xp-adjusted")).toHaveText(
    builderXp ?? "",
  );
  const bindings = dm.getByTestId("cbt-enc-binding");
  await expect(bindings.filter({ hasText: "Mira" })).toHaveCount(1);
  await expect(bindings.filter({ hasText: "Brin" })).toHaveCount(0);
  await dm.getByTestId("cbt-enc-start-confirm").click();
  // FR-CBT-60: the acked Start opens Initiative (it loaded minimised: no encounter, P3 glitch 3).
  const init = shellWindow(dm, "cbt.initiative");
  await expect(init).toBeVisible();
  await expect(init.locator('[data-testid="cbt-init-row-name"][data-value="Mira"]')).toHaveCount(1);
  await expect(init.locator('[data-testid="cbt-init-row-name"][data-value="Brin"]')).toHaveCount(0);
  // P3 glitch 10, ruling A: in round 0 (Roll buttons in the Init column, no Moved) long names
  // such as "Elite Goblin Warrior" stay whole.
  await expect(
    init.locator('[data-testid="cbt-init-row-name"][data-value="Elite Goblin Warrior"]'),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      init
        .locator('[data-testid="cbt-init-row-name"] [data-name-base]')
        .evaluateAll((els) =>
          els.filter((e) => e.scrollWidth > e.clientWidth + 0.5).map((e) => e.textContent),
        ),
    )
    .toEqual([]);

  // Mira's Light crossbow (2nd attack) from the Actions tab: Attack + damage → cbt.attack → the
  // DM's card (Attack is to-hit only since N7, FR-CHARX-41).
  await expect(sheet.getByTestId("char-sheet-combat")).toBeVisible();
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const crossbow = sheet.getByTestId("charx-attack").filter({ hasText: "Light crossbow" });
  await crossbow.getByTestId("charx-roll-attack-damage").click();
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup.getByRole("heading", { level: 2 })).toHaveText("Mira — Light crossbow");
  const goblin = await idByName(init, "Goblin");
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await popup.getByTestId("cbt-popup-damage").fill("3");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(row(init, goblin).getByTestId("cbt-init-row-hp")).toHaveText("HP 4/7");

  // OQ-CHARX-12: Elite has two attack rows → Attack ▸ lists both, each with the three actions
  // (FR-CBT-74); Shortbow's Attack + damage → card.
  const elite = await idByName(init, "Elite Goblin Warrior");
  await row(init, elite).getByTestId("cbt-init-row-attack").click();
  const options = dm.locator(
    `[data-testid="cbt-init-row-attack-option"][data-record-id="${elite}"][data-value="both"]`,
  );
  await expect(options).toHaveCount(2);
  await options.filter({ hasText: "Shortbow" }).click();
  await expect(dm.getByTestId("cbt-popup").getByRole("heading", { level: 2 })).toHaveText(
    "Elite Goblin Warrior — Shortbow",
  );

  // FR-CBT-54 (sim-5 glitch 1): the DM targets Mira (her token → a selection row), then
  // Dismisses; the next card's popup opens without her: no stale targets.
  const miraCombatant = await idByName(init, "Mira");
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm
    .locator(`[data-testid="cbt-popup-target-option"][data-value="${miraCombatant}"]`)
    .click();
  await expect(
    popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${miraCombatant}"]`),
  ).toHaveAttribute("data-source", "selection");
  await dm.getByTestId("cbt-popup-dismiss").click();
  await expect(popup).toHaveCount(0);

  // FR-CBT-74: Attack ▸ Shortbow "Attack" → a to-hit-only card ("Waiting for damage"); Later;
  // "Damage" completes it (the same card, damage filled).
  const option = async (value: string) => {
    await row(init, elite).getByTestId("cbt-init-row-attack").click();
    const bow = dm
      .locator(`[data-testid="cbt-init-row-attack-option"][data-record-id="${elite}"]`)
      .and(dm.locator(`[data-value="${value}"]`));
    const bowId = await options.filter({ hasText: "Shortbow" }).getAttribute("data-attack-id");
    await bow.and(dm.locator(`[data-attack-id="${bowId}"]`)).click();
  };
  await option("toHit");
  await expect(popup.getByTestId("cbt-popup-waiting-damage")).toBeVisible();
  await expect(popup.getByTestId("cbt-popup-target-row")).toHaveCount(0);
  const splitCard = await popup.getAttribute("data-record-id");
  await dm.getByTestId("cbt-popup-later").click();
  await option("damage");
  await expect(popup).toHaveAttribute("data-record-id", splitCard as string);
  await expect(popup.getByTestId("cbt-popup-waiting-damage")).toHaveCount(0);

  // Leave the shared server as found: dismiss the card, end the encounter.
  await dm.getByTestId("cbt-popup-dismiss").click();
  await init.getByTestId("cbt-init-end").click();
  await dm.getByTestId("cbt-init-end-confirm").click();
  await expect(init.getByTestId("cbt-init-row")).toHaveCount(0);

  for (const page of [p1, dm]) await page.context().close();
});
