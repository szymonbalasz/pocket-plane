// e2e-bundle: log-note-colours
// Thin player-colour flows for the Game log, roll popup and notifications (CAMP §13 K6, K7; DICE
// FR-DICE-60, NOTE FR-NOTE-39, -40), DM + player-1 + player-2 in separate contexts. K6: the
// fixture's roll lines and live rolls (B's roll bar, C's sheet skill check, A's roll bar) show the
// roller's colour on every client, C's popup name too; B picks rose → B's lines recolour live.
// K7: B's test card → A's toast + row with B's stripe, "Resolved by DM" in amber after A acts;
// A's info to Player 2 → C's toast with an amber stripe.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { PLAYER_COLORS, paletteKeyOf } from "../src/shared/campaign-management/colors";
import { pickOwnColour } from "./support/colour";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const HEX = {
  amber: "rgb(230, 159, 0)",
  jade: "rgb(25, 185, 138)",
  rose: "rgb(224, 138, 184)",
  blue: "rgb(91, 143, 240)",
} as const;

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const lineOf = (log: Locator, id: string) =>
  log.locator(`[data-testid="dice-log-entry"][data-record-id="${id}"]`);

async function expectColored(line: Locator, key: keyof typeof HEX, roller: string) {
  await expect(line).toHaveAttribute("data-color", key);
  await expect(line).toHaveAttribute("data-roller", roller);
  await expect(line.getByTestId("dice-log-entry-actor")).toHaveCSS("color", HEX[key]);
  await expect(line.getByTestId("dice-log-entry-actor")).toHaveCSS("font-weight", "600");
}

async function rollBar(page: Page, expression: string): Promise<Locator> {
  const log = await openWindow(page, "dice.log");
  await log.getByTestId("dice-roll-expression").fill(expression);
  // The DM's eye (public toggle) follows the category setting: make this roll public.
  const pub = log.getByTestId("dice-roll-public");
  if ((await pub.count()) > 0 && (await pub.getAttribute("data-state")) === "hidden") {
    await pub.click();
    await expect(pub).toHaveAttribute("data-state", "public");
  }
  await log.getByTestId("dice-roll-expression").press("Enter");
  await expect(log.getByTestId("dice-roll-expression")).toHaveValue("");
  return log;
}

test("FR-DICE-60 FR-DICE-61 roll lines and popup names in the roller's colour; a pick recolours (K6)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const p1Id = recordId("player-1", "player");
  const p2Id = recordId("player-2", "player");
  const fx = [0, 1, 2].map((i) => recordId("log-colours", "game-log-entry", i));
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  dm.on("pageerror", (e) => errors.push(e.message));
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);

  // The fixture's lines on every client: Mira (player-1) jade, Player 2 blue, the DM for Mira amber.
  const logs = {
    dm: await openWindow(dm, "dice.log"),
    p1: await openWindow(p1, "dice.log"),
    p2: await openWindow(p2, "dice.log"),
  };
  for (const log of Object.values(logs)) {
    await expectColored(lineOf(log, fx[0] as string), "jade", p1Id);
    await expectColored(lineOf(log, fx[1] as string), "blue", p2Id);
    await expectColored(lineOf(log, fx[2] as string), "amber", "dm");
  }

  // B: roll bar 1d20 → B's new line jade on A and C.
  const before = await logs.dm.getByTestId("dice-log-entry").count();
  await rollBar(p1, "1d20");
  await expect(logs.dm.getByTestId("dice-log-entry")).toHaveCount(before + 1);
  const b1 = (await logs.dm
    .getByTestId("dice-log-entry")
    .last()
    .getAttribute("data-record-id")) as string;
  await expectColored(lineOf(logs.dm, b1), "jade", p1Id);
  await expectColored(lineOf(logs.p2, b1), "jade", p1Id);

  // C: Thorn's sheet → Perception: blue on A and B; A's popup row names Thorn in blue.
  const sheet = await openWindow(p2, "char.sheet");
  await sheet.locator('[data-testid="charx-roll-skill"][data-value="perception"]').click();
  await expect(logs.dm.getByTestId("dice-log-entry")).toHaveCount(before + 2);
  const c1 = (await logs.dm
    .getByTestId("dice-log-entry")
    .last()
    .getAttribute("data-record-id")) as string;
  await expectColored(lineOf(logs.dm, c1), "blue", p2Id);
  await expectColored(lineOf(logs.p1, c1), "blue", p2Id);
  const popupName = dm
    .locator(`[data-testid="dicex-popup-row"][data-record-id="${c1}"]`)
    .getByTestId("dicex-popup-actor");
  await expect(popupName).toHaveAttribute("data-color", "blue");
  await expect(popupName).toHaveCSS("color", HEX.blue);

  // A: roll bar 1d20 → amber on B and C.
  await rollBar(dm, "1d20");
  await expect(logs.p1.getByTestId("dice-log-entry")).toHaveCount(before + 3);
  const a1 = (await logs.p1
    .getByTestId("dice-log-entry")
    .last()
    .getAttribute("data-record-id")) as string;
  await expectColored(lineOf(logs.p1, a1), "amber", "dm");
  await expectColored(lineOf(logs.p2, a1), "amber", "dm");

  // B picks rose: B's lines recolour on A and C, no reload (OQ-CAMP-21).
  await pickOwnColour(p1, PLAYER_COLORS.rose);
  for (const log of [logs.dm, logs.p2]) {
    await expectColored(lineOf(log, fx[0] as string), "rose", p1Id);
    await expectColored(lineOf(log, b1), "rose", p1Id);
    await expectColored(lineOf(log, c1), "blue", p2Id);
  }
  expect(errors).toEqual([]);
  for (const page of [p1, p2, dm]) await page.context().close();
});

