// e2e-bundle: companions-e2e
// Sprint 6 CP3 (CBT §13.3 C3 / C8, thin): DM, player-1 (Mira) and player-2 (Thorn) at 1440×900 on
// the running ambush. The DM opens Mira's row → Summon for Mira…, types "fire el" (the shared
// matcher finds the SRD Fire Elemental), Summon: its row sits right after Mira with Mira's owner
// chip (FR-CBT-110, -118). Player-1 sees its HP and the card icon, player-2 a band and no card
// (FR-CBT-116, -119). Player-1 opens its card and attacks with Touch; the DM applies the card on
// the Goblin (FR-CBT-114). Player-1 dismisses it from the card: gone for everyone (FR-CBT-112).
// Rules, redaction, leaks and crashes: bun test (summon, concentration-card, summon-sync,
// summon-crash).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const row = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

async function idByName(init: Locator, name: string): Promise<string> {
  const r = init.locator('[data-testid="cbt-init-row"]').filter({
    has: init.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  await expect(r).toHaveCount(1);
  return (await r.getAttribute("data-record-id")) as string;
}

const rowOrder = (init: Locator) =>
  init
    .getByTestId("cbt-init-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));

test("FR-CBT-110 FR-CBT-112 FR-CBT-114 FR-CBT-118 companions-e2e: Summon for Mira…, owner sees HP + card icon, others a band; card attack applied; owner Dismiss", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const miraChar = recordId("char-mira", "entity");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);

  const init = await openWindow(dm, "cbt.initiative");
  const mira = await idByName(init, "Mira");
  // C3: Mira's row → Summon for Mira… → "fire el" → Fire Elemental, ×1, After the owner, Average.
  await row(init, mira).getByTestId("cbt-init-row-menu").first().click();
  await dm.locator(`[data-testid="cbt-init-row-summon"][data-record-id="${mira}"]`).click();
  const dialog = dm.getByTestId("cbt-summon");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("cbt-summon-owner")).toHaveAttribute("data-value", miraChar);
  await dialog.getByTestId("cbt-summon-lookup").fill("fire el");
  await dm.getByTestId("cbt-lookup-option").filter({ hasText: "Fire Elemental" }).first().click();
  await expect(dialog.getByTestId("cbt-summon-picked")).toHaveText("Fire Elemental");
  await expect(
    dialog.locator('[data-testid="cbt-summon-mode"][data-value="after-owner"]'),
  ).toHaveAttribute("data-state", "on");
  await dialog.getByTestId("cbt-summon-submit").click();
  await expect(dialog).toHaveCount(0);

  // Its row right after Mira with Mira's owner chip.
  const fe = await idByName(init, "Fire Elemental");
  await expect(row(init, fe).getByTestId("cbt-init-row-owner")).toHaveAttribute(
    "data-value",
    miraChar,
  );
  const ids = await rowOrder(init);
  expect(ids.indexOf(fe)).toBe(ids.indexOf(mira) + 1);

  // FR-CBT-119: player-1 owns it (HP + card icon); player-2 a band, no card.
  const i1 = await openWindow(p1, "cbt.initiative");
  const i2 = await openWindow(p2, "cbt.initiative");
  await expect(row(i1, fe).getByTestId("cbt-init-row-hp")).toHaveText("102 / 102");
  await expect(row(i1, fe).getByTestId("cbt-init-row-card")).toBeVisible();
  await expect(row(i2, fe).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "healthy",
  );
  await expect(row(i2, fe).getByTestId("cbt-init-row-hp")).toHaveCount(0);
  await expect(row(i2, fe).getByTestId("cbt-init-row-card")).toHaveCount(0);
  await expect(row(i2, fe).getByTestId("cbt-init-row-owner")).toHaveText("Mira");

  // C6: player-1 opens its card from the row's icon; Touch "Attack + damage" → a player card in
  // the DM's Initiative (FR-CBT-114, FR-CHARX-64); the DM targets the Goblin and applies.
  await row(i1, fe).getByTestId("cbt-init-row-card").click();
  const card = shellWindow(p1, "charx.companion");
  await expect(card.getByTestId("charx-companion-name")).toHaveText("Fire Elemental");
  await expect(card.getByTestId("charx-companion-owner")).toHaveText("Mira's summon");
  await expect(card.getByTestId("charx-companion-edit")).toHaveCount(0); // a summon
  // Walkthrough fix: at the card's default 320 px the name is whole (never "Fire Elem…").
  const name = card.getByTestId("charx-companion-name");
  expect(await name.evaluate((n) => n.scrollWidth <= n.clientWidth + 0.5)).toBe(true);
  const touch = card.getByTestId("charx-companion-attack").filter({ hasText: "Touch" });
  await touch.locator('[data-testid="charx-companion-roll"][data-value="attack"]').click();
  const pending = init.getByTestId("cbt-init-card").filter({ hasText: "Fire Elemental" });
  await expect(pending).toHaveCount(1);
  await pending.click();
  const popup = dm.getByTestId("cbt-popup");
  const goblin = await idByName(init, "Goblin");
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await popup.getByTestId("cbt-popup-damage").fill("5");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(pending).toHaveCount(0);

  // C8: player-1 dismisses its summon from the card (FR-CBT-112) → gone for A, B, C.
  await card.getByTestId("cbt-companion-dismiss").click();
  await expect(card.getByTestId("cbt-companion-dismiss-text")).toContainText(
    "Dismiss Fire Elemental?",
  );
  // Walkthrough fix: the confirm shows inside the card without scrolling.
  const confirm = card.getByTestId("cbt-companion-dismiss-confirm");
  const inside = async () => {
    const body = await card.boundingBox();
    const box = await confirm.boundingBox();
    return !!body && !!box && box.y >= body.y && box.y + box.height <= body.y + body.height + 0.5;
  };
  expect(await inside()).toBe(true);
  await confirm.click();
  for (const w of [init, i1, i2]) await expect(row(w, fe)).toHaveCount(0);
  await expect(card.getByTestId("charx-companion-gone")).toContainText("No longer your companion");

  for (const p of [p1, p2, dm]) await p.context().close();
});
