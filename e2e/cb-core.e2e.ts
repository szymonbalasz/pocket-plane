// e2e-bundle: cb-reorder-e2e
// Thin CB0 flow (CBTX §13.1 E2E): the DM moves Thorn below Fire Elemental 3 inside the 12-tie
// (`cbtx.moveCombatant` over a socket of its own: the drag UI is CB1). Player 2's Initiative shows
// Fire Elemental 3 above Thorn within 1 s, a reload keeps it, and no player-2 frame carries
// `tieOrder` or a monster's number. Rules, leaks, crash: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

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

/** Record ids of the Initiative rows, top to bottom. */
const rowIds = (init: Locator) =>
  init
    .locator('[data-testid="cbt-init-row"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));

test("FR-CBTX-64 FR-CBTX-66 FR-CBTX-67 DM moves Thorn inside the 12-tie: player 2 follows live and after reload, no tieOrder on the wire", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const DM: Cred = { role: "dm", secret };
  const thorn = recordId("combat-1", "combatant", 1);
  const fe3 = recordId("cp-combat", "combatant", 4);
  const encounterId = recordId("encounter-1", "encounter");

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  const frames: string[] = [];
  p2.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  await p2.goto(link("Player 2"));
  await live(p2);
  const init = await openWindow(p2, "cbt.initiative");
  const order = async () => (await rowIds(init)).filter((id) => id === thorn || id === fe3);
  // Default rules: Thorn (init bonus) above Fire Elemental 3.
  await expect.poll(order).toEqual([thorn, fe3]);

  await intent(dm, DM, "cbtx.moveCombatant", { encounterId, combatantId: thorn, afterId: fe3 });
  await expect.poll(order, { timeout: 1_000 }).toEqual([fe3, thorn]);

  await p2.reload();
  await live(p2);
  const again = await openWindow(p2, "cbt.initiative");
  await expect
    .poll(async () => (await rowIds(again)).filter((id) => id === thorn || id === fe3))
    .toEqual([fe3, thorn]);
  const wire = frames.join("\n");
  expect(wire).not.toContain("tieOrder");
  // A monster's number never reaches a player (FR-CBT-26); Thorn keeps 12.
  expect(wire).not.toMatch(/"kind":"monster"[^}]*"initiative"/);
});
