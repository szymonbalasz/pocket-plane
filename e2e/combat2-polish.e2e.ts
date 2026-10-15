// e2e-bundle: combat-extras
// Sprint-2 P2a polish (fix/combat2-polish), DM + player-1 on the `combat-extras` bundle after
// combat-extras.e2e.ts (Mira concentrating on Bless, 9 / 12; Thorn temp HP 5): G1 chips fit
// (FR-CBTX-46), G5 temp HP preview (FR-CBT-78), G9 + N11 player-owned concentration card: DM bell,
// Pending "Waiting for …", 4 s token cue, no DM toast (FR-NOTE-27, FR-CBT-79, FR-NOTE-30), N8 popup
// over its toast, movable (FR-CBT-75/76), G4 "↓ N more" (FR-CBT-77), item 14 death state after
// End (FR-CBTX-50). Rules and edge cases: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { launcherButton, openWindow } from "./support/shell";

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().getByTestId("cbt-init-row-name").getByText(name, { exact: true }),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

const row = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function setup(browser: Parameters<typeof rolePage>[0], width = 1440, height = 900) {
  const env = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width, height });
  await loginDm(dm, env.secret);
  await live(dm);
  const player = await rolePage(browser);
  await player.setViewportSize({ width, height });
  await player.goto(env.link("Player 1"));
  await live(player);
  return { ...env, dm, player };
}

/** DM views Goblin Ambush (the encounter's scene) and shows it to players. */
async function viewAmbush(dm: Page, player: Page, ambush: string) {
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  // Already shown (an earlier test on this server) → no button.
  const show = dm.getByTestId("map-show-to-players");
  if (await show.isVisible()) await show.click();
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await scenes.getByTestId("ui-window-close").click();
}

/** DM row Attack → popup; one target, Hit, damage total; returns the popup (not applied). */
async function attack(dm: Page, init: Locator, attackerId: string, targetId: string, dmg: number) {
  await init.locator(`[data-testid="cbt-init-row-attack"][data-record-id="${attackerId}"]`).click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${targetId}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${targetId}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await expect(hit).toHaveAttribute("data-value", "hit");
  await popup.getByTestId("cbt-popup-damage").fill(String(dmg));
  return { popup, trow };
}

