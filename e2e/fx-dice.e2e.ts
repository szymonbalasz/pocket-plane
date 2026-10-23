// e2e-bundle: fx-dice-e2e
// Thin FX2 flows (DICE §13 FX2, sprint 9; GEM FR-GEM-41, -44; DICEX FR-DICEX-94): player-1 (Mira,
// Brakka). In Chromium a roll line's `innerText` and a selection copy read on one line, equal to
// the line text (FR-DICE-93, BL-57); a "4d6kh3" line reads "5 3̶ + 6 + 6" (FR-DICE-92, BL-72); at
// the log's 300-px minimum the reroll confirm reads "Spend Inspiration?" inside the line
// (FR-GEM-44); an Inspiration reroll that flips Brakka's crit leaves the new line without its
// damage part (FR-GEM-41, BL-62); a roll popup closes 6 s after rest under a resting pointer, and
// once moved onto it stays held, then closes within 1 s of leaving (FR-DICEX-94, BL-89). Rules,
// frames, leaks: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string | RegExp) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });

type Cred = { role: "dm"; secret: string } | { role: "player"; token: string };

/**
 * Intents over a socket of its own (hello → snapshot → each intent → its ack). Each step's
 * `payload` is a function body over the snapshot's `records` and the earlier `results`; returns
 * the results and the `game-log-entry` ids each intent's event frames carried.
 */
function intents(
  page: Page,
  credential: Cred,
  steps: { name: string; payload: string }[],
): Promise<{ results: unknown[]; entries: string[][] }> {
  return page.evaluate(
    ([credential, steps]) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "hello", credential }));
        let records: unknown = null;
        const results: unknown[] = [];
        const entries: string[][] = [];
        let at = -1;
        const next = () => {
          at += 1;
          const step = steps[at];
          if (!step) {
            ws.close();
            resolve({ results, entries });
            return;
          }
          entries.push([]);
          // The payload is a function body of (records, results).
          const payload = new Function("records", "results", step.payload)(records, results);
          ws.send(
            JSON.stringify({
              type: "intent",
              intentId: crypto.randomUUID(),
              name: step.name,
              payload,
            }),
          );
        };
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as {
            type: string;
            records?: unknown;
            result?: unknown;
            changes?: { type: string; id: string }[];
          };
          if (f.type === "snapshot" && records === null) {
            records = f.records;
            next();
          } else if (f.type === "event" && at >= 0) {
            for (const c of f.changes ?? []) {
              if (c.type === "game-log-entry") entries[at]?.push(c.id);
            }
          } else if (f.type === "ack") {
            results.push(f.result);
            next();
          } else if (f.type === "reject") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [credential, steps] as const,
  ) as Promise<{ results: unknown[]; entries: string[][] }>;
}

/** session-sim-9 presents the "Thieves' Map" handout to player-1 (until the first close). */
async function closePresented(page: Page) {
  await page
    .getByTestId("party-present-close")
    .click({ timeout: 3_000 })
    .catch(() => {});
}

/** The plain text of a roll line: `lineText` without its markup (struck dice, badges). */
const ONE_LINE = /^[^\n]+$/;

