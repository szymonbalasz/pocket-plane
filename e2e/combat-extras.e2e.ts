// e2e-bundle: combat-extras
// Thin combat-extras flow (CBTX §13 E2E): DM + player-1. Goblin's token shows the HP bar and the
// prone icon for both; Mira (concentrating on Bless) is hit → player-1's sticky concentration toast
// → Roll save (physical dice, manual 8) → the card resolves for both. Visibility matrix, rules,
// undo, crash-resume: bun test (combat-extras *.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { showToPlayers } from "./support/scenes";
import { openWindow } from "./support/shell";

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().getByTestId("cbt-init-row-name").getByText(name, { exact: true }),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/** Konva attrs of the overlay nodes named `name` on the token `tokenId`. */
async function overlayAttrs(page: Page, name: string, tokenId: string) {
  return page.evaluate(
    ([name, tokenId]) => {
      type KNode = { id(): string; getAttr(a: string): unknown; isVisible(): boolean };
      type KStage = { find(s: string): KNode[] };
      const K = (window as unknown as { Konva?: { stages: KStage[] } }).Konva;
      return (K?.stages[0]?.find(`.${name}`) ?? [])
        .filter((n) => n.id() === tokenId && n.isVisible())
        .map((n) => ({
          tone: n.getAttr("tone"),
          fraction: n.getAttr("fraction"),
          value: n.getAttr("value"),
        }));
    },
    [name, tokenId] as const,
  );
}

