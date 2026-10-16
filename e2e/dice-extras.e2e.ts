// e2e-bundle: dice-extras
// Thin dice-extras flows (DICEX §13 E2E, D1 flat): DM (A) + player-1 (B, Mira). B stages "1d12+5"
// from the roll bar's tray Button, adds a d6, sets the constant to 6 and rolls; A sees the line;
// B's flat throw rests on the server's values. B Alt+clicks Athletics on Mira's sheet → the tray
// adjusts the sheet roll and its Roll sends the sheet's own intent. Sheet notation links: D4.
import { expect, type Page, test } from "@playwright/test";
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

  // B's flat throw rests on the server's values (data-settled == data-value, every die flat).
  const thrown = p1.locator('[data-testid="dicex-throw"][data-record-id]');
  await expect(thrown).toHaveAttribute("data-render", "flat");
  await expect(thrown).toHaveAttribute("data-state", "rest");
  const dice = thrown.getByTestId("dicex-throw-die");
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
  // The first 3D throw loads the lazy chunk and draws flat (DICEX §7); a later one tumbles.
  const thrown = p1.locator('[data-testid="dicex-throw"][data-record-id][data-render="3d"]');
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
  await expect(thrown.locator("canvas")).toHaveCount(1);
  await p1.context().close();
});
