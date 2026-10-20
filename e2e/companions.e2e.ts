// e2e-bundle: companions-e2e
// Sprint 6 CP3 (CBT §13.3 C3 / C8, thin): DM, player-1 (Mira) and player-2 (Thorn) at 1440×900 on
// the running ambush. The DM opens Mira's row → Summon for Mira…, types "fire el" (the shared
// matcher finds the SRD Fire Elemental), Summon: its row sits right after Mira with Mira's owner
// chip (FR-CBT-110, -118). Player-1 sees its HP and the card icon, player-2 a band and no card
// (FR-CBT-116, -119). The DM's Companion ▸ Dismiss takes it out of the fight for everyone
// (FR-CBT-112). The owner's card + attack is CP4's (the companion card); rules, redaction, leaks
// and crashes: bun test (summon, concentration-card, summon-sync, summon-crash).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

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

test("FR-CBT-110 FR-CBT-112 FR-CBT-118 companions-e2e: Summon for Mira…, owner sees HP + card icon, others a band; Dismiss", async ({
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

  // C8 (DM path): Companion ▸ Dismiss → gone for A, B, C.
  await row(init, fe).getByTestId("cbt-init-row-menu").first().click();
  await dm.getByTestId("cbt-init-row-companion").click();
  await dm.locator(`[data-testid="cbt-companion-dismiss"][data-record-id="${fe}"]`).click();
  for (const w of [init, i1, i2]) await expect(row(w, fe)).toHaveCount(0);

  for (const p of [p1, p2, dm]) await p.context().close();
});