test("FR-CBTX-17 FR-CBTX-18 FR-CBTX-28 FR-CBTX-29 bar + icons for both; concentration card → manual roll → resolved", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const goblinToken = recordId("battlemap", "token", 1);
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
  await showToPlayers(dm, "Goblin Ambush");
  await expect(player.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);

  // FR-CBTX-28/29: Goblin (3 temp HP, prone): DM proportional bar, player band bar; prone icon.
  await expect
    .poll(async () => (await overlayAttrs(dm, "cbtx-token-bar", goblinToken)).length)
    .toBe(1);
  expect((await overlayAttrs(dm, "cbtx-token-bar", goblinToken))[0]).toMatchObject({
    tone: "full",
    fraction: 1,
  });
  await expect
    .poll(async () =>
      // Players: band tone, no proportion (Konva drops a null attr).
      (await overlayAttrs(player, "cbtx-token-bar", goblinToken)).map((n) => [
        n.tone,
        n.fraction ?? null,
      ]),
    )
    .toEqual([["full", null]]);
  for (const page of [dm, player]) {
    await expect
      .poll(async () =>
        (await overlayAttrs(page, "cbtx-token-effect", goblinToken)).map((n) => n.value),
      )
      .toEqual(["prone"]);
  }
  await expect
    .poll(async () => (await konvaNodes(player, "cbtx-token-bar")).length)
    .toBeGreaterThan(0);

  // Initiative chips: Mira concentrates on Bless; Goblin prone (DM and player).
  const init = await openWindow(dm, "cbt.initiative");
  const pinit = await openWindow(player, "cbt.initiative");
  const mira = await idByName(init, "Mira");
  const goblin = await idByName(init, "Goblin");
  const chip = (scope: Locator, rowId: string, value: string) =>
    scope
      .locator(`[data-testid="cbt-init-row"][data-record-id="${rowId}"]`)
      .locator(`[data-testid="cbtx-init-row-effect"][data-value="${value}"]`);
  await expect(chip(init, mira, "concentration")).toHaveCount(1);
  await expect(chip(pinit, goblin, "prone")).toHaveCount(1);

  // Player-1: physical dice on (dice log Options), for the manual save below.
  const plog = await openWindow(player, "dice.log");
  const options = plog.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  await plog.getByTestId("dice-roll-physical").click();
  await expect(plog.getByTestId("dice-roll-physical")).toHaveAttribute("data-state", "checked");

  // Goblin attacks Mira: hit, damage total 3 → Mira 9 / 12, card DC 10 to player-1.
  // Attack ▸ → the first attack's Attack + damage (FR-CBT-74).
  await init.locator(`[data-testid="cbt-init-row-attack"][data-record-id="${goblin}"]`).click();
  await dm
    .locator(
      `[data-testid="cbt-init-row-attack-option"][data-record-id="${goblin}"][data-value="both"]`,
    )
    .click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${mira}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${mira}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await expect(hit).toHaveAttribute("data-value", "hit");
  await popup.getByTestId("cbt-popup-damage").fill("3");
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  await expect(
    init.locator(`[data-testid="cbt-init-row-hp"][data-record-id="${mira}"]`),
  ).toHaveText("HP 9/12");

  const toast = player
    .getByTestId("note-toast")
    .filter({ hasText: "Mira: concentration save DC 10 (Bless)" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-sticky", "true");
  const noteId = (await toast.getAttribute("data-record-id")) as string;
  const history = await openWindow(dm, "note.history");
  const dmRow = history.locator(`[data-testid="note-history-row"][data-record-id="${noteId}"]`);
  await expect(dmRow).toHaveAttribute("data-state", "pending");

  await toast.getByTestId("note-toast-action").click();
  const dialog = player.getByTestId("cbtx-note-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("cbtx-note-roll").click();
  await expect(player.getByTestId("dice-manual-label")).toHaveText(
    "Mira — Concentration save (DC 10)",
  );
  await player.getByTestId("dice-manual-total").fill("8");
  await player.getByTestId("dice-manual-submit").click();
  await expect(dialog).toHaveCount(0);
  await expect(dmRow).toHaveAttribute("data-state", "resolved");
  await expect(dmRow.getByTestId("cbtx-note-outcome")).toHaveText("DC 10: 12 — kept");
  // The concentration stays; no secret effect or hidden creature reached the player.
  await expect(chip(init, mira, "concentration")).toHaveCount(1);
  const raw = frames.join("\n");
  for (const leak of ["Hex", "Wolf 2", "sourceCombatantId", "concentrationId", '"tempHp":3']) {
    expect(raw).not.toContain(leak);
  }

  // Leave physical dice off and nobody online for later specs on this server.
  await plog.getByTestId("dice-log-physical-off").click();
  await player.context().close();
  await dm.context().close();
});

test("walkthrough fixes: row names stay distinct (chips collapse first), Conditions submenu by mouse, sheet Concentrate… dialog", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const init = await openWindow(dm, "cbt.initiative");
  const goblin = await idByName(init, "Goblin");
  const goblin2 = await idByName(init, "Goblin 2");
  const row = (id: string) => init.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

  // FR-CBTX-33 (walkthrough ruling): Goblin and Goblin 2 both carry chips; at the default width
  // the chips collapse to "+N" before the names, and Goblin 2's number is never cut off.
  await dm.keyboard.press("Escape");
  for (const id of [goblin, goblin2]) {
    await row(id).getByTestId("cbt-init-row-menu").click();
    await row(id).page().getByTestId("cbtx-init-row-conditions").hover();
    await dm
      .locator('[data-testid="cbtx-init-row-conditions-option"][data-value="frightened"]')
      .click();
    await expect(
      row(id).locator('[data-testid="cbtx-init-row-effect"][data-value="frightened"]'),
    ).toHaveCount(1);
  }
  const fit = await init.evaluate((w) => {
    const rows = [
      ...w.querySelectorAll<HTMLElement>("[data-testid='cbt-init-row']:not([data-removed])"),
    ];
    return rows.map((r) => {
      const name = r.querySelector<HTMLElement>("[data-testid='cbt-init-row-name']") as HTMLElement;
      const box = name.getBoundingClientRect();
      const base = name.querySelector<HTMLElement>("[data-name-base]")?.getBoundingClientRect();
      const suffix = name.querySelector<HTMLElement>("[data-name-suffix]")?.getBoundingClientRect();
      const moved = r.querySelector<HTMLElement>("[data-testid='cbt-init-row-moved']");
      const line = moved?.parentElement?.getBoundingClientRect();
      const m = moved?.getBoundingClientRect();
      return {
        name: name.dataset.value,
        height: Math.round(r.getBoundingClientRect().height),
        baseWidth: Math.round(base?.width ?? 0),
        suffixShown: suffix ? suffix.width > 0 && suffix.right <= box.right + 0.5 : null,
        movedClipped: m && line ? m.right > line.right + 0.5 || m.width === 0 : false,
        lineHeight: Math.round(line?.height ?? 0),
        wrap: r.querySelector("[data-chip-row]")?.getAttribute("data-wrap") === "true",
        cut: (() => {
          const b = name.querySelector<HTMLElement>("[data-name-base]");
          return !!b && b.scrollWidth > b.clientWidth;
        })(),
      };
    });
  });
  const byName = Object.fromEntries(fit.map((f) => [f.name, f]));
  expect(byName["Goblin 2"]?.suffixShown).toBe(true);
  for (const f of fit) {
    expect({ name: f.name, base: f.baseWidth >= 14, clipped: f.movedClipped }).toEqual({
      name: f.name,
      base: true,
      clipped: false,
    });
  }
  // One line of chips: no row grows past Wolf's (a monster row with no effect), so FR-SHELL-32's
  // 6 rows hold; the name line stays one line. FR-CBTX-54 (W4 re-test, #182): a row grows only
  // when its chips take the second line, and its name is then whole.
  const wolfHeight = byName.Wolf?.height ?? 0;
  for (const f of fit) {
    const grew = f.height > wolfHeight || f.lineHeight > 24;
    expect({ name: f.name, grew: grew && !f.wrap, cut: f.wrap && f.cut }).toEqual({
      name: f.name,
      grew: false,
      cut: false,
    });
  }

  // Walkthrough step 12 (mouse): Initiative row → Conditions ▸ Stunned by mouse click.
  await row(goblin).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbtx-init-row-conditions").hover();
  const stunned = dm.locator(
    '[data-testid="cbtx-init-row-conditions-option"][data-value="stunned"]',
  );
  await stunned.hover();
  await stunned.click();
  await expect(
    row(goblin).locator('[data-testid="cbtx-init-row-effect"][data-value="stunned"]'),
  ).toHaveCount(1);

  // §7.1: player-2's own sheet → effects menu → Concentrate… opens a dialog; Thorn concentrates.
  const player = await rolePage(browser);
  await player.goto(link("Player 2"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const sheet = await openWindow(player, "char.sheet");
  // P3 glitch 12 / FR-KIT-85: the Effects menu sits in the pinned header (its chips line), with
  // Edit top-right, not on a row of its own.
  const headerLine = sheet.getByTestId("charx-header");
  await expect(headerLine.getByTestId("cbtx-sheet-effects-menu")).toBeVisible();
  await expect(headerLine.getByTestId("charx-edit-toggle")).toBeVisible();
  await sheet.getByTestId("cbtx-sheet-effects-menu").click();
  await player.getByTestId("cbtx-sheet-concentrate").click();
  const dialog = player.getByTestId("cbtx-sheet-conc-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("cbtx-conc-label").fill("Shield of Faith");
  await dialog.getByTestId("cbtx-conc-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(
    sheet.locator('[data-testid="cbtx-sheet-effect"][data-value="concentration"]'),
  ).toHaveCount(1);
  const thorn = await idByName(init, "Thorn");
  await expect(
    row(thorn).locator('[data-testid="cbtx-init-row-effect"][data-value="concentration"]'),
  ).toHaveCount(1);

  await player.context().close();
  await dm.context().close();
});
