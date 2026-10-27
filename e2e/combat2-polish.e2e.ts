// e2e-bundle: combat-extras
// Sprint-2 P2a polish (fix/combat2-polish), DM + player-1 on the `combat-extras` bundle after
// combat-extras.e2e.ts (Mira concentrating on Bless, 9 / 12; Thorn temp HP 5): G1 chips fit
// (FR-CBTX-46), G5 temp HP preview (FR-CBT-78), G9 + N11 player-owned concentration card: DM bell,
// Pending "Waiting for …", 4 s token cue, no DM toast (FR-NOTE-27, FR-CBT-79, FR-NOTE-30), N8 popup
// over its toast, movable (FR-CBT-75/76), G4 "↓ N more" (FR-CBT-77), item 14 death state after
// End (FR-CBTX-50). Rules and edge cases: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { initMenu, statusEffect } from "./support/initiative";
import { konvaNodes } from "./support/konva";
import { panMap } from "./support/map";
import { showToPlayers } from "./support/scenes";
import { launcherButton, openWindow, shellWindow } from "./support/shell";
import { closeToasts } from "./support/toasts";

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
  await closeToasts(dm); // FR-NOTE-70, -71: the stack may sit on this window's body, below its first row
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  // Already shown (an earlier test on this server) → no click.
  await showToPlayers(dm, "Goblin Ambush");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await scenes.getByTestId("ui-window-close").click();
}

