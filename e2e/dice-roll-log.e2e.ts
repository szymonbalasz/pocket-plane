// e2e-bundle: dice-log
// Thin dice-roll-log flows (DICE §13 E2E): DM + player-1. Player Shift+Enter roll reaches the
// DM; a DM hidden roll never reaches player frames; a DM public roll does. Visibility matrix,
// window, restart: bun test (dice-roll-log sync.test.ts).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { entryLine, pickRollOption } from "./support/log";
import { openWindow } from "./support/shell";

const entries = (page: Page) => page.getByTestId("dice-log-entry");

/** FR-DICE-30: category, actor, label and the physical toggle sit behind Options. */
async function openOptions(log: Locator) {
  const options = log.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  await expect(options).toHaveAttribute("data-state", "open");
}

async function roll(page: Page, expression: string, opts: { category?: string; label?: string }) {
  const log = await openWindow(page, "dice.log");
  if (opts.category || opts.label) await openOptions(log);
  if (opts.category) await pickRollOption(log, "dice-roll-category", opts.category);
  if (opts.label) await log.getByTestId("dice-roll-label").fill(opts.label);
  await log.getByTestId("dice-roll-expression").fill(expression);
  return log;
}

test("FR-DICE-05 FR-DICE-09 FR-DICE-15 player adv roll reaches DM; DM hidden roll stays hidden", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
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

  // rolls-1: DM sees e1–e4 (two muted), player-1 only e1 and e4.
  await openWindow(dm, "dice.log");
  await openWindow(player, "dice.log");
  await expect(entries(dm)).toHaveCount(4);
  await expect(dm.locator('[data-testid="dice-log-entry"][data-public="false"]')).toHaveCount(2);
  await expect(entries(player)).toHaveCount(2);
  await expect(entries(player).nth(1).getByTestId("dice-log-entry-manual")).toBeVisible();
  expect(frames.join("\n")).not.toContain("DM-SECRET-ROLL");

  // Player: as Mira, attack, Shift+Enter → advantage; the DM sees it live.
  const plog = await roll(player, "1d20+4", { category: "attack" });
  await pickRollOption(plog, "dice-roll-actor", recordId("char-mira", "entity"));
  await plog.getByTestId("dice-roll-expression").press("Shift+Enter");
  await expect(plog.getByTestId("dice-roll-expression")).toHaveValue("");
  await expect(entries(dm)).toHaveCount(5);
  await expect(entries(dm).nth(4)).toContainText("Mira");
  await expect(entries(dm).nth(4)).toContainText("(adv)");
  // The dropped die, struck, in the row's Tooltip line (kit parity K1, FR-KIT-45).
  await expect((await entryLine(entries(dm).nth(4))).locator("s")).toHaveCount(1);
  await expect(entries(player)).toHaveCount(3);

  // DM: hidden roll (eye switched off for this roll) → muted for the DM, absent for players.
  const dlog = await roll(dm, "1d6", { category: "damage", label: "E2E-SECRET" });
  const pub = dlog.getByTestId("dice-roll-public");
  await expect(pub).toHaveAttribute("data-state", "public");
  await pub.click();
  await expect(pub).toHaveAttribute("data-state", "hidden");
  await dlog.getByTestId("dice-roll-expression").press("Enter");
  await expect(entries(dm)).toHaveCount(6);
  await expect(entries(dm).nth(5)).toHaveAttribute("data-public", "false");

  // DM: public roll (damage category is on) → the player sees it; the secret never arrived.
  await roll(dm, "2d6", { category: "damage", label: "E2E-PUBLIC" });
  await dlog.getByTestId("dice-roll-submit").click();
  await expect(entries(dm)).toHaveCount(7);
  await expect(entries(player)).toHaveCount(4);
  await expect(entries(player).nth(3)).toContainText("E2E-PUBLIC");
  expect(frames.join("\n")).not.toContain("E2E-SECRET");
  expect(frames.join("\n")).not.toContain("DM-SECRET-ROLL");

  // FR-DICE-07 (#149): physical mode on → banner + marker on the Roll button; "Roll for me"
  // rolls server-side once (no "physical" badge) and the mode stays on; the banner turns it off.
  await expect(plog.getByTestId("dice-log-physical")).toHaveCount(0);
  await plog.getByTestId("dice-roll-physical").click();
  await expect(plog.getByTestId("dice-log-physical")).toBeVisible();
  await expect(plog.getByTestId("dice-roll-submit")).toHaveAttribute("data-physical", "true");
  await plog.getByTestId("dice-roll-expression").fill("1d20");
  await plog.getByTestId("dice-roll-submit").getByTestId("dice-physical-marker").waitFor();
  await pickRollOption(plog, "dice-roll-category", "saving-throw");
  await plog.getByTestId("dice-roll-submit").click();
  // The popover says what the roll is for (actor — label or category), not just "1d20".
  await expect(player.getByTestId("dice-manual-label")).toHaveText("Mira — Saving throw");
  await player.getByTestId("dice-manual-auto").click();
  await expect(entries(player)).toHaveCount(5);
  await expect(entries(player).nth(4).getByTestId("dice-log-entry-manual")).toHaveCount(0);
  await expect(plog.getByTestId("dice-roll-physical")).toHaveAttribute("data-state", "checked");
  await plog.getByTestId("dice-log-physical-off").click();
  await expect(plog.getByTestId("dice-roll-physical")).toHaveAttribute("data-state", "unchecked");
  await expect(plog.getByTestId("dice-roll-submit")).toHaveAttribute("data-physical", "false");

  // Later specs share the server: leave nobody online.
  await player.context().close();
  await dm.context().close();
});

