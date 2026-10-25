// Sprint 10 T2 (BL-111, DM #343) over real sockets on `stats`: players don't get "Most damage
// dealt" (Session cards, recap Awards) or the fight's MVP while the window holds party damage they
// don't see (sprint 12 BL-121: nor the other damage awards); the DM keeps all. sim-14's case: Thorn leads in public, the DM's hidden 80 From Mira
// on the hidden Elite makes Mira the DM's winner. No player frame or ack carries the hidden line,
// its amount, its target or the DM's winner; acks are the same after a reconnect and a restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CBT_INTENTS, COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { RECAP_QUERY_INTENT } from "@shared/session-recap/schemas";
import { type Award, STATS_QUERY_INTENT } from "@shared/stats/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];

/** One intent → its ack's result (rejects fail the test). */
async function ask<R>(c: TestClient, name: string, payload: unknown): Promise<R> {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if (f.type === "ack" && f.intentId === id) return f.result as R;
    if (f.type === "reject" && f.intentId === id) throw new Error(JSON.stringify(f));
  }
}

type Session = { session: { awards: Award[] } | null };
type Fight = {
  fight: {
    key: string;
    highlights: { mvp: { value: number | null; winners: { name: string }[] } };
  };
  fights: { key: string; label: string }[];
};
type Recap = {
  recap: { awards?: Award[]; fights: { key: string; mvp: { value: number | null } }[] } | null;
};
const card = (awards: readonly Award[] | undefined, key: string) =>
  awards?.find((a) => a.key === key);

describe("BL-111 Most damage dealt over WS (stats)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("stats", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    h = await startTestServer({ db, fake: false });
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-STATS-12 BL-111 players get no Most damage dealt / MVP while party damage is unseen; the DM keeps it; no frame or ack leaks the hidden line; reconnect and restart answer the same", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const named = (name: string) =>
      all<CombatantRecord>(dm, COMBATANT_TYPE).find(
        (c) => c.name === name && c.active && !c.removed,
      ) as CombatantRecord;
    const thorn = named("Thorn");
    const mira = named("Mira");
    const elite = named("Elite Goblin Warrior");
    const scout2 = named("Goblin Scout 2");
    expect(elite.hidden).toBe(true);

    // The fixture clock is months back: a live line starts today's session. Public first.
    await ask(dm, CBT_INTENTS.applyHp, {
      combatantId: scout2.id,
      kind: "damage",
      amount: 5,
      public: true,
      sourceId: thorn.id,
    });
    for (const c of [dm, p1, p2]) {
      const s = await ask<Session>(c, STATS_QUERY_INTENT, { scope: "session" });
      expect(card(s.session?.awards, "most-dealt")).toMatchObject({
        value: 5,
        winners: [{ name: "Thorn" }],
      });
    }
    const marks = [p1.raw().length, p2.raw().length];

    // sim-14: the DM's hidden 80 From Mira on the hidden Elite (a DM-only line).
    await ask(dm, CBT_INTENTS.applyHp, {
      combatantId: elite.id,
      kind: "damage",
      amount: 80,
      sourceId: mira.id,
    });
    const dmSession = await ask<Session>(dm, STATS_QUERY_INTENT, { scope: "session" });
    expect(dmSession.session?.awards).toHaveLength(9);
    expect(card(dmSession.session?.awards, "most-dealt")).toMatchObject({
      value: 80,
      winners: [{ name: "Mira" }],
    });
    const dmRecap = await ask<Recap>(dm, RECAP_QUERY_INTENT, {});
    expect(card(dmRecap.recap?.awards, "most-dealt")).toMatchObject({ value: 80 });

    const answers = async (c: TestClient) => {
      const session = await ask<Session>(c, STATS_QUERY_INTENT, { scope: "session" });
      const fight = await ask<Fight>(c, STATS_QUERY_INTENT, { scope: "fight" });
      const crypt = fight.fights.find((f) => f.key !== fight.fight.key) as { key: string };
      const past = await ask<Fight>(c, STATS_QUERY_INTENT, {
        scope: "fight",
        encounterId: crypt.key,
      });
      const recap = await ask<Recap>(c, RECAP_QUERY_INTENT, {});
      return { session, fight, past, recap };
    };
    const playerAnswers = async (clients: TestClient[]) => {
      const out = [];
      for (const c of clients) {
        const a = await answers(c);
        // Session cards and recap Awards: no Most damage dealt; BL-121 (sprint 12): nor any other
        // card party damage could change (Biggest hit, Biggest overkill, Most kills).
        const kept = ["most-taken", "most-healing", "most-nat20", "most-nat1", "most-downed"];
        expect(a.session.session?.awards.map((x): string => x.key)).toEqual(kept);
        expect(card(a.session.session?.awards, "biggest-hit")).toBeUndefined();
        expect(a.recap.recap?.awards?.map((x): string => x.key)).toEqual(kept);
        // The Ambush holds hidden party damage: no MVP; the Old Crypt doesn't: Thorn's 43 stays.
        expect(a.fight.fight.highlights.mvp).toEqual({ value: null, winners: [] });
        expect(a.past.fight.highlights.mvp).toMatchObject({
          value: 43,
          winners: [{ name: "Thorn" }],
        });
        for (const f of a.recap.recap?.fights ?? []) {
          expect(f.mvp.value).toBe(f.key === crypt(a) ? 43 : null);
        }
        const json = JSON.stringify(a);
        for (const leak of ["Elite", '"value":80', '"value":85', "most-dealt"]) {
          expect(json).not.toContain(leak);
        }
        out.push(a);
      }
      return out;
    };
    const crypt = (a: Awaited<ReturnType<typeof answers>>) => a.past.fight.key;
    const before = await playerAnswers([p1, p2]);
    // Every player gets the same numbers (FR-STATS-03).
    expect(before[0]).toEqual(before[1]);
    // The hidden line itself never reached a player.
    for (const [i, c] of [p1, p2].entries()) {
      await barrier(c);
      const since = c.raw().slice(marks[i]);
      for (const leak of ["Elite", elite.id, '"amount":80', '"raw":80']) {
        expect(since).not.toContain(leak);
      }
    }
    for (const c of [dm, p1, p2]) c.close();

    const again = async () => {
      const clients = [await h.live(p("Player 1")), await h.live(p("Player 2"))];
      const out = await playerAnswers(clients);
      for (const c of clients) {
        expect(c.raw()).not.toContain(elite.id);
        c.close();
      }
      return out;
    };
    expect(await again()).toEqual(before);
    await h.restart();
    expect(await again()).toEqual(before);
  }, 60_000);
});
