// Stats tier B over real sockets on the `stats-b` bundle (DM, `player-1` = Mira, `player-2` =
// Thorn): FR-STATS-47 leak scan per player over Highlights / luck / trophies acks (live, after
// reconnect, after a hard restart: same numbers), FR-STATS-43 another's trophies → `forbidden`,
// FR-STATS-29 / FR-CBT-152 a hidden-side kill's `fell` never reaches players, FR-STATS-33 /
// FR-NOTE-68 End → the fight summary for everyone (it survives the restart).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { CBT_INTENTS, HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import {
  PlayerFightResult,
  PlayerLuckResult,
  STATS_FIGHT_SUMMARY_KIND,
  STATS_QUERY_INTENT,
  TrophiesResult,
} from "@shared/stats/schemas";
import { closeDb, type Db } from "../../db/client";
import { combatant, encounter, entity, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { leaksIn } from "../combat-tracker/testing";
import { NOTIFICATION_TYPE } from "../notifications/helpers";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let combatants: Record<string, string>;
let characters: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("stats-b", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  // The ambush's combatants (the crypt's Mira / Thorn come first; later rows win).
  combatants = Object.fromEntries(
    db
      .select()
      .from(combatant)
      .all()
      .map((c) => [c.name, c.id]),
  );
  characters = Object.fromEntries(
    db
      .select()
      .from(entity)
      .all()
      .filter((e) => e.kind === "character")
      .map((e) => [e.name, e.id]),
  );
  h = await startTestServer({ db, testMode: true, fake: false });
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
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}

/**
 * What a player's tier-B acks must never hold (FR-STATS-47): hidden monsters and encounter names,
 * HP / AC / overkill / Effective fields, hidden marks, Still standing, the DM's dice row.
 */
const LEAKS = [
  "Elite Goblin Warrior",
  "Bandit Captain",
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
  '"standing"',
  "dm-dice",
  "DM dice",
];

/** Past the per-connection rate window (FR-STATS-16) between query rounds. */
const RATE_WINDOW_MS = 1050;

const ackText = (frames: readonly ServerFrame[]) =>
  JSON.stringify(frames.filter((f) => f.type === "ack"));

/** A campaign answer, re-asked (1 s apart, as the client) while the partials build. */
async function settled<T extends { pending?: true }>(ask: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 10; i++) {
    const r = await ask();
    if (!r.pending) return r;
    await Bun.sleep(RATE_WINDOW_MS);
  }
  throw new Error("partials never ready");
}

/** Every tier-B answer a player can ask for (4 computed answers: the per-connection rate). */
async function playerAnswers(c: TestClient, own: string) {
  const fight = PlayerFightResult.parse(await result(c, STATS_QUERY_INTENT, { scope: "fight" }));
  const session = PlayerLuckResult.parse(await result(c, STATS_QUERY_INTENT, { scope: "luck" }));
  const campaign = await settled(
    async () =>
      PlayerLuckResult.parse(await result(c, STATS_QUERY_INTENT, { scope: "luck", campaign: true }))
        .luck,
  );
  const trophies = await settled(
    async () =>
      TrophiesResult.parse(
        await result(c, STATS_QUERY_INTENT, { scope: "trophies", characterId: own }),
      ).trophies,
  );
  return { highlights: fight.fight?.highlights, session: session.luck, campaign, trophies };
}

