// e2e-bundle: token-forms
// Token forms (FORM §13, thin): player-1 toggles Mira's Rage on her sheet → Mira's token shows the
// Raging form on the DM's and player-2's maps (the header says why); off → her own art again; the
// DM picks Enlarged from the token menu → everyone sees it; player-2 gets no Form entry on Mira;
// the DM adds a third form in Mira's sheet and the owner's header lists it.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { pickSheet } from "./support/sheet";
import { openWindow } from "./support/shell";

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** The image URL a token's Konva node draws, or null (no node / no image yet). */
const drawn = (page: Page, tokenId: string) =>
  page.evaluate((id) => {
    type KNode = { id(): string; find(s: string): { image(): unknown }[] };
    const K = (window as unknown as { Konva?: { stages: { find(s: string): KNode[] }[] } }).Konva;
    const node = K?.stages.flatMap((s) => s.find(".map-token")).find((n) => n.id() === id);
    for (const i of node?.find("Image") ?? []) {
      const el = i.image();
      if (el instanceof HTMLImageElement) return el.src;
    }
    return null;
  }, tokenId);

async function expectArt(page: Page, tokenId: string, assetId: string) {
  await expect
    .poll(async () => (await drawn(page, tokenId)) ?? "", { timeout: 15_000 })
    .toContain(`/api/assets/${encodeURIComponent(assetId)}/thumb`);
}

async function rightClick(page: Page, tokenId: string) {
  await expect.poll(async () => (await konvaNodes(page, "map-token", tokenId)).length).toBe(1);
  const [n] = await konvaNodes(page, "map-token", tokenId);
  await page.mouse.click(n?.x ?? 0, n?.y ?? 0, { button: "right" });
}

test("FR-FORM-05 FR-FORM-06 FR-FORM-14 FR-FORM-15 Rage shows Mira's Raging form to everyone; off goes back; the DM picks Enlarged from the token menu", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("town", "token");
  const own = recordId("images", "asset", 2);
  const raging = recordId("mira-forms", "asset", 0);
  const enlarged = recordId("mira-forms", "asset", 1);

  const dm = await rolePage(browser);
  const p1 = await rolePage(browser);
  const p2 = await rolePage(browser);
  for (const page of [dm, p1, p2]) await page.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await p1.goto(link("Player 1"));
  await p2.goto(link("Player 2"));
  for (const page of [dm, p1, p2]) await live(page);
  for (const page of [dm, p2]) await expectArt(page, mira, own);

  // Player 1 toggles Rage on Mira's sheet.
  const sheet = await openWindow(p1, "char.sheet");
  await pickSheet(sheet, recordId("char-mira", "entity"));
  await expect(sheet.getByTestId("form-header-select")).toBeVisible();
  await sheet.locator('[data-testid="charx-tab"][data-value="section:mod.effects"]').click();
  const rage = sheet.getByTestId("mod-toggle").first();
  await expect(sheet.getByTestId("form-preset-mark")).toContainText("Raging");
  await rage.getByRole("switch").click();
  await expect(rage).toHaveAttribute("data-state", "on");
  for (const page of [dm, p1, p2]) await expectArt(page, mira, raging);
  await expect(sheet.getByTestId("form-header-preset")).toHaveText(
    "Showing Raging while Rage is on",
  );

  // Off: her own art again.
  await rage.getByRole("switch").click();
  await expect(rage).toHaveAttribute("data-state", "off");
  for (const page of [dm, p2]) await expectArt(page, mira, own);
  await expect(sheet.getByTestId("form-header-preset")).toHaveCount(0);

  // The DM: token menu ▸ Form ▸ Enlarged.
  await rightClick(dm, mira);
  await dm.getByTestId("form-menu").click();
  const items = dm.getByTestId("form-menu-item");
  await expect(items).toHaveCount(3);
  await items.filter({ hasText: "Enlarged" }).click();
  for (const page of [dm, p1, p2]) await expectArt(page, mira, enlarged);

  // Player 2 holds Mira redacted: the menu (notes) has no Form entry.
  await rightClick(p2, mira);
  await expect(p2.getByTestId("map-token-menu")).toBeVisible();
  await expect(p2.getByTestId("form-menu")).toHaveCount(0);
  await p2.keyboard.press("Escape");

  // Back to Base from the owner's header.
  await sheet.getByTestId("form-header-select").click();
  await p1.locator('[data-testid="form-header-option"][data-value="base"]').click();
  for (const page of [dm, p2]) await expectArt(page, mira, own);

  // FR-FORM-13: the DM adds a third form from the library in Mira's sheet (edit mode).
  const dmSheet = await openWindow(dm, "char.sheet");
  await pickSheet(dmSheet, recordId("char-mira", "entity"));
  await dmSheet.getByTestId("charx-edit-toggle").click();
  const row = dmSheet.getByTestId("form-row");
  await expect(row.getByTestId("form-row-item")).toHaveCount(2);
  await row.getByTestId("form-row-add").click();
  const picker = dm.getByRole("dialog", { name: "Token form image" });
  await picker.locator(`[data-testid="asset-picker-item"][data-record-id="${own}"]`).click();
  await picker.getByTestId("asset-picker-select").click();
  await expect(row.getByTestId("form-row-item")).toHaveCount(3);
  await expect(sheet.getByTestId("form-header-option")).toHaveCount(0);
  await sheet.getByTestId("form-header-select").click();
  await expect(p1.getByTestId("form-header-option")).toHaveCount(4);
});
