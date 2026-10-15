// e2e-bundle: combat
// Thin combat flow (CBT §13 E2E): DM + player-1. Encounter card, Start on Goblin Ambush, roll
// monsters, Mira's sheet initiative + Attack (routed to cbt.*), round 1, DM targets Goblin and
// Goblin 2 in the non-modal popup (target rings), applies (Goblin half) → player sees the bands;
// one Undo reverts both; N7: sheet Attack then Damage fill one card, applied from its toast;
// Remove → Out badge for the player; End from Initiative (#171: no roll
// controls from round 1, Down cross; polish: Start / End move the DM's windows, End dismisses the
// reopened card). Visibility matrix, hooks, movement,
// crash-resume: bun test (combat-tracker sync.test.ts, feedback.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes, tokenNode } from "./support/konva";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

const row = (scope: Page | Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

/** Token ids with a `map-token-ring` in state `target` (FR-CBT-38). */
async function targetRings(page: Page) {
  return page.evaluate(() => {
    type KNode = {
      getAttr(a: string): unknown;
      findAncestor(s: string): KNode | null;
      id(): string;
    };
    type KStage = { find(s: string): KNode[] };
    const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
    return (K?.stages[0]?.find(".map-token-ring") ?? [])
      .filter((n) => n.getAttr("state") === "target")
      .map((n) => n.findAncestor(".map-token")?.id() ?? "")
      .sort();
  });
}

test("FR-CBT-07 FR-CBT-33 FR-CBT-34 FR-CBT-35 FR-CBT-38 start, sheet rolls, multi-target apply, band, undo, Out", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const encounterId = recordId("encounter-1", "encounter");
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

  // DM views Goblin Ambush and shows it to players.
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await dm.getByTestId("map-show-to-players").click();

  // Step 1: the encounter card.
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.locator(`[data-testid="cbt-enc-row"][data-record-id="${encounterId}"]`).click();
  await expect(enc.getByTestId("cbt-enc-rating")).toHaveText("Deadly");
  await expect(enc.getByTestId("cbt-enc-xp-base")).toHaveText("250");
  await expect(enc.getByTestId("cbt-enc-xp-adjusted")).toHaveText("625");
  await expect(enc.getByTestId("cbt-enc-total-cr")).toHaveText("1.25");
  // Step 2 (FR-CBT-63): lookup — no list before typing; "wo" → Enter: Wolf ×2, the list closes,
  // focus stays in the input; then −1.
  const wolfDef = recordId("enemy-2", "imported-entity");
  const wolfEntry = enc.locator(`[data-testid="cbt-enc-entry"][data-record-id="${wolfDef}"]`);
  const lookup = enc.getByTestId("cbt-lookup-input");
  await lookup.click();
  await expect(dm.getByTestId("cbt-lookup-option")).toHaveCount(0);
  await lookup.fill("wo");
  await expect(dm.getByTestId("cbt-lookup-option").first()).toHaveAttribute(
    "data-record-id",
    wolfDef,
  );
  await lookup.press("Enter");
  await expect(dm.getByTestId("cbt-lookup-option")).toHaveCount(0);
  await expect(lookup).toBeFocused();
  await expect(wolfEntry).toHaveAttribute("data-value", "2");
  await expect(enc.getByTestId("cbt-enc-xp-adjusted")).toHaveText("750");
  await wolfEntry.getByTestId("cbt-enc-entry-dec").click();
  await expect(wolfEntry).toHaveAttribute("data-value", "1");
  await expect(enc.getByTestId("cbt-enc-xp-adjusted")).toHaveText("625");
  await dm.waitForTimeout(800); // debounced save lands before Start
  await expect(
    player.locator('[data-testid="ui-launcher-button"][data-record-id="cbt.initiative"]'),
  ).toHaveCount(0);

  // Step 2a (FR-CBT-62): both add options ticked; Elite has no HP formula.
  await expect(enc.getByTestId("cbt-enc-create-tokens")).toHaveAttribute("data-state", "checked");
  await expect(enc.getByTestId("cbt-enc-add-hidden")).toHaveAttribute("data-state", "checked");
  // Step 3: Start → preview: every row "token", no "Not on this map" → confirm.
  await enc.getByTestId("cbt-enc-start").click();
  await expect(dm.getByTestId("cbt-enc-binding")).toHaveCount(6);
  await expect(dm.locator('[data-testid="cbt-enc-binding"][data-value="token"]')).toHaveCount(6);
  await expect(dm.getByTestId("cbt-enc-not-on-map")).toHaveCount(0);
  await dm.getByTestId("cbt-enc-start-confirm").click();
  // FR-CBT-60: after the ack Initiative opens in front and Encounters minimises.
  await expect(launcherButton(dm, "cbt.encounters")).toHaveAttribute("data-state", "minimised");
  await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "open");

  const init = await openWindow(dm, "cbt.initiative");
  await expect(init.getByTestId("cbt-init-row")).toHaveCount(6);
  await expect(init.locator('[data-testid="cbt-init-row"][data-hidden="true"]')).toHaveCount(2);
  const pinit = await openWindow(player, "cbt.initiative");
  await expect(pinit.getByTestId("cbt-init-row")).toHaveCount(4);
  // FR-CBT-39: every bound row shows its whole movement used, "0 / 30 ft" (nothing clipped).
  await expect(init.getByTestId("cbt-init-row-moved")).toHaveCount(6);
  const clippedMoved = await init.evaluate(
    (w) =>
      [...w.querySelectorAll("[data-testid='cbt-init-row-moved']")].filter((el) => {
        const r = el.getBoundingClientRect();
        const box = (el.parentElement as HTMLElement).getBoundingClientRect();
        return r.width === 0 || r.left < box.left - 0.5 || r.right > box.right + 0.5;
      }).length,
  );
  expect(clippedMoved).toBe(0);

  // Step 4: monsters rolled at Start (FR-CBT-64), so no "Roll monsters"; Mira rolls from her
  // sheet (routed to cbt.rollInitiative); DM sets Thorn; Start round 1.
  await expect(init.getByTestId("cbt-init-roll-monsters")).toHaveCount(0);
  const mira = await idByName(init, "Mira");
  // #149: an unset initiative leads with a labelled Roll button, not an empty box.
  await expect(
    init.locator(`[data-testid="cbt-init-row-roll"][data-record-id="${mira}"]`),
  ).toHaveText("Roll");
  await expect(
    init.locator(`[data-testid="cbt-init-row-init"][data-record-id="${mira}"]`),
  ).toHaveAttribute("placeholder", "–");
  const sheet = await openWindow(player, "char.sheet");
  await expect(sheet.getByTestId("char-sheet-combat")).toBeVisible();
  await expect(pinit.getByTestId("cbt-init-hint")).toBeVisible();
  await sheet.getByTestId("char-sheet-roll-init").click();
  await expect(row(pinit, mira).getByTestId("cbt-init-row-init")).not.toHaveText("—");
  await expect(pinit.getByTestId("cbt-init-hint")).toHaveCount(0);
  const thorn = await idByName(init, "Thorn");
  const thornInput = init.locator(`[data-testid="cbt-init-row-init"][data-record-id="${thorn}"]`);
  await thornInput.fill("10");
  await thornInput.press("Enter");
  await expect(row(pinit, thorn).getByTestId("cbt-init-row-init")).toHaveText("10");
  await init.getByTestId("cbt-init-next").click();
  await expect(init.getByTestId("cbt-init-round")).toHaveAttribute("data-value", "1");
  await expect(pinit.getByTestId("cbt-init-round")).toHaveAttribute("data-value", "1");
  // FR-CBT-46 / FR-CHAR-24 (#172): from round 1 everyone has initiative, so nobody re-rolls:
  // no row Roll, no "Roll monsters", and the sheet's Initiative reads "Initiative set".
  await expect(init.getByTestId("cbt-init-row-roll")).toHaveCount(0);
  await expect(init.getByTestId("cbt-init-roll-monsters")).toHaveCount(0);
  await expect(init.getByTestId("cbt-init-row-init")).toHaveCount(6);
  await expect(sheet.getByTestId("char-sheet-roll-init")).toHaveCount(0);
  await expect(sheet.getByTestId("char-sheet-init-locked")).toHaveText("Initiative set");
  await expect(sheet.getByTestId("char-sheet-combat")).toBeVisible();

  // Step 6–7: Mira attacks from the sheet → card pending for the DM. In the non-modal popup the
  // DM adds Goblin and Goblin 2 (tokens on the viewed scene → selected, target rings); Goblin
  // hit, 8 damage, Half → 7 → 3; Goblin 2 hit, Normal → 7 → 0 (bands for the player).
  // Attacks live on the Actions tab (FR-CHARX-44); Attack + damage → cbt.attack (FR-CHARX-43).
  await sheet.locator('[data-testid="charx-tab"][data-value="actions"]').click();
  await sheet
    .getByTestId("charx-attack")
    .filter({ hasText: "Shortsword" })
    .getByTestId("charx-roll-attack-damage")
    .click();
  const card = init.getByTestId("cbt-init-card");
  await expect(card).toHaveCount(1);
  // #149: the DM's sticky card toast sits top-centre, clear of the Initiative rows.
  await expect(dm.getByTestId("note-toasts")).toHaveAttribute("data-placement", "top-center");
  await card.click();
  const goblin = await idByName(init, "Goblin");
  const goblin2 = await idByName(init, "Goblin 2");
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  // FR-CBT-56: no rows; Mira's likely targets (the monsters) are right of centre → left edge.
  await expect(popup).toHaveAttribute("data-side", "left");
  await expect(popup.getByTestId("cbt-popup-target-row")).toHaveCount(0);
  for (const id of [goblin, goblin2]) {
    await popup.getByTestId("cbt-popup-target-add").click();
    await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${id}"]`).click();
  }
  const trow = (id: string) =>
    popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${id}"]`);
  await expect(trow(goblin)).toHaveAttribute("data-source", "selection");
  await expect(trow(goblin2)).toHaveAttribute("data-source", "selection");
  await expect.poll(async () => (await targetRings(dm)).length).toBe(2);
  await expect(trow(goblin)).toContainText("vs AC 15");
  await popup.getByTestId("cbt-popup-damage").fill("8");
  for (const id of [goblin, goblin2]) {
    const hit = trow(id).getByTestId("cbt-popup-target-hit");
    if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
    await expect(hit).toHaveAttribute("data-value", "hit");
  }
  await trow(goblin)
    .locator('[data-testid="cbt-popup-target-mult-option"][data-value="half"]')
    .click();
  await expect(trow(goblin).getByTestId("cbt-popup-target-preview")).toHaveText("Goblin 7 → 3");
  await expect(trow(goblin2).getByTestId("cbt-popup-target-preview")).toHaveText("Goblin 2 7 → 0");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect.poll(async () => (await targetRings(dm)).length).toBe(0);
  await expect(row(pinit, goblin).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "bloodied",
  );
  await expect(row(pinit, goblin2).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "down",
  );
  await expect(row(init, goblin).getByTestId("cbt-init-row-hp")).toHaveText("HP 3/7");
  await expect.poll(async () => (await konvaNodes(player, "cbt-token-down")).length).toBe(1);
  // FR-CBT-48: Down is a translucent X centred on Goblin 2's token, for the DM and the player.
  for (const page of [dm, player]) {
    const [down] = await konvaNodes(page, "cbt-token-down");
    const tok = down ? await tokenNode(page, down.id) : null;
    expect(down && tok).toBeTruthy();
    if (!down || !tok) continue;
    expect(Math.abs(down.x - tok.x)).toBeLessThan(2);
    expect(Math.abs(down.y - tok.y)).toBeLessThan(2);
    expect(down.opacity).toBeLessThan(1);
  }
  // FR-CBT-49: no PC is down, so no PC row carries a Down Badge.
  await expect(row(init, mira).getByTestId("cbt-init-row-band")).toHaveCount(0);

  // Step 9: one Undo reverts the whole apply (both targets); the card is pending again.
  await expect(init.getByTestId("cbt-init-undo")).toHaveAttribute(
    "aria-label",
    "Undo: Mira → Goblin, Goblin 2 (2 targets)",
  );
  await init.getByTestId("cbt-init-undo").click();
  await expect(row(pinit, goblin).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "healthy",
  );
  await expect(row(pinit, goblin2).getByTestId("cbt-init-row-band")).toHaveAttribute(
    "data-value",
    "healthy",
  );
  await expect(init.getByTestId("cbt-init-card")).toHaveCount(1);

  // N7 (FR-CBT-70/71, X-5): Mira's sheet Attack (to-hit only) → one DM toast; her Damage completes
  // that card: the same toast's text gains the damage (no second toast). The DM opens it from the
  // toast → popup over it, toast gone; Goblin hit; Apply.
  const shortsword = sheet.getByTestId("charx-attack").filter({ hasText: "Shortsword" });
  await shortsword.getByTestId("charx-roll-attack").click();
  const splitToast = dm.getByTestId("note-toast").filter({ hasText: "to hit (Shortsword)" });
  await expect(splitToast).toHaveCount(1);
  const splitId = (await splitToast.getAttribute("data-record-id")) as string;
  await shortsword.getByTestId("charx-roll-damage").click();
  const sameToast = dm.locator(`[data-testid="note-toast"][data-record-id="${splitId}"]`);
  await expect(sameToast).toContainText(/Mira: \d+ to hit(?: \(natural \d+\))?, \d+ piercing/);
  await expect(dm.getByTestId("note-toast").filter({ hasText: "Mira:" })).toHaveCount(1);
  await expect(init.getByTestId("cbt-init-card")).toHaveCount(2);
  await sameToast.getByTestId("note-toast-action").click();
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute("data-record-id", splitId);
  await expect(sameToast).toHaveCount(0);
  await expect(popup.getByTestId("cbt-popup-waiting-damage")).toHaveCount(0);
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const splitHit = trow(goblin).getByTestId("cbt-popup-target-hit");
  if ((await splitHit.getAttribute("data-value")) === "miss") await splitHit.click();
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(init.getByTestId("cbt-init-card")).toHaveCount(1);

  // Step 11: Remove Goblin 2 → Out badge for the player; it leaves the player's Initiative.
  await row(init, goblin2).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbt-init-row-remove").click();
  await expect.poll(async () => (await konvaNodes(player, "cbt-token-out")).length).toBe(1);
  await expect(row(pinit, goblin2)).toHaveCount(0);

  // Step 14: End from the Initiative header (FR-CBT-51) → confirm names the reopened card
  // (FR-CBT-59); the dialog closes; the card is dismissed; DM Initiative minimised (FR-CBT-60),
  // empty when reopened; Ended in the list; player Initiative gone.
  await init.getByTestId("cbt-init-end").click();
  await expect(dm.getByTestId("cbt-init-end-pending")).toHaveAttribute("data-value", "1");
  await expect(dm.getByTestId("cbt-init-end-pending")).toHaveText(
    "1 pending card will be dismissed: apply them first if they count.",
  );
  await dm.getByTestId("cbt-init-end-confirm").click();
  await expect(dm.getByTestId("cbt-init-end-confirm")).toHaveCount(0);
  await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "minimised");
  const init2 = await openWindow(dm, "cbt.initiative");
  await expect(init2.getByTestId("cbt-init-empty")).toBeVisible();
  const history = await openWindow(dm, "note.history");
  // The reopened step-6 card is dismissed; the N7 card stays resolved.
  await expect(
    history.locator('[data-testid="note-history-row"][data-state="dismissed"]').filter({
      hasText: "Mira:",
    }),
  ).toHaveCount(1);
  const enc2 = await openWindow(dm, "cbt.encounters");
  const encRow = enc2.locator(`[data-testid="cbt-enc-row"][data-record-id="${encounterId}"]`);
  if (await encRow.isVisible()) await encRow.click();
  await expect(enc2.getByTestId("cbt-enc-status")).toHaveText("ended");
  await expect(shellWindow(player, "cbt.initiative")).toHaveCount(0);

  const raw = frames.join("\n");
  for (const s of ["Elite Goblin Warrior", "Ambush at the Ford", '"position"', "hp-change"]) {
    expect({ s, leaked: raw.includes(s) }).toEqual({ s, leaked: false });
  }
  await player.context().close();
  await dm.context().close();
});

async function idByName(scope: Locator, name: string): Promise<string> {
  // By the full name: the row splits "Goblin 2" into "Goblin" + " 2" (CBTX `RowName`).
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}