test("FR-DICE-30 compact roll bar: one row, Options row, dot, eye preset, stored per browser", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const log = await openWindow(dm, "dice.log");
  const options = log.getByTestId("dice-roll-options");
  const pub = log.getByTestId("dice-roll-public");

  // Closed by default: one row ≤ 44 px; no hidden option set.
  await expect(options).toHaveAttribute("data-state", "closed");
  await expect(options).toHaveAttribute("data-dirty", "false");
  await expect(log.getByTestId("dice-roll-category")).toHaveCount(0);
  const barHeight = await log
    .getByTestId("dice-roll-expression")
    .evaluate((el) => el.closest("form")?.parentElement?.getBoundingClientRect().height ?? 0);
  expect(barHeight).toBeGreaterThan(0);
  expect(barHeight).toBeLessThanOrEqual(44);

  // The eye is preset from the category (`other` is hidden in dice-settings); a change = dot.
  await expect(pub).toHaveAttribute("data-state", "hidden");
  await pub.click();
  await expect(pub).toHaveAttribute("data-state", "public");
  await expect(options).toHaveAttribute("data-dirty", "true");
  await pub.click();
  await expect(options).toHaveAttribute("data-dirty", "false");

  // Options → row 2: category, actor, label, gear, physical.
  await options.click();
  await expect(options).toHaveAttribute("data-state", "open");
  for (const id of [
    "dice-roll-category",
    "dice-roll-actor",
    "dice-roll-label",
    "dice-settings-open",
    "dice-roll-physical",
  ]) {
    await expect(log.getByTestId(id)).toBeVisible();
  }
  await pickRollOption(log, "dice-roll-category", "skill-check");
  await expect(pub).toHaveAttribute("data-state", "hidden");
  await expect(options).toHaveAttribute("data-dirty", "true");
  await pickRollOption(log, "dice-roll-category", "damage");
  await expect(pub).toHaveAttribute("data-state", "public");
  await pickRollOption(log, "dice-roll-category", "other");
  await expect(options).toHaveAttribute("data-dirty", "false");
  await log.getByTestId("dice-roll-label").fill("Stealth");
  await expect(options).toHaveAttribute("data-dirty", "true");
  await log.getByTestId("dice-roll-label").fill("");
  await expect(options).toHaveAttribute("data-dirty", "false");

  // Open / closed survives a reload (per browser, per campaign + owner).
  await dm.reload();
  await expect(options).toHaveAttribute("data-state", "open");
  await expect(log.getByTestId("dice-roll-category")).toBeVisible();
  await log.getByTestId("dice-roll-physical").click();
  await options.click();
  await expect(options).toHaveAttribute("data-state", "closed");
  // Physical dice on with Options closed → the strip still shows.
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await dm.reload();
  await expect(options).toHaveAttribute("data-state", "closed");
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await log.getByTestId("dice-log-physical-off").click();
  await expect(log.getByTestId("dice-log-physical")).toHaveCount(0);
  await dm.context().close();
});

