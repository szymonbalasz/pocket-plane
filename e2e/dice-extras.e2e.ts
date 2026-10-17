// e2e-bundle: dice-extras
// Thin dice-extras flows (DICEX §13 E2E, D1 flat): DM (A) + player-1 (B, Mira). B stages "1d12+5"
// from the roll bar's tray Button, adds a d6, sets the constant to 6 and rolls; A sees the line;
// B's flat dice (Display → Flat in the tray gear: chips in B's own roll popup, D7) rest on the server's values. B Alt+clicks Athletics on Mira's sheet → the tray
// adjusts the sheet roll and its Roll sends the sheet's own intent. Sheet notation (D4): B clicks
// "1d12 + 5" in Mira's "Notation test" feature → `compose` as Mira → Roll; A sees the line.
// Looks (D2): fixture looks thrown in their style; player-2 saves Emerald glass, seen by A and B.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-DICEX-01 FR-DICEX-04 FR-DICEX-06 FR-DICEX-10 FR-DICEX-11 FR-DICEX-17 tray compose → roll → flat throw; Alt+click adjusts a sheet roll", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);

  // Map-first: no tray open by default (FR-DICEX-01).
  await expect(shellWindow(p1, "dicex.tray")).toHaveCount(0);
  // B: tray gear → Display "Flat" (a per-device choice, FR-DICEX-32).
  const gear = await openWindow(p1, "dicex.tray");
  await gear.getByTestId("dicex-settings-open").click();
  await p1.locator('[data-testid="dicex-settings-display"][data-value="flat"]').click();
  await p1.keyboard.press("Escape");
  const dmLog = await openWindow(dm, "dice.log");
  const log = await openWindow(p1, "dice.log");

  // B: "1d12+5" → tray Button → `compose`: one d12 chip, constant 5.
  await log.getByTestId("dice-roll-expression").fill("1d12+5");
  await log.getByTestId("dicex-tray-open").click();
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray).toBeVisible();
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "compose");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(1);
  await expect(tray.getByTestId("dicex-tray-die")).toHaveAttribute("data-faces", "12");
  await expect(tray.getByTestId("dicex-tray-constant")).toHaveValue("5");

  // Palette d6, constant 6 → "1d12+1d6+6"; Roll.
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="6"]').click();
  await tray.getByTestId("dicex-tray-constant").fill("6");
  await expect(tray.getByTestId("dicex-tray-expression")).toHaveValue("1d12+1d6+6");
  await tray.getByTestId("dicex-tray-roll").click();

  // A sees the line at once.
  await expect(dmLog.getByTestId("dice-log-entry").filter({ hasText: "1d12+1d6+6" })).toHaveCount(
    1,
  );

  // B's flat dice: chips in B's own popup (FR-DICEX-41 c), at rest on the server's values
  // (data-settled == data-value, every die flat).
  const popup = p1.locator('[data-testid="dicex-popup"][data-record-id]');
  await expect(popup.getByTestId("dicex-popup-pip")).toHaveAttribute("data-mode", "chips");
  await expect(popup).toHaveAttribute("data-state", "rest");
  const dice = popup.getByTestId("dicex-throw-die");
  await expect(dice).toHaveCount(2);
  for (const d of await dice.all()) {
    const value = await d.getAttribute("data-value");
    expect(value).toMatch(/^\d+$/);
    await expect(d).toHaveAttribute("data-settled", value as string);
    await expect(d).toHaveAttribute("data-flat", "true");
  }
  // The tray shows the result; "Roll again" for a free request.
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "result");
  await expect(tray.getByTestId("dicex-tray-again")).toBeVisible();

  // B: Alt+click Athletics on Mira's sheet → `adjust` (read-only dice) → Roll → the sheet's own
  // `char.roll` line reaches A.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet
    .locator('[data-testid="charx-roll-skill"][data-value="athletics"]')
    .click({ modifiers: ["Alt"] });
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "adjust");
  await expect(tray.getByTestId("dicex-tray-state")).toContainText("Athletics");
  await expect(tray.getByTestId("dicex-tray-expression")).toHaveCount(0);
  await expect(tray.locator('[data-testid="dicex-tray-die"][data-faces="20"]')).toHaveCount(1);
  const before = await dmLog.getByTestId("dice-log-entry").filter({ hasText: "Athletics" }).count();
  await tray.getByTestId("dicex-tray-roll").click();
  await expect(dmLog.getByTestId("dice-log-entry").filter({ hasText: "Athletics" })).toHaveCount(
    before + 1,
  );

  for (const page of [p1, dm]) await page.context().close();
});