test("FR-CBTX-46 FR-CBT-78 FR-NOTE-27 FR-CBT-79 FR-NOTE-30 chips fit; temp HP preview; player-owned card: bell, Pending, cue, no DM toast", async ({
  browser,
}) => {
  const { dm, player, recordId } = await setup(browser);
  const ambush = recordId("battlemap", "scene");
  const miraToken = recordId("battlemap", "token", 0);
  await viewAmbush(dm, player, ambush);
  const init = await openWindow(dm, "cbt.initiative");
  const pinit = await openWindow(player, "cbt.initiative");
  const mira = await idByName(init, "Mira");
  const thorn = await idByName(init, "Thorn");
  const goblin = await idByName(init, "Goblin");

  // G1 (FR-CBTX-46): compact labels; at the default width Mira's concentration "Bless" and
  // "Bless 10r" show without "+N" (DM), Goblin's chips likewise.
  const chips = (scope: Locator, id: string) =>
    row(scope, id).locator('[data-testid="cbtx-init-row-effect"]:visible');
  await expect(
    row(init, mira).locator('[data-testid="cbtx-init-row-effect"][data-value="concentration"]'),
  ).toHaveText("Bless");
  for (const scope of [init, pinit]) {
    await expect(row(scope, mira).getByTestId("cbtx-init-row-effect-more")).toHaveCount(0);
  }
  expect(await chips(init, mira).count()).toBeGreaterThanOrEqual(2);
  const widths = await chips(init, mira).evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().width),
  );
  for (const w of widths) expect(w).toBeLessThanOrEqual(96.5);

  // G5 (FR-CBT-78): Goblin → Thorn (temp 5), damage 3: "Thorn 10 (+5) → 10 (+2)"; Dismiss-free:
  // close with Later.
  const g5 = await attack(dm, init, goblin, thorn, 3);
  await expect(g5.trow.getByTestId("cbt-popup-target-preview")).toHaveText(
    "Thorn 10 (+5) → 10 (+2)",
  );
  await g5.popup.getByTestId("cbt-popup-later").click();
  await expect(g5.popup).toHaveCount(0);
  // The Damage / heal dialog header reads the temp HP too.
  await row(init, thorn).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbt-init-row-hp-adjust").click();
  await expect(dm.getByTestId("cbt-hp-current")).toHaveText("HP 10 / 10 · Temp 5");
  await dm.getByTestId("cbt-hp-amount").fill("3");
  await expect(dm.getByTestId("cbt-hp-preview")).toHaveText("→ 10 / 10 · Temp 2");
  await dm.keyboard.press("Escape");
  await expect(dm.getByTestId("cbt-hp")).toHaveCount(0);

  // G9 / N11: Goblin hits Mira (concentrating) → player-owned concentration card.
  const bell = launcherButton(dm, "note.history").getByTestId("note-launcher-badge");
  const bellBefore = (await bell.count()) > 0 ? Number(await bell.textContent()) : 0;
  const g9 = await attack(dm, init, goblin, mira, 2);
  await g9.popup.getByTestId("cbt-popup-apply").click();
  await expect(g9.popup).toHaveCount(0);
  const ptoast = player.getByTestId("note-toast").filter({ hasText: "concentration save" });
  await expect(ptoast).toBeVisible();
  const cardId = (await ptoast.getAttribute("data-record-id")) as string;
  // FR-NOTE-30: the DM's cue on Mira's token, for ~4 s; players get none.
  await expect.poll(async () => (await konvaNodes(dm, "note-token-cue", miraToken)).length).toBe(1);
  expect(await konvaNodes(player, "note-token-cue")).toHaveLength(0);
  // FR-CBT-79: Pending "Waiting for Mira: …" with the DM's Roll.
  const pending = init.locator(`[data-testid="cbt-init-pending"][data-record-id="${cardId}"]`);
  await expect(pending.getByTestId("cbt-init-pending-text")).toHaveText(
    /^Waiting for Mira: concentration save DC 10 \(Bless\)$/,
  );
  await expect(pending.getByTestId("cbt-init-pending-action")).toHaveText("Roll save");
  // FR-NOTE-27: the DM's bell counts it; no DM toast for it.
  await expect.poll(async () => Number(await bell.textContent())).toBeGreaterThan(bellBefore);
  const bellWith = Number(await bell.textContent());
  await expect(dm.locator(`[data-testid="note-toast"][data-record-id="${cardId}"]`)).toHaveCount(0);
  await expect
    .poll(async () => (await konvaNodes(dm, "note-token-cue")).length, {
      timeout: 6000,
    })
    .toBe(0);
  // The player rolls; the Pending row goes.
  await ptoast.getByTestId("note-toast-action").click();
  await player.getByTestId("cbtx-note-roll").click();
  await expect(pending).toHaveCount(0);
  // Handled: it leaves the DM's bell (FR-NOTE-24 / -27).
  await expect
    .poll(async () => ((await bell.count()) > 0 ? Number(await bell.textContent()) : 0))
    .toBe(bellWith - 1);

  await player.context().close();
  await dm.context().close();
});

