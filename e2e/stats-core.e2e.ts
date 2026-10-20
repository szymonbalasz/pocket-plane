// e2e-bundle: stats-e2e
// Thin stats core flow (ST-core: FR-CBT-136, FR-CBT-137, FR-STATS-16): DM + player-2 on the
// `stats` bundle's Goblin Ambush. The DM heals Mira From Brakka in the Damage / heal dialog: both
// logs read "Brakka → Mira, heal 2". The DM's 40 From Thorn on Goblin Scout 2 (7 HP) ends the line
// with "— Overkill!" for both, "(+33 over 7 HP)" for the DM only; player-2's `stats.query` counts
// the 40. No Stats window yet (ST2), so the query goes over a socket of its own. Rules: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });
const row = (scope: Locator, id: string) =>
  scope.locator(`[data-testid="cbt-init-row"][data-record-id="${id}"]`);

type Cred = { role: "dm"; secret: string } | { role: "player"; token: string };

/** One intent over a socket of its own (hello → snapshot → intent → ack result). */
function intent(page: Page, credential: Cred, name: string, payload: unknown) {
  return page.evaluate(
    ([credential, name, payload]) =>
      new Promise<unknown>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "hello", credential }));
        let sent = false;
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; result?: unknown };
          if (f.type === "snapshot" && !sent) {
            sent = true;
            ws.send(
              JSON.stringify({ type: "intent", intentId: crypto.randomUUID(), name, payload }),
            );
          } else if (f.type === "ack") {
            ws.close();
            resolve(f.result);
          } else if (f.type === "reject") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [credential, name, payload] as const,
  );
}

/** The DM's Damage / heal dialog on a row: amount, From, then Heal or Damage. */
async function hpFrom(
  dm: Page,
  init: Locator,
  target: string,
  amount: number,
  from: string,
  kind: "heal" | "damage",
) {
  await row(init, target).scrollIntoViewIfNeeded();
  await row(init, target).getByTestId("cbt-init-row-menu").click();
  await dm.getByTestId("cbt-init-row-hp-adjust").click();
  const dialog = dm.getByTestId("cbt-hp");
  await dialog.getByTestId("cbt-hp-amount").fill(String(amount));
  await dialog.getByTestId("cbt-hp-from").click();
  await dm.locator(`[data-testid="cbt-hp-from-option"][data-record-id="${from}"]`).click();
  await dialog.getByTestId(kind === "heal" ? "cbt-hp-heal" : "cbt-hp-damage").click();
  await expect(dialog).toHaveCount(0);
}

test("FR-CBT-136 FR-CBT-137 FR-STATS-16 From on a heal, the overkill line for both, the player's stats count it", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const mira = recordId("combat-1", "combatant", 0);
  const thorn = recordId("combat-1", "combatant", 1);
  const brakka = recordId("trg-combat", "combatant", 0);
  const scout2 = recordId("st-ambush-facts", "combatant", 1);

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto(link("Player 2"));
  await live(p2);
  const dmLog = await openWindow(dm, "dice.log");
  const p2Log = await openWindow(p2, "dice.log");
  const init = await openWindow(dm, "cbt.initiative");

  // FR-CBT-136: From Brakka (the turn is the hidden Wolf's, so the pick matters).
  await hpFrom(dm, init, mira, 2, brakka, "heal");
  for (const log of [dmLog, p2Log]) {
    await expect(line(log, "Brakka → Mira, heal 2")).toHaveCount(1);
  }

  // FR-CBT-137: 40 on the 7 HP Goblin Scout 2 → overkill 33 ≥ 10.
  await hpFrom(dm, init, scout2, 40, thorn, "damage");
  await expect(
    line(dmLog, "Thorn → Goblin Scout 2, 40 damage — Overkill! (+33 over 7 HP)"),
  ).toHaveCount(1);
  const p2Line = line(p2Log, "Thorn → Goblin Scout 2, 40 damage — Overkill!");
  await expect(p2Line).toHaveCount(1);
  await expect(p2Line).not.toContainText("over 7");

  // FR-STATS-16: player-2's query counts the 40 (Thorn: 30 + 40 in the Ambush).
  const token = link("Player 2").split("/").pop() as string;
  const r = (await intent(p2, { role: "player", token }, "stats.query", { scope: "fight" })) as {
    fight: { rows: { name: string; dealt: number }[] };
  };
  expect(r.fight.rows.find((x) => x.name === "Thorn")?.dealt).toBe(70);

  await p2.context().close();
  await dm.context().close();
});
