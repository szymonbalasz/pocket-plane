// STATS §12 bench gates (run alone via `bun run bench`): 100 synthetic sessions of history (4 fights
// × 80 applies + 300 rolls + 300 other lines each, ≈ 92k log entries, 32k `hp_change`), written
// straight into the tables. Gates: one fight ≤ 20 ms (DM and player), one session ≤ 50 ms, the
// session list cold (a fresh boundary cache) ≤ 300 ms and warm (cache + memo) ≤ 5 ms. Sprint 8
// (FR-STATS-51): fight + Highlights ≤ 20 ms; luck, one session ≤ 50 ms; campaign warm (built
// partials, newest session recomputed, memo stale) ≤ 50 ms; the chunked build's longest block
// ≤ 50 ms. Sprint 10 T3 (FR-STATS-87): the Campaign tab's answer warm (built partials, newest
// session recomputed, memo stale) ≤ 50 ms, DM and player.
import { beforeAll, describe, expect, test } from "bun:test";
import { best, GATE_TIMEOUT, logResults } from "@shared/bench-kit";
import type { Actor } from "../../events/types";
import { SessionCache } from "./cache";
import {
  campaignStats,
  fightStats,
  luckStats,
  type StatsRead,
  sessionStats,
  sessionsStats,
  trophiesStats,
} from "./compute";
import { statsMemory } from "./index";
import { history, BENCH_SESSIONS as SESSIONS, type StatsSetup, statsSetup } from "./testing";

const GATES = {
  fight: 20,
  session: 50,
  listCold: 300,
  listWarm: 5,
  luckSession: 50,
  campaignWarm: 50,
  buildBlock: 50,
};

