// e2e-bundle: gems-combat-e2e
// Thin Combat gem flow (GEM §13 steps 5–6, GM2; CBT FR-CBT-130, -131): DM, player-1 (Brakka,
// level 5, Combat 2), player-2. player-1 attacks with Brakka's Flame Tongue greatsword (physical:
// d20 14; slashing 3, 5; fire 2, 6) → "Combat gem" on the card → picks the slashing 3 → Spend: the
// spend line for all three, the card's slashing up by 3 with a "max" Badge for player-1 and in the
// DM's popup; Apply on Goblin. A second attack entered as totals: the DM spends for Brakka in the
// popup (OQ-GEM-14 A) and is asked for each die first (OQ-GEM-13 A). player-2 never gets either
// card or its maxed dice. Rules, levels, leaks, races, crash: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string | RegExp) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });

/** player-1's Brakka attacks with the Flame Tongue (physical dice) over a socket of its own. */
function attack(page: Page, manual: object[], manualExtra: object[]) {
  return page.evaluate(
    ([manual, manualExtra]) =>
      new Promise<string>((resolve, reject) => {
        const token = location.pathname.split("/").pop() as string;
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "player", token } }));
        let sent = false;
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as {
            type: string;
            records?: Record<string, { id: string; name: string; [k: string]: unknown }[]>;
            result?: { cardId: string };
          };
          if (f.type === "snapshot" && !sent) {
            sent = true;
            const brakka = f.records?.entity?.find((e) => e.name === "Brakka");
            const block = brakka?.statBlock as
              | { attacks: { id: string; name: string }[] }
              | undefined;
            const attacks = block?.attacks ?? [];
            const attackId = attacks.find((a) => a.name.startsWith("Flame Tongue"))?.id;
            const attackerId = f.records?.combatant?.find((c) => c.name === "Brakka")?.id;
            const payload = { attackerId, attackId, manual, manualExtra };
            const intentId = crypto.randomUUID();
            ws.send(JSON.stringify({ type: "intent", intentId, name: "cbt.attack", payload }));
          } else if (f.type === "ack") {
            ws.close();
            resolve(f.result?.cardId as string);
          } else if (f.type === "reject") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [manual, manualExtra] as const,
  );
}