test("FR-DICEX-20 FR-DICEX-26 FR-DICEX-27 looks: fixture looks thrown; player-2 saves Emerald glass, A and B see it, reload keeps it", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  /**
   * `page`'s dice of the entry `id`: its big throw's DOM mirror, else its popup's chips or
   * miniature (D7: a throw before the 3D chunk is in shows in the popup); every die in `style` /
   * `material`.
   */
  const seesLook = async (page: Page, id: string, style: string, material: string) => {
    const dice = page
      .locator(
        `[data-testid="dicex-throw"][data-record-id="${id}"], [data-testid="dicex-popup"][data-record-id="${id}"]`,
      )
      .getByTestId("dicex-throw-die");
    await expect(dice.first()).toHaveAttribute("data-style", style);
    for (const d of await dice.all()) {
      await expect(d).toHaveAttribute("data-style", style);
      await expect(d).toHaveAttribute("data-material", material);
    }
  };
  const log1 = await openWindow(p1, "dice.log");
  /** Rolls 1d20 from `log`; the new entry's id (the log's newest, last). */
  const roll = async (log: Locator) => {
    const entries = log.getByTestId("dice-log-entry");
    const before = await entries.count();
    await log.getByTestId("dice-roll-expression").fill("1d20");
    await log.getByTestId("dice-roll-expression").press("Enter");
    await expect(entries).toHaveCount(before + 1);
    return (await entries.last().getAttribute("data-record-id")) as string;
  };

  // Fixture `dicex-looks`: player-1 Crimson metal, seen by A.
  const first = await roll(log1);
  await seesLook(dm, first, "crimson", "metal");
  await p1
    .locator(`[data-testid="dicex-popup"][data-record-id="${first}"][data-state="rest"]`)
    .waitFor();

  // C: tray gear → Dice look (default Sapphire) → Emerald, glass → Save.
  const tray = await openWindow(p2, "dicex.tray");
  await tray.getByTestId("dicex-settings-open").click();
  await p2.getByTestId("dicex-look-open").click();
  const editor = p2.getByTestId("dicex-look");
  await expect(
    editor.locator('[data-testid="dicex-look-style"][data-value="sapphire"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(editor.getByTestId("dicex-look-save")).toBeDisabled();
  await editor.locator('[data-testid="dicex-look-style"][data-value="emerald"]').click();
  await editor.locator('[data-testid="dicex-look-material"][data-value="glass"]').click();
  await editor.getByTestId("dicex-look-save").click();
  // Saved: the stored look is now the editor's base (Save disabled again).
  await expect(editor.getByTestId("dicex-look-save")).toBeDisabled();
  await p2.keyboard.press("Escape");

  // C rolls; A and B see C's throw in Emerald glass.
  const log2 = await openWindow(p2, "dice.log");
  const second = await roll(log2);
  await seesLook(dm, second, "emerald", "glass");
  await seesLook(p1, second, "emerald", "glass");

  // Reload B: C's next throw is still Emerald glass.
  await p1.reload();
  await live(p1);
  const third = await roll(log2);
  await seesLook(p1, third, "emerald", "glass");

  for (const page of [p1, p2, dm]) await page.context().close();
});

// Headless Chromium has WebGL only through SwiftShader, which Chrome now gates behind a flag.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

test("FR-DICEX-15 FR-DICEX-22 3D throw rests on the server's values (skipped without WebGL)", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const webgl = await p1.evaluate(() => {
    const c = document.createElement("canvas");
    return (c.getContext("webgl2") ?? c.getContext("webgl")) !== null;
  });
  test.skip(!webgl, "no WebGL in this headless browser: throws are flat (covered above)");

  const log = await openWindow(p1, "dice.log");
  const roll = async () => {
    await log.getByTestId("dice-roll-expression").fill("2d6+1d20+1d100");
    await log.getByTestId("dice-roll-expression").press("Enter");
  };
  // The chunk preloads at idle (FR-DICEX-37); a throw before it is ready draws flat.
  const thrown = p1.locator(
    '[data-testid="dicex-throw"][data-record-id][data-render="3d"][data-arena="screen"]',
  );
  await expect(async () => {
    await roll();
    await expect(thrown).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(thrown).toHaveAttribute("data-state", "rest", { timeout: 6_000 });
  const dice = thrown.getByTestId("dicex-throw-die");
  await expect(dice).toHaveCount(5); // 2 d6, 1 d20, d100 = tens + units
  for (const d of await dice.all()) {
    const value = await d.getAttribute("data-value");
    expect(value).toMatch(/^\d+$/);
    await expect(d).toHaveAttribute("data-settled", value as string);
    await expect(d).toHaveAttribute("data-flat", "false");
  }
  // The page's one dice canvas lives in the dice layer (FR-DICEX-33).
  await expect(p1.getByTestId("dicex-screen").locator("canvas")).toHaveCount(1);
  await p1.context().close();
});

test("FR-DICEX-29 FR-DICEX-30 FR-DICEX-31 sheet notation: Mira's 'Notation test' links; a click composes in the tray as Mira; Roll → A sees the line", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const dmLog = await openWindow(dm, "dice.log");

  // Step 2: B → Mira's sheet → Features → "Notation test": links and plain text.
  const sheet = await openWindow(p1, "char.sheet");
  await sheet.locator('[data-testid="charx-tab"][data-value="features"]').click();
  const row = sheet.getByTestId("charx-feature").filter({ hasText: "Notation test" });
  const links = row.getByTestId("dicex-notation");
  await expect(links).toHaveCount(4);
  const values = await links.evaluateAll((els) => els.map((e) => e.getAttribute("data-value")));
  expect(values).toEqual(["1d12+5", "1d10+1", "2d6-1", "1d20+3"]);
  await expect(row).toContainText("Not dice: 51d6, 1d1, 2d6/2, 4d6x2, abc1d6.");

  // Step 3: click "1d12 + 5" → `compose`: one d12, constant 5, actor Mira, label, category other.
  await links.first().click();
  const tray = shellWindow(p1, "dicex.tray");
  await expect(tray.getByTestId("dicex-tray-state")).toHaveAttribute("data-value", "compose");
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(1);
  await expect(tray.getByTestId("dicex-tray-die")).toHaveAttribute("data-faces", "12");
  await expect(tray.getByTestId("dicex-tray-constant")).toHaveValue("5");
  await tray.getByTestId("dicex-tray-options").click();
  await expect(tray.getByTestId("dicex-tray-actor").locator("option:checked")).toHaveText("Mira");
  await expect(tray.getByTestId("dicex-tray-label")).toHaveValue("Notation test");
  await expect(tray.getByTestId("dicex-tray-category")).toHaveValue("other");

  // FR-DICEX-31: a plain `dice.roll` line as Mira ("Mira — Notation test: d12 + 5 = …").
  await tray.getByTestId("dicex-tray-roll").click();
  const line = dmLog.getByTestId("dice-log-entry").filter({ hasText: "Notation test" });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(/Mira\s*— Notation test: \d+ \+ 5 = \d+/);

  for (const page of [p1, dm]) await page.context().close();
});