test("FR-CBT-75 FR-CBT-76 FR-NOTE-26 popup opens over its toast, the toast closes, it drags within the work area", async ({
  browser,
}) => {
  const { dm, player, recordId } = await setup(browser);
  await viewAmbush(dm, player, recordId("battlemap", "scene"));
  await openWindow(dm, "cbt.initiative");
  // Player-1: sheet Attack + damage → a damage card to the DM (sticky toast).
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet.getByTestId("charx-roll-attack-damage").first().click();
  const toast = dm.getByTestId("note-toast").filter({ has: dm.getByTestId("note-toast-action") });
  await expect(toast).toHaveCount(1);
  const cardId = (await toast.getAttribute("data-record-id")) as string;
  const box = await toast.boundingBox();
  if (!box) throw new Error("no toast box");
  const badge = launcherButton(dm, "note.history").getByTestId("note-launcher-badge");
  const count = await badge.textContent();
  await toast.getByTestId("note-toast-action").click();
  const popup = dm.locator(`[data-testid="cbt-popup"][data-record-id="${cardId}"]`);
  await expect(popup).toBeVisible();
  // FR-CBT-75: top-left where the toast was; the toast is gone; the bell still counts the card.
  const at = await popup.boundingBox();
  expect(Math.abs((at?.x ?? 0) - box.x)).toBeLessThan(2);
  expect(Math.abs((at?.y ?? 0) - box.y)).toBeLessThan(2);
  await expect(dm.locator(`[data-testid="note-toast"][data-record-id="${cardId}"]`)).toHaveCount(0);
  await expect(badge).toHaveText(count ?? "");
  // FR-CBT-76: drag by the header to the right, then far off-screen → stops at the work area.
  const drag = popup.getByTestId("cbt-popup-drag");
  const h = await drag.boundingBox();
  if (!h) throw new Error("no header box");
  await dm.mouse.move(h.x + 20, h.y + 8);
  await dm.mouse.down();
  await dm.mouse.move(h.x + 220, h.y + 108, { steps: 4 });
  let r = await popup.boundingBox();
  expect(Math.abs((r?.x ?? 0) - ((at?.x ?? 0) + 200))).toBeLessThan(2);
  await dm.mouse.move(h.x + 5000, h.y + 5000, { steps: 4 });
  await dm.mouse.up();
  r = await popup.boundingBox();
  const vp = dm.viewportSize() ?? { width: 0, height: 0 };
  expect(Math.round((r?.x ?? 0) + (r?.width ?? 0))).toBe(vp.width);
  expect(Math.round((r?.y ?? 0) + (r?.height ?? 0))).toBe(vp.height - 64);
  // Later keeps the card; its toast doesn't come back (FR-NOTE-26).
  await popup.getByTestId("cbt-popup-later").click();
  await expect(popup).toHaveCount(0);
  await expect(dm.locator(`[data-testid="note-toast"][data-record-id="${cardId}"]`)).toHaveCount(0);
  // Pending → the popup per FR-CBT-55/56 (not over a notification).
  await dm.locator(`[data-testid="cbt-init-card"][data-record-id="${cardId}"]`).click();
  await expect(popup).toBeVisible();
  await expect(popup).not.toHaveAttribute("data-side", "origin");
  await popup.getByTestId("cbt-popup-dismiss").click();
  await expect(popup).toHaveCount(0);

  await player.context().close();
  await dm.context().close();
});

test("FR-CBT-77 a short window: Initiative grows to the work area, '↓ N more' scrolls to the rows below", async ({
  browser,
}) => {
  const { dm, player, recordId } = await setup(browser, 1280, 480);
  await viewAmbush(dm, player, recordId("battlemap", "scene"));
  const init = await openWindow(dm, "cbt.initiative");
  const more = init.getByTestId("cbt-init-more");
  await expect(more).toBeVisible();
  const n = Number(await more.getAttribute("data-value"));
  expect(n).toBeGreaterThan(0);
  await expect(more).toHaveText(`${n} more`);
  // Grown to the work area's bottom (above the launcher).
  const box = await init.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThan(480 - 64 - 4);
  await more.click();
  await expect.poll(async () => Number(await more.getAttribute("data-value"))).toBeLessThan(n);

  await player.context().close();
  await dm.context().close();
});

test("FR-CBTX-50 a PC at 0 HP keeps the Down X and its death badge after End, for the DM and the player", async ({
  browser,
}) => {
  const { dm, player, recordId } = await setup(browser);
  const thornToken = recordId("thorn-battlemap", "token", 0);
  await viewAmbush(dm, player, recordId("battlemap", "scene"));
  const init = await openWindow(dm, "cbt.initiative");
  const thorn = await idByName(init, "Thorn");
  await row(init, thorn).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbt-init-row-hp-adjust").click();
  await dm.getByTestId("cbt-hp-amount").fill("99");
  await dm.getByTestId("cbt-hp-damage").click();
  for (const page of [dm, player]) {
    await expect
      .poll(async () => (await konvaNodes(page, "cbt-token-down", thornToken)).length)
      .toBe(1);
  }
  await init.getByTestId("cbt-init-end").click();
  await dm.getByTestId("cbt-init-end-confirm").click();
  await expect(dm.getByTestId("cbt-init-end-confirm")).toHaveCount(0);
  for (const page of [dm, player]) {
    await expect
      .poll(async () => (await konvaNodes(page, "cbtx-token-death", thornToken)).length)
      .toBe(1);
    await expect
      .poll(async () => (await konvaNodes(page, "cbt-token-down", thornToken)).length)
      .toBe(1);
  }

  await player.context().close();
  await dm.context().close();
});
