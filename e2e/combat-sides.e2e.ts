// e2e-bundle: late-damage
// Ally side (sprint 5 R4, #252; FR-CBT-98–104), thin, CBT §13.1 A1, A3–A6: the DM sets Goblin 2
// as an ally (chip on row and token for DM and player-1, the line for both), the encounter card
// rates enemy entries only ("Escort to the Ford" and its Friendly switch; the started Ambush's
// rating never moves), Mira secretly an enemy (DM-only dashed chip and line), Goblin 2's secret
// betrayal and its open reveal, then a reload keeps every chip. Likely targets by side (A2),
// redaction and leaks: bun test (popup-placement.test.ts, s5-core*.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const row = (scope: Locator, name: string) =>
  scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });

/** DM row menu → "Set as …" ▸ (Secret ticked if `secret`) → the set. */
async function setSide(init: Locator, name: string, label: string, secret = false) {
  const page = init.page();
  await row(init, name).getByTestId("cbt-init-row-menu").click();
  const sub = page.getByTestId("cbt-init-row-side");
  await expect(sub).toHaveText(label);
  await sub.click();
  if (secret) {
    await page.getByTestId("cbt-init-row-side-secret").click();
    await expect(page.getByTestId("cbt-init-row-side-secret")).toHaveAttribute(
      "data-value",
      "true",
    );
  }
  await page.getByTestId("cbt-init-row-side-apply").click();
  await expect(sub).toHaveCount(0);
}