/** The newest entry is fully inside the list's scroll box (the list is at the bottom). */
const newestShown = (log: Locator) =>
  log.evaluate((win) => {
    const list = win.querySelector("[data-testid='dice-log-list']");
    const last = list?.querySelector("[data-testid='dice-log-entry']:last-child");
    if (!list || !last) return false;
    const l = list.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    return r.top >= l.top - 0.5 && r.bottom <= l.bottom + 0.5;
  });

test("FR-DICE-21 footer resize: a list at the bottom stays there when Options / the Physical strip open", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1280, height: 720 });
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  await player.goto(link("Player 1"));
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const log = await openWindow(dm, "dice.log");
  const plog = await openWindow(player, "dice.log");
  const options = log.getByTestId("dice-roll-options");

  for (let i = 0; i < 8; i++) {
    const before = await entries(dm).count();
    await log.getByTestId("dice-roll-expression").fill("1d4");
    await log.getByTestId("dice-roll-expression").press("Enter");
    await expect(entries(dm)).toHaveCount(before + 1);
  }
  await expect.poll(() => newestShown(log)).toBe(true);

  // Footer grows: Options row, then the Physical strip with Options closed, then both.
  await options.click();
  await expect(log.getByTestId("dice-roll-category")).toBeVisible();
  await expect.poll(() => newestShown(log)).toBe(true);
  await log.getByTestId("dice-roll-physical").click();
  await expect(log.getByTestId("dice-log-physical")).toBeVisible();
  await expect.poll(() => newestShown(log)).toBe(true);
  await options.click();
  await expect(options).toHaveAttribute("data-state", "closed");
  await expect.poll(() => newestShown(log)).toBe(true);

  // Others' rolls still scroll in (no "N new" for a DM who never scrolled up).
  for (let i = 0; i < 3; i++) {
    const before = await entries(dm).count();
    await plog.getByTestId("dice-roll-expression").fill("1d4");
    await plog.getByTestId("dice-roll-expression").press("Enter");
    await expect(entries(dm)).toHaveCount(before + 1);
  }
  await expect.poll(() => newestShown(log)).toBe(true);
  await expect(log.getByTestId("dice-log-new")).toHaveCount(0);

  // Footer shrinks again: still at the bottom.
  await log.getByTestId("dice-log-physical-off").click();
  await expect(log.getByTestId("dice-log-physical")).toHaveCount(0);
  await expect.poll(() => newestShown(log)).toBe(true);
  await expect(log.getByTestId("dice-log-new")).toHaveCount(0);

  await player.context().close();
  await dm.context().close();
});

test("FR-DICE-32 physical popover: Roll with empty boxes says why and sends nothing", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const log = await openWindow(dm, "dice.log");
  await openOptions(log);
  await log.getByTestId("dice-roll-physical").click();
  const before = await entries(dm).count();
  await log.getByTestId("dice-roll-expression").fill("4d6+3");
  await log.getByTestId("dice-roll-submit").click();

  const submit = dm.getByTestId("dice-manual-submit");
  const total = dm.getByTestId("dice-manual-total");
  const error = dm.getByTestId("dice-manual-error");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(error).toHaveText("Enter the total for 4d6+3");
  await expect(total).toBeFocused();
  await total.fill("30");
  await total.press("Enter");
  await expect(error).toHaveText("Total must be 4–24");
  await expect(entries(dm)).toHaveCount(before);

  // Every die filled → the total is computed and shown; Roll sends one entry.
  await total.fill("");
  const dice = dm.getByTestId("dice-manual-die");
  for (const [i, v] of ["3", "4", "5", "6"].entries()) await dice.nth(i).fill(v);
  await expect(total).toHaveAttribute("placeholder", "18");
  await submit.click();
  await expect(entries(dm)).toHaveCount(before + 1);
  await expect(entries(dm).nth(before)).toContainText("21");
  await expect(entries(dm).nth(before).getByTestId("dice-log-entry-manual")).toBeVisible();
  await log.getByTestId("dice-log-physical-off").click();
  await dm.context().close();
});