test("FR-DICE-93 FR-DICE-92 FR-GEM-44 FR-GEM-41 a roll line copies as one line; 4d6kh3 joins kept dice; the reroll confirm names the gem at 300 px; a crit flip's reroll line has no damage", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { secret, link } = e2eEnv();
  const p1 = await rolePage(browser);
  const url = link("Player 1");
  await p1.goto(url);
  await live(p1);
  await closePresented(p1);
  const P1: Cred = { role: "player", token: url.split("/").pop() as string };
  const DM: Cred = { role: "dm", secret };
  const log = await openWindow(p1, "dice.log");

  // FR-DICE-93 (BL-57): innerText and a selection copy, one line each, digit for digit.
  const perc = line(log, "Mira — Perception: 4 + 3 = 7").getByTestId("dice-log-entry-text");
  await expect(perc).toHaveCount(1);
  const text = await perc.evaluate((el) => (el as HTMLElement).innerText);
  // The fixture's rolls are physical: the badge reads as a word after the total.
  expect(text).toBe("Mira — Perception: 4 + 3 = 7 physical");
  const copied = await perc.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(r);
    const s = sel.toString();
    sel.removeAllRanges();
    return s;
  });
  expect(copied).toBe("Mira — Perception: 4 + 3 = 7 physical");
  const stealth = line(log, "Stealth (adv)").getByTestId("dice-log-entry-text");
  expect(await stealth.evaluate((el) => (el as HTMLElement).innerText)).toBe(
    "Mira — Stealth (adv): 6 2 + 5 = 11 physical",
  );

  // FR-DICE-92 (BL-72): "4d6kh3: 5 3̶ + 6 + 6 = 17", the 3 struck; still one line.
  await intents(p1, P1, [
    {
      name: "dice.roll",
      payload: `return { expression: "4d6kh3", manual: { diceTotal: 17, dice: [5, 3, 6, 6] } };`,
    },
  ]);
  const kh3 = line(log, "4d6kh3").getByTestId("dice-log-entry-text");
  await expect(kh3).toHaveCount(1);
  const kh3Text = await kh3.evaluate((el) => (el as HTMLElement).innerText);
  expect(kh3Text).toMatch(ONE_LINE);
  expect(kh3Text).toMatch(/— 4d6kh3: 5 3 \+ 6 \+ 6 = 17/);
  const dice = kh3.getByTestId("dice-log-die");
  await expect(dice).toHaveCount(4);
  await expect(dice.nth(1)).toHaveAttribute("data-kept", "false");
  await expect(dice.nth(1)).toHaveAttribute("data-value", "3");

  // FR-GEM-44 (BL-72): at the log's minimum width the confirm names the gem, inside the line.
  const h = await log.getByTestId("ui-window-resize").boundingBox();
  if (!h) throw new Error("no resize handle");
  await p1.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await p1.mouse.down();
  for (let i = 1; i <= 6; i++)
    await p1.mouse.move(h.x + h.width / 2 - (1000 * i) / 6, h.y + h.height / 2);
  await p1.mouse.up();
  const winBox = await log.boundingBox();
  expect(winBox?.width ?? 0).toBeLessThanOrEqual(320);
  const percLine = line(log, "Mira — Perception: 4 + 3 = 7");
  await percLine.hover();
  await percLine.locator('[data-testid="dice-log-action"][data-value="gem.reroll"]').click();
  const ask = percLine.getByTestId("dice-log-action-confirm");
  await expect(ask).toContainText("Spend Inspiration?");
  const askBox = await ask.boundingBox();
  const lineBox = await percLine.boundingBox();
  if (!askBox || !lineBox || !winBox) throw new Error("no boxes");
  expect(askBox.x).toBeGreaterThanOrEqual(lineBox.x);
  expect(askBox.x + askBox.width).toBeLessThanOrEqual(lineBox.x + lineBox.width + 0.5);
  expect(askBox.x + askBox.width).toBeLessThanOrEqual(winBox.x + winBox.width);
  await percLine.getByTestId("dice-log-action-no").click();
  await expect(ask).toHaveCount(0);

  // FR-GEM-41 (BL-62): Brakka attacks (d20 9; slashing 3, 5; fire 2, 6), then an Inspiration
  // reroll to a natural 20 flips the crit: the new line holds the to-hit only.
  const brakka = `const b = records.entity.find((e) => e.name === "Brakka");`;
  await intents(p1, DM, [
    {
      name: "gem.adjust",
      payload: `${brakka} return { characterId: b.id, gem: "inspiration", delta: 1 };`,
    },
  ]);
  const attack = await intents(p1, P1, [
    {
      name: "cbt.attack",
      payload: `${brakka}
        const attackId = b.statBlock.attacks.find((a) => a.name.startsWith("Flame Tongue")).id;
        const attackerId = records.combatant.find((c) => c.name === "Brakka").id;
        return {
          attackerId,
          attackId,
          manual: [{ diceTotal: 9 }, { diceTotal: 8, dice: [3, 5] }],
          manualExtra: [{ diceTotal: 8, dice: [2, 6] }],
        };`,
    },
  ]);
  const attackEntry = attack.entries[0]?.[0] as string;
  expect(attackEntry).toBeTruthy();
  const old = log.locator(`[data-testid="dice-log-entry"][data-record-id="${attackEntry}"]`);
  await expect(old).toContainText("damage");
  await intents(p1, P1, [
    {
      name: "gem.spend",
      payload: `${brakka} return { characterId: b.id, gem: "inspiration", entryId: ${JSON.stringify(attackEntry)}, manual: { diceTotal: 20 } };`,
    },
  ]);
  await expect(old).toHaveAttribute("data-superseded", "true");
  const fresh = line(log, /Brakka — Flame Tongue greatsword.*\(reroll, was/);
  await expect(fresh).toHaveCount(1);
  const freshText = await fresh
    .getByTestId("dice-log-entry-text")
    .evaluate((el) => (el as HTMLElement).innerText);
  expect(freshText).toMatch(ONE_LINE);
  expect(freshText).toContain("natural 20");
  expect(freshText).not.toMatch(/damage|3 \+ 5/);
});

test("FR-DICEX-94 a roll popup never sticks: under a resting pointer it closes 6 s after rest; moved onto it, it is held, then closes within 1 s of leaving", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  const url = link("Player 1");
  await p1.goto(url);
  await live(p1);
  await closePresented(p1);
  const P1: Cred = { role: "player", token: url.split("/").pop() as string };
  const roll = (total: number) =>
    intents(p1, P1, [
      {
        name: "dice.roll",
        payload: `return { expression: "1d20", manual: { diceTotal: ${total} } };`,
      },
    ]);
  const popup = p1.getByTestId("dicex-popup");

  // Where a popup shows: roll once, read its box, let it close.
  await roll(11);
  await expect(popup).toHaveCount(1);
  await expect(popup).toHaveAttribute("data-state", "rest");
  const box = await popup.boundingBox();
  if (!box) throw new Error("no popup");
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await expect(popup).toHaveCount(0, { timeout: 10_000 });

  // Resting pointer: placed there first, never moved; the popup opens under it and still closes.
  await p1.mouse.move(at.x, at.y);
  await roll(12);
  await expect(popup).toHaveCount(1);
  await expect(popup).toHaveAttribute("data-state", "rest");
  const rested = Date.now();
  await expect(popup).toHaveCount(0, { timeout: 9_000 });
  expect(Date.now() - rested).toBeLessThan(8_000);

  // Moved onto it after it showed: held past its 6 s; off it → gone within 1 s (+ the fade).
  await p1.mouse.move(at.x - 300, at.y + 200);
  await roll(13);
  await expect(popup).toHaveCount(1);
  await expect(popup).toHaveAttribute("data-state", "rest");
  await p1.mouse.move(at.x, at.y, { steps: 5 });
  await p1.waitForTimeout(7_500);
  await expect(popup).toHaveCount(1);
  await p1.mouse.move(at.x - 300, at.y + 200, { steps: 5 });
  await expect(popup).toHaveCount(0, { timeout: 1_500 });
});