describe("stats tier B over real sockets (stats-b)", () => {
  test("FR-STATS-47 leak scan per player: Highlights, luck and trophies acks, after reconnect and after a hard restart", async () => {
    await Bun.sleep(RATE_WINDOW_MS);
    const dm = await h.live(DM);
    const dmFight = JSON.stringify(await result(dm, STATS_QUERY_INTENT, { scope: "fight" }));
    expect(dmFight).toContain("Bandit Captain");
    expect(dmFight).toContain('"standing"');
    const first: Record<string, Awaited<ReturnType<typeof playerAnswers>>> = {};
    for (const [name, cred, own] of [
      ["Player 1", P1, "Mira"],
      ["Player 2", P2, "Thorn"],
    ] as const) {
      const c = await h.live(cred());
      const answers = await playerAnswers(c, characters[own] as string);
      expect(leaksIn(ackText(c.frames), LEAKS)).toEqual([]);
      expect(answers.highlights?.kills.events.map((e) => e.to)).not.toContain("Bandit Captain");
      first[name] = answers;
      c.close();
      await Bun.sleep(RATE_WINDOW_MS);
      // Reconnect: the same answers, still clean.
      const again = await h.live(cred());
      expect(await playerAnswers(again, characters[own] as string)).toEqual(answers);
      expect(leaksIn(ackText(again.frames), LEAKS)).toEqual([]);
      again.close();
      await Bun.sleep(RATE_WINDOW_MS);
    }
    // Every player gets the same party numbers.
    expect(first["Player 1"]?.campaign).toEqual(first["Player 2"]?.campaign);
    expect(first["Player 1"]?.highlights).toEqual(first["Player 2"]?.highlights);
    dm.close();
    // Hard kill → same numbers: nothing stored; the restart rebuilds the partials.
    await h.restart();
    await Bun.sleep(RATE_WINDOW_MS);
    const after = await h.live(P1());
    expect(await playerAnswers(after, characters.Mira as string)).toEqual(
      first["Player 1"] as never,
    );
    expect(leaksIn(ackText(after.frames), LEAKS)).toEqual([]);
    after.close();
  }, 60_000);

  test("FR-STATS-43 another's trophies over the socket → forbidden", async () => {
    await Bun.sleep(RATE_WINDOW_MS);
    const p2 = await h.live(P2());
    const r = await reply(p2, STATS_QUERY_INTENT, {
      scope: "trophies",
      characterId: characters.Mira,
    });
    expect(r.type === "reject" && r.code).toBe("forbidden");
    p2.close();
  });

  test("FR-STATS-29 FR-CBT-152 a hidden-side kill: the DM's line has fell, players get no line; a public kill flags the line for all", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(P1());
    const p2 = await h.live(P2());
    const from = { p1: p1.frames.length, p2: p2.frames.length };
    // Thorn → the hidden Elite (15 HP): a DM-only line, public asked for but forced off.
    await result(dm, CBT_INTENTS.applyHp, {
      combatantId: combatants["Elite Goblin Warrior"],
      kind: "damage",
      amount: 30,
      public: true,
      sourceId: combatants.Thorn,
    });
    // Thorn → Bandit 4 (11 HP): 25, a public kill with the callout (walkthrough step 2).
    await result(dm, CBT_INTENTS.applyHp, {
      combatantId: combatants["Bandit 4"],
      kind: "damage",
      amount: 25,
      public: true,
      sourceId: combatants.Thorn,
    });
    const lines = (c: TestClient) => recordsOf<GameLogEntryRecord>(c.store, GAME_LOG_ENTRY_TYPE);
    const flagged = (c: TestClient, target: string, amount: number) =>
      lines(c).find((e) => {
        const p = e.payload as { targetName?: string; amount?: number; fell?: string };
        return p.targetName === target && p.amount === amount && p.fell === "kill";
      });
    await until(() => !!flagged(dm, "Elite Goblin Warrior", 30) && !!flagged(dm, "Bandit 4", 25));
    for (const [c, start] of [
      [p1, from.p1],
      [p2, from.p2],
    ] as const) {
      await until(() => !!flagged(c, "Bandit 4", 25));
      expect(flagged(c, "Bandit 4", 25)?.payload).toMatchObject({ callout: "overkill" });
      expect(flagged(c, "Elite Goblin Warrior", 30)).toBeUndefined();
      const raw = JSON.stringify(c.frames.slice(start));
      expect(raw).not.toContain("Elite Goblin Warrior");
      expect(raw).not.toContain(HP_CHANGE_TYPE);
      expect(raw).not.toContain('"overkill":14');
    }
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-STATS-33 FR-NOTE-68 End → one fight summary for the DM and every player; it survives a hard restart", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(P1());
    const p2 = await h.live(P2());
    const ambush = db
      .select()
      .from(encounter)
      .all()
      .find((e) => e.status === "started")?.id as string;
    await result(dm, CBT_INTENTS.end, { encounterId: ambush });
    // The fixture's ended Old Crypt has its own (made by the same hook at load).
    const summaryOf = (c: TestClient) =>
      recordsOf<NotificationRecord>(c.store, NOTIFICATION_TYPE).filter(
        (n) =>
          n.kind === STATS_FIGHT_SUMMARY_KIND &&
          (n.payload as { encounterId?: string }).encounterId === ambush,
      );
    for (const c of [dm, p1, p2]) {
      await until(() => summaryOf(c).length > 0).catch(() => {
        throw new Error(
          `no summary: ${JSON.stringify(recordsOf<NotificationRecord>(c.store, NOTIFICATION_TYPE).map((n) => n.kind))}`,
        );
      });
      expect(summaryOf(c)[0]).toMatchObject({
        audience: "all",
        state: "info",
        text: "Fight summary",
        payload: { encounterId: ambush },
      });
      expect(leaksIn(JSON.stringify(summaryOf(c)), LEAKS)).toEqual([]);
    }
    for (const c of [dm, p1, p2]) c.close();
    await h.restart();
    const again = await h.live(P2());
    expect(summaryOf(again)).toHaveLength(1);
    again.close();
  }, 30_000);
});
