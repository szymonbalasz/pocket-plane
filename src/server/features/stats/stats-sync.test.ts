// Stats over real sockets on the `stats` bundle (DM, `player-1`, `player-2`): FR-STATS-05 leak scan
// per player over `stats.query` acks (live, after reconnect, after a hard restart), FR-STATS-16
// answers in frame order + same results after a restart, FR-STATS-20 / FR-NOTE-48 Show awards
// reaches everyone, FR-CBT-137 a live callout frame carries the flag, never the amount.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import {
  PlayerFightResult,
  SessionResult,
  SessionsResult,
  STATS_AWARDS_KIND,
  STATS_QUERY_INTENT,
  STATS_SHOW_AWARDS_INTENT,
} from "@shared/stats/schemas";
import { closeDb, type Db } from "../../db/client";
import { combatant, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { leaksIn } from "../combat-tracker/testing";
import { NOTIFICATION_TYPE } from "../notifications/helpers";
import { statsMemory } from "./index";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let combatants: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("stats", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  combatants = Object.fromEntries(
    db
      .select()
      .from(combatant)
      .all()
      .map((c) => [c.name, c.id]),
  );
  // The manual clock (fix/test-hot-files): the rate window passes by advancing it, not by sleeping.
  h = await startTestServer({ db, testMode: true });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const P1 = (): Credential => ({ role: "player", token: tokens["Player 1"] as string });
const P2 = (): Credential => ({ role: "player", token: tokens["Player 2"] as string });

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function result(c: TestClient, name: string, payload: unknown): Promise<unknown> {
  const f = await reply(c, name, payload);
  if (f.type !== "ack") throw new Error(JSON.stringify(f));
  return f.result;
}
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}

/**
 * What a player's stats acks must never hold (FR-STATS-05): DM-only names (hidden monsters and
 * encounter names), HP / AC / overkill / Effective fields, the DM's special rows.
 */
const LEAKS = [
  "Elite Goblin Warrior",
  '"Goblin 2"',
  '"Wolf"',
  "Ambush at the Ford",
  "Old Crypt",
  '"hidden"',
  '"downs"',
  '"effective"',
  "hpBefore",
  "hpAfter",
  '"applied"',
  '"overkill"',
  "targetAc",
  "DM (direct)",
  "Unattributed",
  '"monster"',
];

/**
 * Every stats answer a player can ask for, parsed strictly with the player schemas: 4 computed
 * answers, the per-viewer rate (FR-STATS-16, -69); callers wait a second between rounds.
 */
async function playerAnswers(c: TestClient) {
  const fight = PlayerFightResult.parse(await result(c, STATS_QUERY_INTENT, { scope: "fight" }));
  const keys = fight.fights.map((f) => f.key).filter((k) => k !== fight.fight?.key);
  const fights = [];
  for (const k of keys) {
    fights.push(
      PlayerFightResult.parse(
        await result(c, STATS_QUERY_INTENT, { scope: "fight", encounterId: k }),
      ),
    );
  }
  const sessions = SessionsResult.parse(await result(c, STATS_QUERY_INTENT, { scope: "sessions" }));
  const session = SessionResult.parse(await result(c, STATS_QUERY_INTENT, { scope: "session" }));
  return { fight, fights, sessions, session };
}

/** Past the per-viewer rate window (FR-STATS-16, -69) between query rounds: the clock moves on. */
const RATE_WINDOW_MS = 1050;

const ackText = (frames: readonly ServerFrame[]) =>
  JSON.stringify(frames.filter((f) => f.type === "ack"));

describe("stats over real sockets (stats)", () => {
  test("FR-STATS-14 cache warmed at start: the active campaign's sessions are read before any query", async () => {
    await h.restart();
    const campaignId = db.select().from(player).all()[0]?.campaignId as string;
    const warmed = statsMemory(h.s).cache.lastN(campaignId);
    expect(warmed).not.toBeNull();
    expect(warmed).toBeGreaterThan(40);
  });

  test("FR-STATS-05 leak scan per player: acks, after reconnect and after a hard restart carry no hidden fact", async () => {
    const dm = await h.live(DM);
    const dmFight = await result(dm, STATS_QUERY_INTENT, { scope: "fight" });
    expect(JSON.stringify(dmFight)).toContain("Elite Goblin Warrior");
    const first: Record<string, unknown> = {};
    for (const [name, cred] of [
      ["Player 1", P1],
      ["Player 2", P2],
    ] as const) {
      const c = await h.live(cred());
      const answers = await playerAnswers(c);
      expect(leaksIn(ackText(c.frames), LEAKS)).toEqual([]);
      // No `raw − value` on Biggest overkill: the value is the callout line's raw.
      const ok = answers.session.session?.awards.find((a) => a.key === "biggest-overkill");
      expect(ok?.value).toBe(ok?.detail?.raw);
      first[name] = answers;
      c.close();
      // Reconnect: the same answers, still clean.
      const again = await h.live(cred());
      expect(await playerAnswers(again)).toEqual(answers);
      expect(leaksIn(ackText(again.frames), LEAKS)).toEqual([]);
      again.close();
    }
    // Every player gets the same numbers (FR-STATS-03).
    expect(first["Player 1"]).toEqual(first["Player 2"]);
    dm.close();
    // FR-STATS-16 hard kill → same results: nothing was stored, the restart recomputes.
    await h.restart();
    h.timers.advance(RATE_WINDOW_MS);
    const after = await h.live(P1());
    expect(await playerAnswers(after)).toEqual(first["Player 1"] as never);
    expect(leaksIn(ackText(after.frames), LEAKS)).toEqual([]);
    after.close();
  }, 30_000);

  test("FR-STATS-16 answered in frame order: an ack after the event frame of the change it counts", async () => {
    h.timers.advance(RATE_WINDOW_MS);
    const dm = await h.live(DM);
    const p1 = await h.live(P1());
    const before = PlayerFightResult.parse(
      await result(p1, STATS_QUERY_INTENT, { scope: "fight" }),
    );
    const thorn = before.fight?.rows.find((r) => r.name === "Thorn")?.dealt as number;
    await result(dm, CBT_INTENTS.applyHp, {
      combatantId: combatants["Goblin Scout 2"],
      kind: "damage",
      amount: 3,
      public: true,
      sourceId: combatants.Thorn,
    });
    const id = p1.intent(STATS_QUERY_INTENT, { scope: "fight" });
    let sawEvent = false;
    for (;;) {
      const f = await p1.next(undefined, 3000);
      if (f.type === "event" && f.changes.some((c) => c.type === GAME_LOG_ENTRY_TYPE))
        sawEvent = true;
      if (f.type === "ack" && f.intentId === id) {
        expect(sawEvent).toBe(true);
        const r = PlayerFightResult.parse(f.result);
        expect(r.fight?.rows.find((x) => x.name === "Thorn")?.dealt).toBe(thorn + 3);
        break;
      }
    }
    dm.close();
    p1.close();
  });

  test("FR-CBT-137 a live callout frame: players get the flag, never the amount; the DM gets both", async () => {
    const dm = await h.live(DM);
    const p2 = await h.live(P2());
    const from = p2.frames.length;
    // Goblin Scout 2 is at 4 HP now: 40 from Thorn → overkill 36 ≥ 10.
    await result(dm, CBT_INTENTS.applyHp, {
      combatantId: combatants["Goblin Scout 2"],
      kind: "damage",
      amount: 40,
      public: true,
      sourceId: combatants.Thorn,
    });
    await until(() =>
      recordsOf<GameLogEntryRecord>(p2.store, GAME_LOG_ENTRY_TYPE).some(
        (e) => (e.payload as { amount?: number }).amount === 40,
      ),
    );
    const line = recordsOf<GameLogEntryRecord>(p2.store, GAME_LOG_ENTRY_TYPE).find(
      (e) => (e.payload as { amount?: number }).amount === 40,
    );
    expect(line?.payload).toMatchObject({ callout: "overkill", sourced: true });
    expect(line).not.toHaveProperty("dmPayload");
    const raw = JSON.stringify(p2.frames.slice(from));
    expect(raw).not.toContain('"overkill":36');
    await until(() =>
      recordsOf<GameLogEntryRecord>(dm.store, GAME_LOG_ENTRY_TYPE).some(
        (e) => (e.dmPayload as { overkill?: number } | null)?.overkill === 36,
      ),
    );
    dm.close();
    p2.close();
  });

  test("FR-NOTE-48 awards notification: Show awards reaches the DM and every player, payload player-safe", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(P1());
    const p2 = await h.live(P2());
    const sessions = SessionsResult.parse(
      await result(dm, STATS_QUERY_INTENT, { scope: "sessions" }),
    );
    const key = sessions.sessions.at(-1)?.fromN as number;
    const r = (await result(dm, STATS_SHOW_AWARDS_INTENT, { fromN: key })) as {
      notificationId: string;
    };
    const rejected = await reply(p1, STATS_SHOW_AWARDS_INTENT, { fromN: key });
    expect(rejected.type === "reject" && rejected.code).toBe("forbidden");
    for (const c of [dm, p1, p2]) {
      await until(() =>
        recordsOf<NotificationRecord>(c.store, NOTIFICATION_TYPE).some(
          (n) => n.id === r.notificationId,
        ),
      );
      const n = recordsOf<NotificationRecord>(c.store, NOTIFICATION_TYPE).find(
        (x) => x.id === r.notificationId,
      );
      expect(n).toMatchObject({ kind: STATS_AWARDS_KIND, state: "info" });
      expect(n?.payload).toMatchObject({ fromN: key });
      expect(leaksIn(JSON.stringify(n), LEAKS)).toEqual([]);
    }
    // Players open the awards with the key they were sent.
    const opened = SessionResult.parse(
      await result(p2, STATS_QUERY_INTENT, { scope: "session", n: key }),
    );
    expect(opened.session?.fromN).toBe(key);
    for (const c of [dm, p1, p2]) c.close();
  });
});
