// e2e-bundle: spell-fx
// Spell FX (VFX §13 E2E, thin; walkthrough S1, S4, S11): player-1 presses Cast on Mira's Spirit
// Guardians → a `vfx-aura` (preset spirit-guardians) on the DM's and both players' maps; the DM
// applies Mira's pending fire card to Goblin Sneak → a fire hit look on all three; the DM ends
// the concentration → no aura anywhere. DM, player-1 (Mira), player-2 (Thorn) in their own
// contexts. Canvas nodes per AGENTS §9.5: name = test ID, id = record ID, attrs read from Konva.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Attrs of every Konva node named `name` on the page's stages. */
function fxNodes(page: Page, name: string): Promise<Record<string, unknown>[]> {
  return page.evaluate((name) => {
    type KNode = { attrs: Record<string, unknown> };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages ?? []).flatMap((s) =>
      s.find(`.${name}`).map((n) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(n.attrs)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
        }
        return out;
      }),
    );
  }, name);
}

const auraPresets = async (page: Page) =>
  (await fxNodes(page, "vfx-aura")).map((a) => a.preset as string);

/** The last cue's `<cueId>:<look>` on the over pass (a look lasts ≤ 1.4 s; this one stays). */
const lastHit = async (page: Page) =>
  ((await fxNodes(page, "vfx-over-pass"))[0]?.lastHit as string | undefined) ?? null;

test("FR-VFX-06 FR-VFX-07 FR-VFX-11 FR-VFX-21 FR-VFX-22 Cast → aura on all three; fire card → fire look on all three; End → no aura", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  const pages = [dm, p1, p2];
  for (const p of pages) await live(p);
  for (const p of pages) await expect.poll(() => fxNodes(p, "map-token")).not.toHaveLength(0);
  for (const p of pages) expect(await auraPresets(p)).toEqual([]);

  // S1: player-1 casts Spirit Guardians from the sheet.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const cast = sheet.getByTestId("vfx-cast").first();
  await expect(cast).toHaveAttribute("data-state", "cast");
  await cast.click();
  await expect(cast).toHaveAttribute("data-state", "end");
  for (const p of pages) {
    await expect.poll(() => auraPresets(p)).toEqual(["spirit-guardians"]);
  }

  // S4: the DM applies Mira's pending fire card to Goblin Sneak.
  const init = await openWindow(dm, "cbt.initiative");
  await init.getByTestId("cbt-init-pending-lines").getByRole("button").first().click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  const rows = popup.getByTestId("cbt-popup-target-row");
  if ((await rows.count()) === 0) {
    await popup.getByTestId("cbt-popup-target-add").click();
    await dm.getByTestId("cbt-popup-target-option").filter({ hasText: "Goblin Sneak" }).click();
  }
  await expect(rows).toHaveCount(1);
  const hit = rows.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  for (const p of pages) {
    await expect.poll(() => lastHit(p)).toMatch(/:fire$/);
  }

  // S11: the DM ends Mira's concentration → no aura on any map; player-1's button reads Cast.
  await init.getByTestId("cbtx-conc-chip").first().click();
  await dm.getByTestId("cbtx-conc-menu").getByTestId("cbtx-conc-end").click();
  for (const p of pages) await expect.poll(() => auraPresets(p)).toEqual([]);
  await expect(cast).toHaveAttribute("data-state", "cast");

  for (const p of pages) await p.context().close();
});