/** DM row Attack → popup; one target, Hit, damage total; returns the popup (not applied). */
async function attack(dm: Page, init: Locator, attackerId: string, targetId: string, dmg: number) {
  // Attack ▸ → the first attack's Attack + damage (FR-CBT-74).
  await init.locator(`[data-testid="cbt-init-row-attack"][data-record-id="${attackerId}"]`).click();
  await dm
    .locator(
      `[data-testid="cbt-init-row-attack-option"][data-record-id="${attackerId}"][data-value="both"]`,
    )
    .click();
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

  // G1 (FR-CBTX-46, now FR-KIT-28): the status cell shows Mira's concentration "Bless" as its
  // icon + "10r" (label for screen readers), never folded; her other effects are in "+N".
  const chips = (scope: Locator, id: string) =>
    row(scope, id).locator('[data-testid="cbtx-init-row-effect"]:visible');
  // Sprint 7 (FR-CBTX-59): the concentration chip carries its rounds ("10r"), whole or icon-only
  // (the label then for screen readers), never cut.
  await expect(
    row(init, mira).locator('[data-testid="cbtx-init-row-effect"][data-value="concentration"]'),
  ).toHaveText(/^Bless ?10r$/);
  for (const scope of [init, pinit]) {
    await expect(row(scope, mira).getByTestId("cbtx-init-row-effect-more")).toHaveCount(1);
  }
  expect(await chips(init, mira).count()).toBe(1);
  const widths = await chips(init, mira).evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().width),
  );
  for (const w of widths) expect(w).toBeLessThanOrEqual(48.5);

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
  // P3 glitch 10: the whole text on hover when the row cuts it.
  await expect(pending.getByTestId("cbt-init-pending-text")).toHaveAttribute(
    "title",
    "Waiting for Mira: concentration save DC 10 (Bless)",
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
  // BL-01: Fit puts the map's top rows under the top-centre toasts; pan the monsters out of the
  // popup's way (the covered case is the sim-6 N8 test below).
  await panMap(dm, 0, 420);
  // Player-1: sheet Attack + damage → a damage card to the DM (sticky toast).
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet.getByTestId("charx-roll-attack-damage").first().click();
  const toast = dm.getByTestId("note-toast").filter({ has: dm.getByTestId("note-toast-action") });
  await expect(toast).toHaveCount(1);
  const cardId = (await toast.getAttribute("data-record-id")) as string;
  // The stack may re-place once the map settles (E1: token boxes re-read after the 4 s cue).
  await expect
    .poll(
      async () => {
        const a = await toast.boundingBox();
        await dm.waitForTimeout(500);
        const b = await toast.boundingBox();
        return a !== null && b !== null && a.x === b.x && a.y === b.y;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
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
  expect(Math.round((r?.y ?? 0) + (r?.height ?? 0))).toBe(vp.height - 12);
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
  // Grown to the work area's bottom, 12 px above the bottom edge (FR-SHELL-52, FR-KIT-14).
  const box = await init.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThan(480 - 12 - 4);
  // The count is what is really below the fold (rows not wholly above the footer).
  const below = (win: Locator) =>
    win.evaluate((w) => {
      const f = w.querySelector<HTMLElement>('[data-testid="cbt-init-more"]');
      const body = w.querySelector<HTMLElement>('[data-testid="ui-window-content"]')?.parentElement;
      const bottom = Math.min(
        (body ?? w).getBoundingClientRect().bottom,
        f && !f.hidden ? f.getBoundingClientRect().top : Infinity,
      );
      return [...w.querySelectorAll('[data-testid="cbt-init-row"]')].filter(
        (r) => r.getBoundingClientRect().bottom > bottom + 1,
      ).length;
    });
  const shown = async (win: Locator) =>
    Number(await win.getByTestId("cbt-init-more").getAttribute("data-value"));
  await expect.poll(async () => (await shown(init)) - (await below(init))).toBe(0);
  await more.click();
  await expect.poll(async () => Number(await more.getAttribute("data-value"))).toBeLessThan(n);

  // Walkthrough G4 regression: the window grows (here: a taller viewport) with no scroll and no
  // row change → the count follows at once and the footer hides when nothing is below the fold;
  // the player's window likewise.
  const pinit = await openWindow(player, "cbt.initiative");
  for (const page of [dm, player]) await page.setViewportSize({ width: 1280, height: 1000 });
  for (const win of [init, pinit]) {
    await expect(win.getByTestId("cbt-init-more")).toBeHidden();
    await expect(win.getByTestId("cbt-init-more")).toHaveAttribute("data-value", "0");
    expect(await below(win)).toBe(0);
  }
  // Back to short: the DM's count reappears and matches the rows below.
  await dm.setViewportSize({ width: 1280, height: 480 });
  await expect(more).toBeVisible();
  await expect.poll(async () => (await shown(init)) - (await below(init))).toBe(0);

  await player.context().close();
  await dm.context().close();
});

test("FR-CBTX-46 P3 glitch 6: '+N' lists the hidden effects (hover and click) on both clients", async ({
  browser,
}) => {
  const { dm, player, recordId } = await setup(browser);
  await viewAmbush(dm, player, recordId("battlemap", "scene"));
  const init = await openWindow(dm, "cbt.initiative");
  const pinit = await openWindow(player, "cbt.initiative");
  const mira = await idByName(init, "Mira");
  // Three more conditions on Mira: her chips no longer fit on either client.
  for (const condition of ["blinded", "deafened", "poisoned"]) {
    await row(init, mira).getByTestId("cbt-init-row-menu").click();
    await dm.getByTestId("cbtx-init-row-conditions").hover();
    await dm
      .locator(`[data-testid="cbtx-init-row-conditions-option"][data-value="${condition}"]`)
      .click();
    await dm.keyboard.press("Escape");
    await expect(
      statusEffect(row(init, mira), condition, condition[0]?.toUpperCase() + condition.slice(1)),
    ).toHaveCount(1);
  }
  for (const [page, scope] of [
    [dm, init],
    [player, pinit],
  ] as const) {
    const more = row(scope, mira).getByTestId("cbtx-init-row-effect-more");
    await expect(more).toBeVisible();
    const n = Number(await more.getAttribute("data-value"));
    // FR-KIT-28: the folded chips aren't drawn; "+N" lists exactly the effects not shown.
    const shown = await row(scope, mira)
      .locator('[data-testid="cbtx-init-row-effect"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));
    expect(n).toBeGreaterThanOrEqual(3);
    await more.click();
    const items = page.getByTestId("cbtx-init-row-effect-more-item");
    await expect(items).toHaveCount(n);
    const listed = await items.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-record-id")),
    );
    expect(listed.filter((id) => shown.includes(id))).toEqual([]);
    if (page === dm) {
      // DM: each hidden effect keeps its chip menu (Edit… / End).
      await items.first().hover();
      await expect(dm.getByTestId("cbtx-init-row-effect-edit")).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  // Clean up: the conditions end again.
  for (const condition of ["blinded", "deafened", "poisoned"]) {
    await row(init, mira).getByTestId("cbt-init-row-menu").click();
    await dm.getByTestId("cbtx-init-row-conditions").hover();
    await dm
      .locator(`[data-testid="cbtx-init-row-conditions-option"][data-value="${condition}"]`)
      .click();
    await dm.keyboard.press("Escape");
  }
  for (const condition of ["blinded", "deafened", "poisoned"]) {
    await expect(
      statusEffect(row(init, mira), condition, condition[0]?.toUpperCase() + condition.slice(1)),
    ).toHaveCount(0);
  }
  await player.context().close();
  await dm.context().close();
});

test("FR-NOTE-14 FR-NOTE-32 P3 E3: at 1280×720 a 4-card toast stack (3 + '+1 more') fits the viewport", async ({
  browser,
}) => {
  const { dm, player, recordId } = await setup(browser, 1280, 720);
  await viewAmbush(dm, player, recordId("battlemap", "scene"));
  const init = await openWindow(dm, "cbt.initiative");
  const sheet = await openWindow(player, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  const cards = dm.getByTestId("note-toast").filter({ has: dm.getByTestId("note-toast-action") });
  // Earlier tests may leave a card pending: count from here.
  await expect(init).toBeVisible();
  const before = await init.getByTestId("cbt-init-card").count();
  for (let i = 1; i <= 4; i++) {
    await sheet.getByTestId("charx-roll-attack-damage").first().click();
    await expect(init.getByTestId("cbt-init-card")).toHaveCount(before + i);
  }
  await expect(dm.getByTestId("note-toast-more")).toBeVisible();
  await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(1);
  // Every toast, its Apply and "+N more" lie inside the viewport, inside the work area.
  const bottom = 720 - 12;
  const boxes = async () =>
    dm.locator('[data-testid="note-toasts"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
  await expect.poll(async () => (await boxes()).bottom).toBeLessThanOrEqual(bottom);
  expect((await boxes()).top).toBeGreaterThanOrEqual(48);
  for (const apply of await dm.getByTestId("note-toast-action").all()) {
    await expect(apply).toBeInViewport();
  }

  // Clean up: dismiss the four cards from the Pending list.
  for (let i = 4; i > 0; i--) {
    await init.getByTestId("cbt-init-card").last().click();
    await dm.getByTestId("cbt-popup-dismiss").click();
    await expect(init.getByTestId("cbt-init-card")).toHaveCount(before + i - 1);
  }
  await player.context().close();
  await dm.context().close();
});

/** The drawn tokens' boxes (Konva group rects, as the placement reads them) and their names. */
async function tokenBoxes(dm: Page) {
  const labels = await konvaNodes(dm, "map-token-label");
  const boxes = await dm.evaluate(() => {
    type KNode = {
      id(): string;
      getClientRect(): { x: number; y: number; width: number; height: number };
    };
    type KStage = { container(): HTMLElement; find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    const stage = K?.stages.find((s) => s.container().isConnected);
    if (!stage) return [];
    const c = stage.container().getBoundingClientRect();
    return stage.find(".map-token").map((n) => {
      const r = n.getClientRect();
      return { id: n.id(), x: c.left + r.x, y: c.top + r.y, w: r.width, h: r.height };
    });
  });
  return boxes.map((b) => ({ ...b, name: labels.find((l) => l.id === b.id)?.text ?? "" }));
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The newest card toast's box once the stack holds still (it re-places when the map settles). */
async function settledToast(dm: Page, known: Set<string>) {
  const toast = dm
    .getByTestId("note-toast")
    .filter({ has: dm.getByTestId("note-toast-action") })
    .last();
  await expect
    .poll(async () => known.has((await toast.getAttribute("data-record-id")) ?? ""))
    .toBe(false);
  await expect
    .poll(
      async () => {
        const a = await toast.boundingBox();
        await dm.waitForTimeout(500);
        const b = await toast.boundingBox();
        return a !== null && b !== null && a.x === b.x && a.y === b.y;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const box = await toast.boundingBox();
  if (!box) throw new Error("no toast box");
  const id = (await toast.getAttribute("data-record-id")) as string;
  known.add(id);
  return { toast, id, box: { x: box.x, y: box.y, w: box.width, h: box.height } };
}

/** Closes the page's roll popups (FR-DICEX-39) with their ✕. */
async function closeRollPopups(page: Page) {
  const close = page.locator(
    '[data-testid="dicex-popup"]:not([data-state="closing"]) [data-testid="dicex-popup-close"]',
  );
  while ((await close.count()) > 0) await close.first().click();
  await expect(page.getByTestId("dicex-popup")).toHaveCount(0);
}

/** Closes the page's alert-class toasts (FR-NOTE-50) with their ✕; true if any was shown. */
async function closeAlertToasts(page: Page): Promise<boolean> {
  const close = page.locator('[data-class="alert"] [data-testid="ui-toast-close"]');
  let any = false;
  while ((await close.count()) > 0) {
    await close.first().click();
    any = true;
  }
  return any;
}

/** `toast`'s box once it holds still for 500 ms. */
async function stableBox(page: Page, toast: Locator): Promise<Box> {
  let box: Box | null = null;
  await expect
    .poll(
      async () => {
        const a = await toast.boundingBox();
        await page.waitForTimeout(500);
        const b = await toast.boundingBox();
        box = b && { x: b.x, y: b.y, w: b.width, h: b.height };
        return a !== null && b !== null && a.x === b.x && a.y === b.y;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  if (!box) throw new Error("no toast box");
  return box;
}

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
] as const) {
  test(`FR-CBT-75 sim-6 N8 at ${width}×${height}: the popup opens over its toast, or (that covers a likely target) at the nearest free spot`, async ({
    browser,
  }) => {
    const { dm, player, recordId } = await setup(browser, width, height);
    await viewAmbush(dm, player, recordId("battlemap", "scene"));
    // Initiative closed: the monsters it would cover stay grabbable on the map.
    const initWin = shellWindow(dm, "cbt.initiative");
    if (await initWin.isVisible()) await initWin.getByTestId("ui-window-close").click();
    const sheet = await openWindow(player, "char.sheet");
    await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
    const known = new Set(
      await dm
        .getByTestId("note-toast")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id") ?? "")),
    );
    // Mira's likely targets (FR-CBT-55): the monsters' tokens, every token but the PCs' and the
    // unbound reinforcement tokens (`cbtx-reinforcement`: Goblin 3, Wolf 2 are no combatants, so
    // the placement may cover them).
    const unbound = new Set(["Goblin 3", "Wolf 2"]);
    const monsters = async () =>
      (await tokenBoxes(dm)).filter(
        (t) => t.name !== "" && t.name !== "Mira" && t.name !== "Thorn" && !unbound.has(t.name),
      );
    const popup = dm.getByTestId("cbt-popup");

    // 1. A card toast: the popup opens with its top-left on the toast's, unless that covers a monster.
    await sheet.getByTestId("charx-roll-attack-damage").first().click();
    const first = await settledToast(dm, known);
    await first.toast.getByTestId("note-toast-action").click();
    await expect(popup).toHaveAttribute("data-record-id", first.id);
    const p1 = await popup.boundingBox();
    if (!p1) throw new Error("no popup box");
    const size = { w: p1.width, h: p1.height };
    // FR-CBT-75: the toast's top-left, clamped into the work area (below the top bar, 12 px above
    // the bottom edge).
    const origin = (b: Box) => ({
      x: Math.max(0, Math.min(b.x, width - size.w)),
      y: Math.max(48, Math.min(b.y, height - 12 - size.h)),
      ...size,
    });
    const atOrigin = origin(first.box);
    if ((await monsters()).some((t) => overlaps(atOrigin, t))) {
      await expect(popup).not.toHaveAttribute("data-side", "origin");
    } else {
      await expect(popup).toHaveAttribute("data-side", "origin");
      expect(Math.abs(p1.x - atOrigin.x)).toBeLessThan(2);
      expect(Math.abs(p1.y - atOrigin.y)).toBeLessThan(2);
    }
    await popup.getByTestId("cbt-popup-dismiss").click();
    await expect(popup).toHaveCount(0);

    // 2. A monster beside the toast, inside the popup's span there but clear of the toast:
    // the stack stays put, the popup over it would cover a likely target.
    const cell = Number(await dm.getByTestId("map-canvas").getAttribute("data-cell-px"));
    let card = first;
    let blocked = false;
    for (let attempt = 0; attempt < 3 && !blocked; attempt++) {
      // The roll popups (FR-DICEX-39) sit over the map's top rows below the toasts: closed, so
      // the cells under the toast's popup span stay grabbable.
      await closeRollPopups(dm);
      // FR-NOTE-50 (sprint 8): alert toasts ("Dice set to flat …") sit in the one stack under the
      // card: closed too, and the card's box read again once the shorter stack holds still. The
      // first card closed when its popup opened (FR-CBT-76): its last box stands. (Under load the
      // dice tray's slow-device alert, FR-DICEX-44, is what lands here.)
      if ((await closeAlertToasts(dm)) && (await card.toast.count()) > 0) {
        card = { ...card, box: await stableBox(dm, card.toast) };
      }
      // A monster the DM can grab (not under a window), the lowest one.
      const grabbable: Awaited<ReturnType<typeof monsters>> = [];
      for (const t of await monsters()) {
        const onMap = await dm.evaluate(
          ([x, y]) =>
            document.elementFromPoint(x, y)?.closest('[data-testid="map-canvas"]') !== null,
          [t.x + t.w / 2, t.y + t.h / 2] as const,
        );
        if (onMap) grabbable.push(t);
      }
      const m = grabbable.reduce((a, b) => (b.y > a.y ? b : a));
      const cx = m.x + m.w / 2;
      const cy = m.y + m.h / 2;
      // Cell centres lie on the token grid: of the free map cells wholly inside the popup's span
      // over the toast and clear of the toast, the one nearest the toast.
      const span = origin(card.box);
      const others = (await tokenBoxes(dm)).filter((t) => t.id !== m.id);
      // On the map image (a token must overlap the map).
      const [img] = await konvaNodes(dm, "map-image");
      if (!img) throw new Error("no map image");
      const onImage = (c: { x: number; y: number }) =>
        Math.abs(c.x - img.x) < img.width / 2 && Math.abs(c.y - img.y) < img.height / 2;
      const half = cell / 2 + 4;
      const cells: { x: number; y: number }[] = [];
      for (let i = -40; i <= 40; i++) {
        for (let j = -40; j <= 40; j++) {
          const c = { x: cx + i * cell, y: cy + j * cell };
          const r = { x: c.x - half, y: c.y - half, w: 2 * half, h: 2 * half };
          const inside =
            r.x >= span.x &&
            r.x + r.w <= span.x + span.w &&
            r.y >= span.y &&
            r.y + r.h <= span.y + span.h;
          if (inside && onImage(c) && !overlaps(r, card.box) && !others.some((t) => overlaps(r, t)))
            cells.push(c);
        }
      }
      const mid = { x: card.box.x + card.box.w / 2, y: card.box.y + card.box.h / 2 };
      cells.sort(
        (a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y),
      );
      let target: { x: number; y: number } | undefined;
      for (const c of cells) {
        const onMap = await dm.evaluate(
          ([x, y]) =>
            document.elementFromPoint(x, y)?.closest('[data-testid="map-canvas"]') !== null,
          [c.x, c.y] as const,
        );
        if (onMap) {
          target = c;
          break;
        }
      }
      if (!target) throw new Error("no free map cell under the popup's span beside the toast");
      const { x: tx, y: ty } = target;
      await dm.mouse.move(cx, cy);
      await dm.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await dm.mouse.move(cx + ((tx - cx) * i) / 6, cy + ((ty - cy) * i) / 6);
      }
      await dm.mouse.up();
      await expect
        .poll(async () => {
          const t = (await tokenBoxes(dm)).find((b) => b.id === m.id);
          return t ? Math.abs(t.x + t.w / 2 - tx) < 4 && Math.abs(t.y + t.h / 2 - ty) < 4 : false;
        })
        .toBe(true);
      await sheet.getByTestId("charx-roll-attack-damage").first().click();
      card = await settledToast(dm, known);
      const over = origin(card.box);
      blocked = (await monsters()).some((t) => overlaps(over, t));
    }
    expect(blocked).toBe(true);
    await card.toast.getByTestId("note-toast-action").click();
    await expect(popup).toHaveAttribute("data-record-id", card.id);
    await expect(popup).not.toHaveAttribute("data-side", "origin");
    const p2 = await popup.boundingBox();
    if (!p2) throw new Error("no popup box");
    const placed = { x: p2.x, y: p2.y, w: p2.width, h: p2.height };
    // Clear of every likely target, and near the toast: still overlapping its spot there (sim-6: it
    // went to the far bottom centre, 500+ px away). Not "within one popup height": the nearest free
    // spot (#200) may be diagonal, beside one target and below another (BL-34: 261 px at 259 tall).
    for (const t of await monsters()) expect(overlaps(placed, t)).toBe(false);
    expect(overlaps(placed, origin(card.box))).toBe(true);
    await popup.getByTestId("cbt-popup-dismiss").click();
    await expect(popup).toHaveCount(0);

    await player.context().close();
    await dm.context().close();
  });
}

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
  await initMenu(dm, init, "cbt-init-end");
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
