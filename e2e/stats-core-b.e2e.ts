// e2e-bundle: stats-b-e2e
// Thin stats tier-B core flow (SB0: FR-CBT-152, FR-CBT-153, FR-STATS-31, -33, -43, -45): DM,
// player-1 (Mira) and player-2 (Thorn) on the `stats-b` bundle's Goblin Ambush. The DM's 25 From
// Thorn on Bandit 4 (11 HP) is one overkill kill: both logs show the line, one toast each, and the
// line's `fell` reaches player-2's frames. End: the `stats-fight-summary` notification reaches the
// DM and player-2, and their Highlights list the kill. Player-1 reads Mira's trophies; player-2 may
// not. No tier-B UI yet (SB1 / SB2), so the queries go over a socket of their own. Rules: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });

type Cred = { role: "dm"; secret: string } | { role: "player"; token: string };

/** One intent over a socket of its own (hello → snapshot → intent → ack result / reject code). */
function intent(page: Page, credential: Cred, name: string, payload: unknown) {
  return page.evaluate(
    ([credential, name, payload]) =>
      new Promise<unknown>((resolve) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "hello", credential }));
        let sent = false;
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string; result?: unknown; code?: string };
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
            resolve({ rejected: f.code });
          }
        };
      }),
    [credential, name, payload] as const,
  );
}

/** Every frame a page's sockets receive. */
function framesOf(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(String(f.payload)));
  });
  return frames;
}

type Highlights = { kills: { events: { from: string | null; to: string; callout: boolean }[] } };

test("FR-CBT-152 FR-CBT-153 FR-STATS-31 FR-STATS-33 FR-STATS-43 one kill toast each, End's summary and Highlights, own trophies only", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const DM: Cred = { role: "dm", secret };
  const P1: Cred = { role: "player", token: link("Player 1").split("/").pop() as string };
  const P2: Cred = { role: "player", token: link("Player 2").split("/").pop() as string };
  const thorn = recordId("combat-1", "combatant", 1);
  const bandit4 = recordId("sb-fight-facts", "combatant", 3);
  const encounterId = recordId("encounter-1", "encounter");
  const mira = recordId("char-mira", "entity");

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  const dmFrames = framesOf(dm);
  await loginDm(dm, secret);
  await live(dm);
  const p2 = await rolePage(browser);
  await p2.setViewportSize({ width: 1440, height: 900 });
  const p2Frames = framesOf(p2);
  await p2.goto(link("Player 2"));
  await live(p2);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  const dmLog = await openWindow(dm, "dice.log");
  const p2Log = await openWindow(p2, "dice.log");

  // Thorn → Bandit 4 (11 HP): 25, a kill with the overkill callout (overkill 14).
  const from = p2Frames.length;
  await intent(dm, DM, "cbt.applyHp", {
    combatantId: bandit4,
    kind: "damage",
    amount: 25,
    public: true,
    sourceId: thorn,
  });
  for (const log of [dmLog, p2Log]) {
    await expect(line(log, "Thorn → Bandit 4, 25 damage — Overkill!")).toHaveCount(1);
  }
  for (const page of [dm, p2]) await expect(page.getByTestId("stats-feed-toast")).toHaveCount(1);
  const fell = p2Frames.slice(from).join("\n");
  expect(fell).toContain('"fell":"kill"');
  expect(fell).not.toContain('"overkill":14');

  // End → the fight summary for the DM and player-2; Highlights list the kill for both.
  await intent(dm, DM, "cbt.end", { encounterId });
  for (const frames of [dmFrames, p2Frames]) {
    await expect.poll(() => frames.join("\n").includes('"kind":"stats-fight-summary"')).toBe(true);
  }
  for (const [page, cred] of [
    [dm, DM],
    [p2, P2],
  ] as const) {
    const r = (await intent(page, cred, "stats.query", { scope: "fight", encounterId })) as {
      fight: { status: string; highlights: Highlights };
    };
    expect(r.fight.status).toBe("ended");
    expect(r.fight.highlights.kills.events).toContainEqual(
      expect.objectContaining({ from: "Thorn", to: "Bandit 4", callout: true }),
    );
  }

  // Trophies: Mira's for player-1; another's → forbidden.
  const own = (await intent(p1, P1, "stats.query", { scope: "trophies", characterId: mira })) as {
    trophies: { pending?: true; lifetime?: { dealt: number } };
  };
  expect(own.trophies.pending ?? false).toBe(false);
  expect(own.trophies.lifetime?.dealt).toBeGreaterThan(0);
  const other = (await intent(p2, P2, "stats.query", { scope: "trophies", characterId: mira })) as {
    rejected?: string;
  };
  expect(other.rejected).toBe("forbidden");

  for (const page of [p1, p2, dm]) await page.context().close();
});