test("FR-GEM-25 FR-GEM-29 FR-GEM-30 FR-GEM-34 FR-CBT-130 FR-CBT-131 P1 maxes Brakka's slashing 3 on his card; the DM sees the max in the popup and applies; the DM spends for him on a physical total (each die first); P2 never gets the cards", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  // session-sim-9 presents the "Thieves' Map" handout to player-1 at load.
  await p1.getByTestId("party-present-close").click();
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => {
    ws.on("framereceived", (f) => p2Frames.push(String(f.payload)));
  });
  await p2.goto(link("Player 2"));
  await live(p2);
  const logs = [
    await openWindow(dm, "dice.log"),
    await openWindow(p1, "dice.log"),
    await openWindow(p2, "dice.log"),
  ];

  // Player 1: the card's "Combat gem" → pick the slashing 3 → Spend.
  const cardId = await attack(
    p1,
    [{ diceTotal: 14 }, { diceTotal: 8, dice: [3, 5] }],
    [{ diceTotal: 8, dice: [2, 6] }],
  );
  // The player's own card (no toast for their own roll): Notifications history.
  const history = await openWindow(p1, "note.history");
  const own = (testId: string) =>
    history.locator(`[data-testid="${testId}"][data-record-id="${cardId}"]`);
  await own("gem-combat").click();
  const picker = own("gem-combat-picker");
  const die = (part: string, index: number) =>
    picker.locator(`[data-testid="gem-combat-die"][data-part="${part}"][data-index="${index}"]`);
  await expect(die("0", 1)).toHaveAttribute("data-state", "max");
  await expect(die("0", 1)).toBeDisabled();
  await die("base", 0).click();
  await expect(die("base", 0)).toHaveAttribute("data-state", "picked");
  // Level 5: one die; the others wait.
  await expect(die("base", 1)).toBeDisabled();
  await picker.getByTestId("gem-combat-submit").click();

  const spent =
    /Brakka spends a Combat gem — Flame Tongue greatsword: slashing d6 3 → 6 \(rolled (\d+) → (\d+)\)/;
  for (const log of logs) await expect(line(log, spent)).toHaveCount(1);
  const [, from, to] =
    spent.exec((await line(logs[0] as Locator, spent).textContent()) ?? "") ?? [];
  expect(Number(to) - Number(from)).toBe(3);
  await expect(own("cbt-card-actions")).toHaveCount(0);
  await expect(
    history.locator('[data-testid="cbt-card-die-max"][data-part="base"][data-index="0"]'),
  ).toBeVisible();

  // DM: the popup shows the max and applies the maxed total.
  const init = await openWindow(dm, "cbt.initiative");
  const card = init.locator(`[data-testid="cbt-init-card"][data-record-id="${cardId}"]`);
  await card.click();
  const popup = dm.getByTestId("cbt-popup");
  await expect(popup).toBeVisible();
  await expect(
    popup.locator('[data-testid="cbt-card-die-max"][data-part="base"][data-index="0"]'),
  ).toBeVisible();
  await expect(popup.getByTestId("gem-combat")).toHaveCount(0);
  const goblin = (await init
    .locator('[data-testid="cbt-init-row"]')
    .filter({ has: dm.locator('[data-testid="cbt-init-row-name"][data-value="Goblin"]') })
    .first()
    .getAttribute("data-record-id")) as string;
  await popup.getByTestId("cbt-popup-target-add").click();
  await dm.locator(`[data-testid="cbt-popup-target-option"][data-value="${goblin}"]`).click();
  const trow = popup.locator(`[data-testid="cbt-popup-target-row"][data-record-id="${goblin}"]`);
  const hit = trow.getByTestId("cbt-popup-target-hit");
  if ((await hit.getAttribute("data-value")) === "miss") await hit.click();
  await popup.getByTestId("cbt-popup-apply").click();
  await expect(popup).toHaveCount(0);
  // The DM's outcome line labels the maxed chip `max` (FR-CBT-131).
  const outcome = line(logs[0] as Locator, /Brakka attacks Goblin: .* 16 slashing/);
  await expect(outcome).toHaveCount(1);
  await expect(outcome.getByRole("img", { name: "max d6: 6" })).toHaveCount(1);

  // A physical total: the DM spends for Brakka in the popup; each die is asked first.
  const second = await attack(p1, [{ diceTotal: 12 }, { diceTotal: 8 }], [{ diceTotal: 9 }]);
  await init.locator(`[data-testid="cbt-init-card"][data-record-id="${second}"]`).click();
  await expect(popup).toBeVisible();
  await popup.getByTestId("gem-combat").click();
  const known = (i: number) =>
    popup.locator(`[data-testid="gem-combat-known"][data-part="base"][data-index="${i}"]`);
  await known(0).fill("3");
  await known(1).fill("4");
  await expect(popup.getByTestId("gem-combat-known-error")).toHaveText(
    "The dice add up to 7, not 8",
  );
  await known(1).fill("5");
  await popup.locator('[data-testid="gem-combat-die"][data-part="base"][data-index="0"]').click();
  await popup.getByTestId("gem-combat-submit").click();
  await expect(
    popup.locator('[data-testid="cbt-card-die-max"][data-part="base"][data-index="0"]'),
  ).toBeVisible();
  for (const log of logs)
    await expect(line(log, /Brakka spends a Combat gem — .*3 → 6/)).toHaveCount(2);

  // Player 2 never received either card or a maxed die (only the public spend lines).
  const frames = p2Frames.join("\n");
  expect(frames).not.toContain('"diceMaxed"');
  expect(frames).not.toContain('"maxed"');
  for (const id of [cardId, second]) {
    expect(frames).not.toContain(`"type":"notification","id":"${id}"`);
  }
});
