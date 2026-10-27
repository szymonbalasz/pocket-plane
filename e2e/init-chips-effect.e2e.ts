// e2e-bundle: init-chips-effect
// Sprint 5 W4 (play-shell §13 W6–W8): DM and player-1 at 1440×900. W6 Brakka's Rage on (`windows-s5`) →
// "Rage 10r" and Divine Fury both shown on her Initiative row, no trigger in "+N"; at the min
// width (DM 320, player 240) Divine Fury is whole or an icon chip with a Tooltip naming it (icon
// on the player's 240 in both themes; the DM's 320 by the theme's glyph widths) (FR-CBTX-54). W7 Goblin 2's token menu: one "Invisible" (fog's, with its Tooltip), Conditions ▸
// 14 without Invisible; the Initiative row's Conditions ▸ keeps 15 (FR-CBTX-56, FR-FOG-59). W8 the
// hidden Wolf's turn: Mira's Effect… → Blinded defaults its source to Mira, the hint follows, the
// source is sent as shown and player-1 gets Blinded (FR-CBTX-55). Fit rule, icon markup, source
// rule: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { tokenNode } from "./support/konva";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const rowOf = (init: Locator, id: string) =>
  init.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

async function idByName(scope: Locator, name: string): Promise<string> {
  const r = scope.locator('[data-testid="cbt-init-row"]').filter({
    has: scope.page().locator(`[data-testid="cbt-init-row-name"][data-value="${name}"]`),
  });
  return (await r.first().getAttribute("data-record-id")) as string;
}

/** Shrinks a window to its minimum width `min` (the handle dragged far left; the shell clamps). */
async function toMinWidth(page: Page, win: Locator, min: number) {
  const h = await win.getByTestId("ui-window-resize").boundingBox();
  if (!h) throw new Error("no resize handle");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(h.x + h.width / 2 - 100 * i, h.y + 4);
  await page.mouse.up();
  await expect.poll(async () => Math.round((await win.boundingBox())?.width ?? 0)).toBe(min);
}

/** A chip shown whole on its row: inside the chip line's box, not clipped. */
async function shownWhole(chip: Locator) {
  await expect(chip).toBeVisible();
  const fits = await chip.evaluate((el) => {
    const line = el.closest("[data-chip-row]") as HTMLElement;
    const a = el.getBoundingClientRect();
    const b = line.getBoundingClientRect();
    return a.width > 0 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
  });
  expect(fits).toBe(true);
}

/**
 * Brakka's row: Divine Fury whole, never in "+N"; "Rage 10r" whole too unless `rageFolds` (the
 * player's 240 px min: Rage folds into "+1" after Divine Fury went icon-only).
 */
async function bothShown(row: Locator, rageFolds = false) {
  const rage = row.getByTestId("cbtx-init-row-effect").filter({ hasText: "Rage" });
  if (rageFolds) {
    await expect(rage).toBeHidden();
    await expect(row.getByRole("button", { name: /^More effects: Rage/ })).toHaveCount(1);
  } else await shownWhole(rage);
  const fury = row.getByTestId("cbtx-trigger-chip").filter({ hasText: "Divine Fury" });
  await shownWhole(fury);
  // "+N" names folded effects only.
  await expect(row.getByRole("button", { name: /^More effects: .*Divine/ })).toHaveCount(0);
  // #182: the name is never cut.
  const name = row.locator("[data-name-base]");
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  return fury;
}

test("FR-CBTX-54 W6 trigger chips never fold: 'Rage 10r' + Divine Fury on Brakka's row at 1440×900 and at 320 wide, DM and player-1", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);

  // The DM's Initiative: 400 → 320 (min); the player's: 280 → 240 (min).
  const compacted: string[] = [];
  for (const [page, min, rageFolds] of [
    [dm, 320, false],
    // FR-KIT-28: the status cell shows the first effect (Rage) as its icon, never folded.
    [p1, 240, false],
  ] as const) {
    const init = await openWindow(page, "cbt.initiative");
    const brakka = rowOf(init, await idByName(init, "Brakka"));
    const fury = await bothShown(brakka);
    // Narrow: Divine Fury goes icon-only first ("Rage 10r" whole), still shown.
    await toMinWidth(page, init, min);
    const compact = await bothShown(brakka, rageFolds);
    // #182 on every row, hidden ones too (eye-off after the name; W4 walkthrough W6c): no name
    // cut, every trigger chip kept (on the name line or the row's second line).
    await expect
      .poll(() =>
        init
          .locator("[data-name-base]")
          .evaluateAll((els) =>
            els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
          ),
      )
      .toEqual([]);
    // The DM's rows include the hidden ones (Wolf, Goblin, Elite); players get none.
    if (page === dm) {
      await expect(
        init.locator('[data-testid="cbt-init-row"][data-hidden="true"]'),
      ).not.toHaveCount(0);
    }
    // Icon-only once the full label no longer fits (FR-CBTX-58): the theme's glyph widths decide
    // where (Gilt & Stone's narrower type keeps it whole on the DM's 320 line); whole otherwise.
    if ((await compact.getAttribute("data-compact")) === "true") {
      compacted.push(page === dm ? "dm" : "player-1");
      await expect(compact.locator("svg.lucide-zap")).toBeVisible();
      await compact.hover();
      await expect(page.getByTestId("ui-tooltip")).toContainText("Divine Fury");
      await page.mouse.move(5, 450);
    } else await expect(compact).toContainText("Divine Fury"); // whole: bothShown checked the fit
    expect(await fury.count()).toBe(1);
  }
  // The icon-only chip shows on at least one client (the player's 240 at the latest).
  expect(compacted).toContain("player-1");

  for (const page of [p1, dm]) await page.context().close();
});