describe("STATS §12 bench gates (100 sessions)", () => {
  let t: StatsSetup;
  let dm: StatsRead;
  let player: StatsRead;
  let size: { entries: number; hp: number };
  beforeAll(() => {
    t = statsSetup();
    size = history(t);
    dm = { db: t.s.db, viewer: { role: "dm", features: [] }, campaignId: t.h.campaignId };
    player = { db: t.s.db, viewer: { role: "player", features: [] }, campaignId: t.h.campaignId };
  }, 120_000);

  test(
    "STATS §12 fight ≤ 20 ms, session ≤ 50 ms, list cold ≤ 300 / warm ≤ 5 ms",
    async () => {
      const cache = new SessionCache();
      const coldStart = performance.now();
      const sessions = sessionsStats(dm, cache.sessions(dm.db, dm.campaignId)).sessions;
      const coldMs = performance.now() - coldStart;
      expect(sessions.length).toBeGreaterThanOrEqual(SESSIONS);
      const mid = sessions[50]?.fromN as number;
      const fightDm = await best(() => fightStats(dm, "b-enc-99-3"), GATES.fight);
      const fightPlayer = await best(() => fightStats(player, "b-enc-99-3"), GATES.fight);
      const session = await best(
        () => sessionStats(dm, cache.sessions(dm.db, dm.campaignId), mid),
        GATES.session,
      );
      // Warm = the start-up-warmed boundary cache plus the gate's memo (FR-STATS-14, -16).
      const actor: Actor = t.h.dm;
      t.query({ scope: "sessions" }, actor);
      const warm = await best(() => t.query({ scope: "sessions" }, actor), GATES.listWarm);
      const recompute = await best(
        () => sessionsStats(dm, cache.sessions(dm.db, dm.campaignId)),
        GATES.listCold,
      );
      logResults("STATS §12 (100 sessions)", {
        entries: size.entries,
        hpChanges: size.hp,
        "fight DM ms": fightDm,
        "fight player ms": fightPlayer,
        "session ms": session,
        "list cold ms": coldMs,
        "list warm ms": warm,
        "list recompute (cache warm, memo stale) ms": recompute,
      });
      expect(fightDm).toBeLessThanOrEqual(GATES.fight);
      expect(fightPlayer).toBeLessThanOrEqual(GATES.fight);
      expect(session).toBeLessThanOrEqual(GATES.session);
      expect(coldMs).toBeLessThanOrEqual(GATES.listCold);
      expect(warm).toBeLessThanOrEqual(GATES.listWarm);
    },
    GATE_TIMEOUT * 2,
  );

  test(
    "FR-STATS-51 fight + highlights ≤ 20 ms; luck one session ≤ 50 ms; campaign warm ≤ 50 ms; build block ≤ 50 ms",
    async () => {
      const cache = new SessionCache();
      const sessions = cache.sessions(dm.db, dm.campaignId);
      const mid = sessions[50]?.fromN as number;
      // The fight ack carries Highlights (FR-STATS-31): the fight gate covers both.
      const highlights = fightStats(dm, "b-enc-99-3").fight?.highlights;
      expect(highlights?.mvp.value).toBeGreaterThan(0);
      const fightDm = await best(() => fightStats(dm, "b-enc-99-3"), GATES.fight);
      const fightPlayer = await best(() => fightStats(player, "b-enc-99-3"), GATES.fight);
      const { partials } = statsMemory(t.s);
      const luckSession = await best(
        () => luckStats(dm, sessions, partials, { n: mid }),
        GATES.luckSession,
      );
      // The cold build: chunks of 5 sessions, both viewer classes, yielding between chunks, after
      // the start-up session warm (as `onStart`). Best of 3 builds (a GC pause is load, not cost).
      statsMemory(t.s).cache.sessions(t.s.db, t.h.campaignId);
      let block = Number.POSITIVE_INFINITY;
      let buildMs = 0;
      for (let i = 0; i < 3 && block > GATES.buildBlock; i++) {
        partials.dropAll(t.h.campaignId);
        partials.longestBlockMs = 0;
        const buildStart = performance.now();
        await partials.build(t.h.campaignId);
        buildMs = performance.now() - buildStart;
        block = Math.min(block, partials.longestBlockMs);
      }
      expect(luckStats(dm, sessions, partials, { campaign: true }).luck.pending).toBeUndefined();
      const warmDm = await best(
        () => luckStats(dm, sessions, partials, { campaign: true }),
        GATES.campaignWarm,
      );
      const warmPlayer = await best(
        () => luckStats(player, sessions, partials, { campaign: true }),
        GATES.campaignWarm,
      );
      const trophiesDm = await best(
        () => trophiesStats(dm, partials, t.miraId, null),
        GATES.campaignWarm,
      );
      logResults("STATS §12 sprint 8 (100 sessions)", {
        "fight + highlights DM ms": fightDm,
        "fight + highlights player ms": fightPlayer,
        "luck one session ms": luckSession,
        "chunked build total ms": buildMs,
        "chunked build longest block ms": block,
        "campaign luck warm DM ms": warmDm,
        "campaign luck warm player ms": warmPlayer,
        "campaign trophies warm DM ms": trophiesDm,
      });
      expect(fightDm).toBeLessThanOrEqual(GATES.fight);
      expect(fightPlayer).toBeLessThanOrEqual(GATES.fight);
      expect(luckSession).toBeLessThanOrEqual(GATES.luckSession);
      expect(block).toBeLessThanOrEqual(GATES.buildBlock);
      expect(warmDm).toBeLessThanOrEqual(GATES.campaignWarm);
      expect(warmPlayer).toBeLessThanOrEqual(GATES.campaignWarm);
      expect(trophiesDm).toBeLessThanOrEqual(GATES.campaignWarm);
    },
    GATE_TIMEOUT * 2,
  );

  test(
    "FR-STATS-87 campaign tab warm ≤ 50 ms (DM and player)",
    async () => {
      const { partials, cache } = statsMemory(t.s);
      await partials.build(t.h.campaignId);
      const sessions = cache.sessions(t.s.db, t.h.campaignId);
      const answer = campaignStats(dm, sessions, partials).campaign;
      expect("pending" in answer).toBe(false);
      const warmDm = await best(() => campaignStats(dm, sessions, partials), GATES.campaignWarm);
      const warmPlayer = await best(
        () => campaignStats(player, sessions, partials),
        GATES.campaignWarm,
      );
      const ackBytes = JSON.stringify(campaignStats(dm, sessions, partials)).length;
      logResults("STATS §12 sprint 10 T3 (100 sessions)", {
        "campaign tab warm DM ms": warmDm,
        "campaign tab warm player ms": warmPlayer,
        "campaign ack DM bytes": ackBytes,
      });
      expect(warmDm).toBeLessThanOrEqual(GATES.campaignWarm);
      expect(warmPlayer).toBeLessThanOrEqual(GATES.campaignWarm);
    },
    GATE_TIMEOUT * 2,
  );
});
