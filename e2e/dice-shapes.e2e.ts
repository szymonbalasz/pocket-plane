// e2e-bundle: dice-display
// Thin die-shape flows (D5; DICEX §13 step 22, DICE §13 sprint 4): A (DM) and B (player-1, Mira)
// see `rolls-1` with die chips (e4's manual 15 a d20 + "physical"), B never the hidden rolls; B
// rolls with advantage and `1d8+2d6` → chips in B's look (Crimson) in both logs, the dropped d20
// struck; B's flat dice (popup chips, D7) draw die shapes. A's log at default size still shows ≥ 4 one-line
// entries (FR-SHELL-35; kit parity K1: 40-px rows, the chips in each row's Tooltip, FR-KIT-45).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { entryDice } from "./support/log";
import { openWindow, shellWindow } from "./support/shell";

/** Fixture values (`dicex-looks`, `rolls-1`): the DM's Obsidian body, player-1's Crimson body. */
const DM_BODY = "#1d1d22";
const CRIMSON_BODY = "#8b1a1a";
const SECRET_LABEL = "DM-SECRET-ROLL";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

/** Each chip of `entry` (in its Tooltip, FR-KIT-45): the wrapper's data and the inner shape. */
const chipsOf = async (entry: Locator) =>
  (await entryDice(entry)).evaluateAll((els) =>
    els.map((el) => ({
      faces: el.getAttribute("data-faces"),
      kept: el.getAttribute("data-kept"),
      shape: el.querySelector("[data-testid='dicex-die']")?.getAttribute("data-shape") ?? null,
      fill: el.querySelector("path")?.getAttribute("fill") ?? null,
    })),
  );

const lastEntry = (log: Locator, text: string) =>
  log.getByTestId("dice-log-entry").filter({ hasText: text }).last();

test("FR-DICE-35 FR-DICE-36 FR-DICEX-42 log die chips: history, adv and mixed dice in the roller's look; flat throw shapes", async ({
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
  const log = await openWindow(p1, "dice.log");

  // `rolls-1`: the DM sees 4 entries, all with chips; e4 (Mira, manual 15) a d20 + physical.
  await expect(dmLog.getByTestId("dice-log-entry")).toHaveCount(4);
  for (const e of await dmLog.getByTestId("dice-log-entry").all()) {
    await expect((await entryDice(e)).first()).toBeVisible();
  }
  const e4 = dmLog.getByTestId("dice-log-entry").nth(3);
  expect(await chipsOf(e4)).toEqual([{ faces: "20", kept: "true", shape: "d20", fill: DM_BODY }]);
  await expect(await entryDice(e4)).toHaveAttribute("data-value", "15");
  await expect(e4.getByTestId("dice-log-entry-manual")).toBeVisible();
  // B: only the public history (e1, e4), never the hidden label.
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(2);
  await expect(log).not.toContainText(SECRET_LABEL);
  expect(await chipsOf(log.getByTestId("dice-log-entry").first())).toEqual([
    { faces: "20", kept: "true", shape: "d20", fill: DM_BODY },
  ]);

  // B rolls 1d20+3 with advantage: two d20 chips, one dropped, in B's Crimson look.
  await log.locator('[data-testid="dice-roll-mode-option"][data-value="advantage"]').click();
  await log.getByTestId("dice-roll-expression").fill("1d20+3");
  await log.getByTestId("dice-roll-expression").press("Enter");
  const crimson = CRIMSON_BODY;
  for (const l of [log, dmLog]) {
    const adv = lastEntry(l, "(adv)");
    await expect(await entryDice(adv)).toHaveCount(2);
    const chips = await chipsOf(adv);
    expect(chips.map((c) => [c.shape, c.fill])).toEqual([
      ["d20", crimson],
      ["d20", crimson],
    ]);
    expect(chips.map((c) => c.kept).sort()).toEqual(["false", "true"]);
    // The dropped chip is struck and dimmed.
    await expect(
      (await entryDice(adv))
        .and(adv.page().locator('[data-kept="false"]'))
        .getByTestId("dicex-die"),
    ).toHaveClass(/opacity-40/);
  }

  // B rolls 1d8+2d6: a d8 diamond then two d6 squares (faces in term order).
  await log.locator('[data-testid="dice-roll-mode-option"][data-value="normal"]').click();
  await log.getByTestId("dice-roll-expression").fill("1d8+2d6");
  await log.getByTestId("dice-roll-expression").press("Enter");
  for (const l of [log, dmLog]) {
    const mixed = lastEntry(l, "1d8+2d6");
    await expect(await entryDice(mixed)).toHaveCount(3);
    expect((await chipsOf(mixed)).map((c) => c.shape)).toEqual(["d8", "d6", "d6"]);
  }

  // B's own popup (D7): flat dice (chips) are die shapes at the server's values.
  const id = await lastEntry(log, "1d8+2d6").getAttribute("data-record-id");
  const popup = p1.locator(`[data-testid="dicex-popup"][data-record-id="${id}"]`);
  await expect(popup).toHaveAttribute("data-state", "rest", { timeout: 6_000 });
  if ((await popup.getByTestId("dicex-popup-pip").getAttribute("data-mode")) === "chips") {
    const shapes = popup.locator("[data-testid='dicex-throw-die'] [data-testid='dicex-die']");
    await expect(shapes).toHaveCount(3);
    expect(await shapes.evaluateAll((els) => els.map((e) => e.getAttribute("data-shape")))).toEqual(
      ["d8", "d6", "d6"],
    );
  }

  for (const page of [p1, dm]) await page.context().close();
});

/** Log entries fully shown above the roll bar, and how many wrap (FR-SHELL-35). */
const fullyShown = (log: Locator) =>
  log.evaluate((win) => {
    const list = win.querySelector("[data-testid='dice-log-list']");
    const bar = win.querySelector("[data-testid='dice-roll-expression']")?.closest("form");
    if (!list || !bar) return { count: 0, multiLine: 0 };
    const w = win.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    const top = Math.max(w.top, l.top);
    const bottom = Math.min(w.bottom, l.bottom, bar.getBoundingClientRect().top);
    const shown = [...list.querySelectorAll("[data-testid='dice-log-entry']")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
    });
    // Kit parity K1 (FR-KIT-40): a row is one 40-px line.
    const multiLine = shown.filter((e) => e.getBoundingClientRect().height > 41).length;
    return { count: shown.length, multiLine };
  });

test("FR-DICE-35 FR-SHELL-35 FR-KIT-40 rows fit: the DM's log at default size shows ≥ 4 one-line entries", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  // FR-DICE-38: the tall default size (1150×280 from 1440×900, K5) holds 4 whole 40-px rows.
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const log = shellWindow(dm, "dice.log");
  await expect(log).toBeVisible();
  const entries = log.getByTestId("dice-log-entry");
  await expect(entries.first()).toBeVisible();
  // At least 8 entries (rolls-1's 4 + this spec file's earlier rolls + 1d20s), d20 chips last.
  for (let n = await entries.count(); n < 8; n++) {
    await log.getByTestId("dice-roll-expression").fill("1d20");
    await log.getByTestId("dice-roll-expression").press("Enter");
    await expect(entries).toHaveCount(n + 1);
  }
  await expect(await entryDice(entries.last())).toHaveCount(1);
  await expect.poll(async () => (await fullyShown(log)).count).toBeGreaterThanOrEqual(4);
  expect((await fullyShown(log)).multiLine).toBe(0);
  await dm.context().close();
});
