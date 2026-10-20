// e2e-bundle: gems-e2e
// Thin gems core flow (GEM §13 E2E, GM0; CAMP FR-CAMP-40): DM, player-1 (Mira, Brakka), player-2.
// Gems start off (counts kept): no gem line anywhere. The DM switches gems on → every client
// resyncs (the DM's roll-bar draft and open Options survive); the award lines show; the DM awards
// Mira a Fortune gem; player-1 spends it; the line shows for all three. The DM switches off → every
// gem line is gone without a reload, and player-2's frames from then on carry no gem byte. No gem
// UI exists yet (GM3), so the intents go over a socket of their own. Rules, leaks: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });

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

test("FR-GEM-01 FR-GEM-02 FR-GEM-04 FR-GEM-09 FR-GEM-12 FR-CAMP-40 gems on: award + Fortune spend lines for everyone, drafts kept; off: every gem line gone live", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const DM: Cred = { role: "dm", secret };
  const p1Token = link("Player 1").split("/").pop() as string;
  const P1: Cred = { role: "player", token: p1Token };
  const mira = recordId("char-mira", "entity");

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => {
    ws.on("framereceived", (f) => p2Frames.push(String(f.payload)));
  });
  await p2.goto(link("Player 2"));
  await live(p2);

  const logs = [await openWindow(dm, "dice.log"), await openWindow(p1, "dice.log")];
  logs.push(await openWindow(p2, "dice.log"));
  const [dmLog] = logs as [Locator, Locator, Locator];
  for (const log of logs) await expect(line(log, "DM awards")).toHaveCount(0);
  expect(p2Frames.join("\n")).not.toContain("character-gems");
  expect(p2Frames.join("\n")).not.toContain('"gem.');

  // Client-only UI state the switch's resync must keep (FR-CAMP-40): a draft and open Options.
  await dmLog.getByTestId("dice-roll-expression").fill("2d6+3");
  const options = dmLog.getByTestId("dice-roll-options");
  if ((await options.getAttribute("data-state")) !== "open") await options.click();
  await expect(options).toHaveAttribute("data-state", "open");

  // On: the kept counts' award lines come back for everyone.
  await intent(dm, DM, "camp.setFeature", { feature: "gems", on: true });
  for (const log of logs) {
    await expect(line(log, "DM awards Brakka a Fortune gem (6 held)")).toHaveCount(1);
    await expect(line(log, "DM awards Mira a Fortune gem (1 held)")).toHaveCount(1);
  }
  await expect(dmLog.getByTestId("dice-roll-expression")).toHaveValue("2d6+3");
  await expect(options).toHaveAttribute("data-state", "open");

  // The DM awards Mira a second Fortune gem; player-1 spends one.
  await intent(dm, DM, "gem.adjust", { characterId: mira, gem: "fortune", delta: 1 });
  for (const log of logs) {
    await expect(line(log, "DM awards Mira a Fortune gem (2 held)")).toHaveCount(1);
  }
  await intent(p1, P1, "gem.spend", { characterId: mira, gem: "fortune" });
  for (const log of logs) {
    await expect(line(log, "Mira spends a Fortune gem — searching for treasure")).toHaveCount(1);
  }

  // Off: every gem line goes without a reload; the draft stays; player-2 gets no gem byte.
  const from = p2Frames.length;
  await intent(dm, DM, "camp.setFeature", { feature: "gems", on: false });
  for (const log of logs) {
    await expect(line(log, "spends a Fortune gem")).toHaveCount(0);
    await expect(line(log, "DM awards")).toHaveCount(0);
  }
  await expect(dmLog.getByTestId("dice-roll-expression")).toHaveValue("2d6+3");
  const after = p2Frames.slice(from).join("\n");
  expect(after).toContain('"snapshot"');
  expect(after).not.toContain("character-gems");
  expect(after).not.toContain('"gem.');
  expect(after).not.toContain('"features":["gems"]');
});