test("FR-NOTE-39 FR-NOTE-40 toasts and history rows striped in the causer's colour; Resolved by in the closer's (K7)", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const p1Id = recordId("player-1", "player");
  const ready = recordId("note-colours", "notification", 2);
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  await p2.goto(link("Player 2"));
  await live(p2);
  // Player 1's colour: jade from the fixture, rose when K6 ran first on this server.
  const k = paletteKeyOf(
    (await p1.getByTestId("ui-prefs-chip-dot").getAttribute("data-color")) ?? "",
  ) as keyof typeof HEX;
  expect(Object.keys(HEX)).toContain(k);

  // The fixture's resolved row: amber stripe (the DM sent it), "Resolved by Player 1" in jade.
  const win = await openWindow(dm, "note.history");
  const readyRow = win.locator(`[data-testid="note-history-row"][data-record-id="${ready}"]`);
  await expect(readyRow).toHaveAttribute("data-color", "amber");
  await expect(readyRow.getByTestId("note-history-state")).toHaveText("Resolved by Player 1");
  const closer = readyRow.getByTestId("note-history-closed-by");
  await expect(closer).toHaveAttribute("data-color", k);
  await expect(closer).toHaveCSS("color", HEX[k]);

  // B: a test card (owner: the DM, like a damage card) → A's toast and row striped in B's colour.
  // FR-NOTE-72: A's open Notifications window folds the card's toast; minimised, it toasts.
  await win.getByTestId("ui-window-minimise").click();
  const pwin = await openWindow(p1, "note.history");
  await pwin.getByTestId("note-test-text").fill("Apply 3 damage?");
  await pwin.getByTestId("note-test-label").fill("Apply");
  await pwin.getByTestId("note-test-send").click();
  const toast = dm.getByTestId("note-toast").filter({ hasText: "Apply 3 damage?" });
  await expect(toast).toHaveAttribute("data-by", p1Id);
  await expect(toast).toHaveAttribute("data-color", k);
  await expect(toast.getByTestId("note-stripe")).toHaveCSS("background-color", HEX[k]);
  await expect(toast.getByTestId("note-stripe")).toHaveCSS("width", "3px");
  await openWindow(dm, "note.history");
  const row = win.getByTestId("note-history-row").filter({ hasText: "Apply 3 damage?" });
  await expect(row).toHaveAttribute("data-state", "pending");
  await expect(row).toHaveAttribute("data-color", k);
  await expect(row.getByTestId("note-stripe")).toHaveCSS("background-color", HEX[k]);
  // B's own row of it: the same stripe.
  const prow = pwin.getByTestId("note-history-row").filter({ hasText: "Apply 3 damage?" });
  await expect(prow).toHaveAttribute("data-color", k);

  // A acts → "Resolved by DM", the name in amber; the stripe stays B's.
  await win.getByTestId("ui-window-minimise").click();
  await toast.getByTestId("note-toast-action").click();
  await openWindow(dm, "note.history");
  await expect(row.getByTestId("note-history-state")).toHaveText("Resolved by DM");
  await expect(row.getByTestId("note-history-closed-by")).toHaveCSS("color", HEX.amber);
  await expect(row).toHaveAttribute("data-color", k);

  // A: info to Player 2 → C's toast with an amber stripe.
  await win.getByTestId("note-test-text").fill("The bridge sways");
  const p2Option = win.getByTestId("note-test-audience").locator("option", { hasText: "Player 2" });
  await win
    .getByTestId("note-test-audience")
    .selectOption((await p2Option.getAttribute("value")) as string);
  await win.getByTestId("note-test-send").click();
  const ptoast = p2.getByTestId("note-toast").filter({ hasText: "The bridge sways" });
  await expect(ptoast).toHaveAttribute("data-by", "dm");
  await expect(ptoast).toHaveAttribute("data-color", "amber");
  await expect(ptoast.getByTestId("note-stripe")).toHaveCSS("background-color", HEX.amber);

  for (const page of [p1, p2, dm]) await page.context().close();
});
