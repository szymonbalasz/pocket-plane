// e2e-bundle: sp-palette-e2e
// Thin SP1 flows (play-shell §13 sprint 9, FR-SHELL-180–197): the DM's Ctrl+K "comp" Enter opens
// the Compendium; L toggles the Game log from the map, never from the roll bar (where "l" types);
// N advances the turn and Shift+N takes it back; `?` opens the shortcuts sheet. Player 1: Ctrl+K
// "goblin" lists no monster row (FR-CMP-14 server-side). Ranking, keys, guards: bun test.
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Press `key` with focus on the map canvas (outside any text field or window). */
async function onMap(page: Page, key: string) {
  await page.getByTestId("map-canvas").focus();
  await page.keyboard.press(key);
}

const lastShortcut = (page: Page) => page.locator("body").getAttribute("data-test-last-shortcut");

test("SP1 DM: Ctrl+K finds and opens a window; L toggles the Game log off the map only; N / Shift+N step the turn; ? lists the keys; Pause… opens the Popover", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);

  // Ctrl+K "comp" Enter → the Compendium window.
  await onMap(dm, "Control+k");
  const palette = dm.getByTestId("ui-palette");
  await expect(palette).toBeVisible();
  await expect(dm.getByTestId("ui-palette-input")).toBeFocused();
  await dm.keyboard.type("comp");
  await expect(
    dm.locator('[data-testid="ui-palette-item"][data-record-id="cmp.compendium"]'),
  ).toBeVisible();
  await dm.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(dm.getByTestId("cmp-window")).toBeVisible();

  // L from the map toggles the Game log (behind the Compendium → front; on top → minimised).
  const log = shellWindow(dm, "dice.log");
  await onMap(dm, "l");
  await expect(log).toHaveAttribute("data-state", "open");
  await expect.poll(() => lastShortcut(dm)).toBe("window.log:ran");
  // Now the focused front window: L minimises it.
  await dm.keyboard.press("l");
  await expect.poll(async () => log.getAttribute("data-state")).toBe("minimised");

  // "l" typed in the roll bar is text, never a window toggle.
  await openWindow(dm, "dice.log");
  const field = dm.getByTestId("dice-roll-expression");
  await field.click();
  await dm.keyboard.type("lid");
  await expect(field).toHaveValue("lid");
  await expect(log).toHaveAttribute("data-state", "open");
  // The last key typed ("d", the Dice tray key) was recorded as typing.
  await expect.poll(() => lastShortcut(dm)).toBe("window.tray:typing");
  // Ctrl+K works from the field.
  await dm.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(field).toBeFocused();
  await field.fill("");

  // N / Shift+N: the sim's ambush is started.
  const init = await openWindow(dm, "cbt.initiative");
  const turn = () =>
    init.locator('li[data-testid="cbt-init-row"][data-turn="true"]').getAttribute("data-record-id");
  const before = await turn();
  await onMap(dm, "n");
  await expect.poll(turn).not.toBe(before);
  await dm.keyboard.press("Shift+N");
  await expect.poll(turn).toBe(before);

  // ? → the shortcuts sheet, generated from the registry.
  await onMap(dm, "?");
  const sheet = dm.getByTestId("ui-shortcuts");
  await expect(sheet).toBeVisible();
  await expect(
    sheet.locator('[data-testid="ui-shortcuts-row"][data-record-id="cbt.next-turn"]'),
  ).toBeVisible();
  await dm.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Pause… (walkthrough P9 bug): the top-bar Popover opens and stays open after the palette's
  // focus return (it used to close within a frame).
  await onMap(dm, "Control+k");
  await dm.keyboard.type("pause");
  await dm.keyboard.press("Enter");
  const form = dm.getByTestId("ui-pause-form");
  await expect(form).toBeVisible();
  await dm.waitForTimeout(500);
  await expect(form).toBeVisible();
  await expect(dm.getByTestId("ui-pause-open")).toHaveAttribute("aria-expanded", "true");
  await dm.keyboard.press("Escape");
  await expect(form).toBeHidden();
});

test("SP1 player 1: Ctrl+K 'goblin' lists no monster; '@' only Mira's own rows; the top-bar button opens the palette", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  // The sim shows player 1 a handout (a modal dialog): Ctrl+K stays off over it; close it first.
  await p1.keyboard.press("Control+k");
  await expect(p1.getByTestId("ui-palette")).toBeHidden();
  await p1.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

  await p1.getByTestId("ui-palette-open").click();
  const palette = p1.getByTestId("ui-palette");
  await expect(palette).toBeVisible();
  await p1.keyboard.type("goblin");
  // The compendium answer arrives under its heading; no monster rows for a player.
  await expect(palette).toHaveAttribute("data-state", "ready");
  await expect(palette.locator('[data-testid="ui-palette-item"][data-kind="monster"]')).toHaveCount(
    0,
  );
  await p1.getByTestId("ui-palette-input").fill("@");
  const rows = palette.locator('[data-testid="ui-palette-item"]');
  await expect(rows.first()).toBeVisible();
  const groups = await palette
    .locator('[data-testid="ui-palette-group"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-value")));
  expect(groups).toEqual(["Characters"]);
  await expect(rows.filter({ hasText: "Thorn" })).toHaveCount(0);
  await expect(rows.filter({ hasText: /^Mira/ })).toHaveCount(1);
  await p1.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});