test("FR-CBTX-56 FR-FOG-59 W7 one Invisible item: Goblin 2's token menu has fog's Invisible only; Conditions ▸ 14 there, 15 on the row", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const ambush = recordId("battlemap", "scene");
  const goblin2Token = recordId("goblin-2", "token");
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  const sent: string[] = [];
  dm.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await loginDm(dm, secret);
  await live(dm);

  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await scenes.getByTestId("ui-window-close").click();
  const init = await openWindow(dm, "cbt.initiative");
  const goblin2 = await idByName(init, "Goblin 2");
  await init.getByTestId("ui-window-close").click();
  await expect(init).toBeHidden();

  await dm.getByTestId("map-tool-select").click();
  await expect.poll(async () => (await tokenNode(dm, goblin2Token)) !== null).toBe(true);
  const g = (await tokenNode(dm, goblin2Token)) as { x: number; y: number };
  await dm.mouse.click(g.x, g.y, { button: "right" });
  const menu = dm.getByTestId("map-token-menu");
  await expect(menu).toBeVisible();
  // Exactly one item labelled "Invisible": fog's checkbox.
  await expect(menu.getByRole("menuitemcheckbox", { name: "Invisible", exact: true })).toHaveCount(
    1,
  );
  const fog = dm.getByTestId("fog-token-menu-invisible");
  await expect(fog).toHaveAttribute("data-state", "unchecked");
  await fog.hover();
  await expect(dm.getByTestId("ui-tooltip")).toHaveText(
    "Players don't see it unless they see invisible",
  );
  // Conditions ▸: the 14 others, no Invisible.
  await dm.getByTestId("cbtx-token-menu-conditions").hover();
  const options = dm.getByTestId("cbtx-token-menu-conditions-option");
  await expect(options).toHaveCount(14);
  await expect(
    dm.locator('[data-testid="cbtx-token-menu-conditions-option"][data-value="invisible"]'),
  ).toHaveCount(0);
  await expect(dm.getByRole("menuitem", { name: "Invisible", exact: true })).toHaveCount(0);
  // The one item still toggles fog's token state: one `fog.setInvisible`.
  await dm.keyboard.press("Escape");
  await dm.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await dm.mouse.click(g.x, g.y, { button: "right" });
  const before = sent.filter((f) => f.includes('"fog.setInvisible"')).length;
  await dm.getByTestId("fog-token-menu-invisible").click();
  await expect
    .poll(() => sent.filter((f) => f.includes('"fog.setInvisible"')).length)
    .toBe(before + 1);
  await dm.mouse.click(g.x, g.y, { button: "right" });
  await expect(dm.getByTestId("fog-token-menu-invisible")).toHaveAttribute("data-state", "checked");
  await dm.keyboard.press("Escape");

  // The Initiative row's Conditions ▸ keeps all 15 (Invisible as a reminder).
  const init2 = await openWindow(dm, "cbt.initiative");
  await rowOf(init2, goblin2).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbtx-init-row-conditions").hover();
  await expect(dm.getByTestId("cbtx-init-row-conditions-option")).toHaveCount(15);
  await expect(
    dm.locator('[data-testid="cbtx-init-row-conditions-option"][data-value="invisible"]'),
  ).toHaveCount(1);

  await dm.context().close();
});

test("FR-CBTX-55 W8 effect source default: the hidden Wolf's turn → Mira's Effect… Blinded defaults to Mira, sent as shown; player-1 gets Blinded", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  const sent: string[] = [];
  dm.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);

  const init = await openWindow(dm, "cbt.initiative");
  const wolf = await idByName(init, "Wolf");
  const mira = await idByName(init, "Mira");
  await expect(rowOf(init, wolf)).toHaveAttribute("data-turn", "true");
  await expect(rowOf(init, wolf)).toHaveAttribute("data-hidden", "true");

  await rowOf(init, mira).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbtx-init-row-effect-new").click();
  const dialog = dm.getByTestId("cbtx-effect");
  await expect(dialog).toBeVisible();
  await dm.getByTestId("cbtx-effect-condition").click();
  await dm.locator('[data-testid="cbtx-effect-condition-option"][data-value="blinded"]').click();
  const source = dm.getByTestId("cbtx-effect-source");
  await expect(source).toHaveAttribute("data-default", "target");
  await expect(source).toHaveText("Mira");
  await dm.getByTestId("cbtx-effect-duration").fill("1");
  await expect(dialog).toContainText("Ends at the start of Mira's turn, round 2");
  // The hidden Wolf stays pickable, marked with the eye-off icon.
  await source.click();
  const wolfOption = dm.locator(`[data-testid="cbtx-effect-source-option"][data-value="${wolf}"]`);
  await expect(wolfOption.getByLabel("Hidden")).toBeVisible();
  await dm.keyboard.press("Escape");
  await dm.getByTestId("cbtx-effect-save").click();
  await expect(dialog).toBeHidden();

  const add = sent.map((f) => JSON.parse(f)).find((f) => f.name === "cbtx.addEffect");
  expect(add?.payload.condition).toBe("blinded");
  expect(add?.payload.sourceCombatantId).toBe(mira);

  // B (player-1) gets Blinded on Mira's row.
  const pinit = await openWindow(p1, "cbt.initiative");
  await expect(
    rowOf(pinit, mira).locator('[data-testid="cbtx-init-row-effect"][data-value="blinded"]'),
  ).toHaveCount(1);

  for (const page of [p1, dm]) await page.context().close();
});
