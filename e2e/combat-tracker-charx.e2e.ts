// e2e-bundle: session-sim
// Thin combat routes flow (CHARX slice 4, FR-CHARX-24, OQ-CHARX-12/13): player-1 makes a draft
// "Brin", which the whole party leaves out at Start; Mira's second attack (Light crossbow) from
// the sheet's Actions tab → a damage card naming it → DM applies to Goblin; the DM picks Elite's
// second attack (Shortbow) from the Initiative row. Its own encounter, ended at the end: the
// bundle's server is shared with scenes-map-fit, which starts encounter-1. Spell attacks, ids, forbidden rows and
// hpRules: bun test (combat-tracker charx-routes.test.ts, roll-route.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

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
  await enc.getByTestId("cbt-enc-start").click();
  const bindings = dm.getByTestId("cbt-enc-binding");
  await expect(bindings.filter({ hasText: "Mira" })).toHaveCount(1);
  await expect(bindings.filter({ hasText: "Brin" })).toHaveCount(0);
  await dm.getByTestId("cbt-enc-start-confirm").click();
  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.locator('[data-testid="cbt-init-row-name"][data-value="Mira"]')).toHaveCount(1);
  await expect(init.locator('[data-testid="cbt-init-row-name"][data-value="Brin"]')).toHaveCount(0);

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

  // OQ-CHARX-12: Elite has two attack rows → the row's Attack opens a picker; Shortbow → card.
  const elite = await idByName(init, "Elite Goblin Warrior");
  await row(init, elite).getByTestId("cbt-init-row-attack").click();
  const options = dm.locator(
    `[data-testid="cbt-init-row-attack-option"][data-record-id="${elite}"]`,
  );
  await expect(options).toHaveCount(2);
  await options.filter({ hasText: "Shortbow" }).click();
  await expect(dm.getByTestId("cbt-popup").getByRole("heading", { level: 2 })).toHaveText(
    "Elite Goblin Warrior — Shortbow",
  );

  // Leave the shared server as found: dismiss the card, end the encounter.
  await dm.getByTestId("cbt-popup-dismiss").click();
  await init.getByTestId("cbt-init-end").click();
  await dm.getByTestId("cbt-init-end-confirm").click();
  await expect(init.getByTestId("cbt-init-row")).toHaveCount(0);

  for (const page of [p1, dm]) await page.context().close();
});