test("FR-CBT-99 FR-CBT-100 FR-CBT-102 FR-CBT-104 ally side: set, secret, reveal, Friendly entries, reload (A1, A3–A6)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // The DM views the combat's scene (client memory; the players' active scene is unchanged).
  const battle = recordId("battlemap", "scene");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${battle}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", battle);
  expect(await konvaNodes(dm, "cbt-token-side")).toHaveLength(0);

  const init = await openWindow(dm, "cbt.initiative");
  const p1Init = await openWindow(p1, "cbt.initiative");
  const dmLines = (await openWindow(dm, "dice.log")).getByTestId("dice-log-entry");
  const p1Lines = (await openWindow(p1, "dice.log")).getByTestId("dice-log-entry");
  const chip = (scope: Locator, name: string) => row(scope, name).getByTestId("cbt-init-row-ally");

  // The started Ambush's rating, before any side change (planning-only, FR-CBT-102).
  const enc = await openWindow(dm, "cbt.encounters");
  const ambush = recordId("encounter-1", "encounter");
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${ambush}"]`).click();
  const rating = enc.getByTestId("cbt-enc-rating");
  // Goblin ×2, Wolf, Elite (once the definitions are in).
  await expect(enc.getByTestId("cbt-enc-total-cr")).toHaveText("1.25");
  const ambushRating = (await rating.getAttribute("data-value")) as string;
  const ambushXp = (await enc.getByTestId("cbt-enc-xp-base").textContent()) as string;
  await enc.getByRole("button", { name: "Back" }).click();

  // A1: Goblin 2 → Set as ally: chip on row and token, the line, still a band for players.
  await expect(chip(init, "Goblin 2")).toHaveCount(0);
  await setSide(init, "Goblin 2", "Set as ally");
  await expect(chip(init, "Goblin 2")).toHaveAttribute("data-value", "ally");
  await expect(chip(init, "Goblin 2")).toHaveAttribute("data-secret", "false");
  await expect(dmLines.last()).toContainText("DM — Goblin 2 is now an ally");
  await expect(chip(p1Init, "Goblin 2")).toHaveAttribute("data-value", "ally");
  await expect(p1Lines.last()).toContainText("Goblin 2 is now an ally");
  await expect(row(p1Init, "Goblin 2").getByTestId("cbt-init-row-band")).toHaveCount(1);
  await expect(row(p1Init, "Goblin 2").getByTestId("cbt-init-row-hp")).toHaveCount(0);
  // The token badge on the DM's canvas (players' active scene is the town here; the player view
  // of the badge: side.test.tsx).
  await expect.poll(async () => (await konvaNodes(dm, "cbt-token-side")).length).toBe(1);

  // A3: Ambush unchanged; Escort rates Goblin ×2 and lists the friendly one; the switch.
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${ambush}"]`).click();
  await expect(enc.getByTestId("cbt-enc-total-cr")).toHaveText("1.25");
  await expect(rating).toHaveAttribute("data-value", ambushRating);
  await expect(enc.getByTestId("cbt-enc-xp-base")).toHaveText(ambushXp);
  await enc.getByRole("button", { name: "Back" }).click();
  const escort = recordId("enc-friendly", "encounter");
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${escort}"]`).click();
  const totalCr = enc.getByTestId("cbt-enc-total-cr");
  const friendly = enc.getByTestId("cbt-enc-friendly");
  await expect(totalCr).toHaveText("0.5");
  await expect(friendly).toHaveText("Friendly: Goblin ×1 (CR 1/4)");
  const xp = async () => Number(await enc.getByTestId("cbt-enc-xp-adjusted").textContent());
  const withFriend = await xp();
  // Off: the friendly Goblin joins the enemy entry (merged per creature and side): Goblin ×3.
  await enc.locator('[data-testid="cbt-enc-entry-friendly"][data-value="ally"]').click();
  await expect(totalCr).toHaveText("0.75");
  await expect(friendly).toHaveCount(0);
  await expect(enc.getByTestId("cbt-enc-entry")).toHaveCount(1);
  expect(await xp()).toBeGreaterThan(withFriend);
  // On: that entry, all three, is friendly: nothing left to rate.
  await enc.locator('[data-testid="cbt-enc-entry-friendly"][data-value="enemy"]').click();
  await expect(rating).toHaveAttribute("data-value", "—");
  await expect(totalCr).toHaveText("0");
  await expect(friendly).toHaveText("Friendly: Goblin ×3 (CR 1/4)");
  await enc.getByRole("button", { name: "Back" }).click();

  // A4: Mira secretly an enemy: DM-only dashed chip and line; player-1 sees nothing new.
  const p1Count = await p1Lines.count();
  await setSide(init, "Mira", "Set as enemy", true);
  await expect(chip(init, "Mira")).toHaveAttribute("data-value", "enemy");
  await expect(chip(init, "Mira")).toHaveAttribute("data-secret", "true");
  await expect(dmLines.last()).toContainText("DM — Mira is now an enemy (secret)");
  await expect(chip(p1Init, "Mira")).toHaveCount(0);

  // A5: Goblin 2's secret betrayal: dashed for the DM; player-1 still sees "Ally", no line.
  await setSide(init, "Goblin 2", "Set as enemy", true);
  await expect(chip(init, "Goblin 2")).toHaveAttribute("data-secret", "true");
  await expect(chip(init, "Goblin 2")).toHaveAttribute("data-value", "enemy");
  await expect(chip(p1Init, "Goblin 2")).toHaveAttribute("data-value", "ally");
  // Then openly: "Set as enemy (show players)" reveals it to everyone; the chip goes.
  await row(init, "Goblin 2").getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbt-init-row-side-reveal").click();
  await expect(chip(init, "Goblin 2")).toHaveCount(0);
  await expect(dmLines.last()).toContainText("DM — Goblin 2 is now an enemy");
  await expect(p1Lines.last()).toContainText("Goblin 2 is now an enemy");
  await expect(chip(p1Init, "Goblin 2")).toHaveCount(0);
  // Mira → Set as ally (open): the DM's chip goes; player-1's view never changed: no line.
  await setSide(init, "Mira", "Set as ally");
  await expect(chip(init, "Mira")).toHaveCount(0);
  await expect(p1Lines).toHaveCount(p1Count + 1);

  // A6: Goblin 2 ally again; a reload keeps every chip and the Ambush rating.
  await setSide(init, "Goblin 2", "Set as ally");
  await expect(chip(p1Init, "Goblin 2")).toHaveAttribute("data-value", "ally");
  for (const page of [dm, p1]) {
    await page.reload();
    await live(page);
  }
  const init2 = await openWindow(dm, "cbt.initiative");
  const p1Init2 = await openWindow(p1, "cbt.initiative");
  await expect(chip(init2, "Goblin 2")).toHaveAttribute("data-value", "ally");
  await expect(chip(init2, "Goblin 2")).toHaveAttribute("data-secret", "false");
  await expect(chip(p1Init2, "Goblin 2")).toHaveAttribute("data-value", "ally");
  await expect(chip(init2, "Mira")).toHaveCount(0);
  await expect(chip(p1Init2, "Mira")).toHaveCount(0);
  const enc2 = await openWindow(dm, "cbt.encounters");
  await enc2.locator(`[data-testid="cbt-enc-row"][data-record-id="${ambush}"]`).click();
  // The rating's party follows the viewed scene (FR-CBT-66); the enemies never moved.
  await expect(enc2.getByTestId("cbt-enc-total-cr")).toHaveText("1.25");
  await expect(enc2.getByTestId("cbt-enc-xp-base")).toHaveText(ambushXp);

  // Leave the bundle's sides as loaded for the next spec on it.
  await setSide(init2, "Goblin 2", "Set as enemy");
  await expect(chip(init2, "Goblin 2")).toHaveCount(0);
  for (const page of [p1, dm]) await page.context().close();
});
