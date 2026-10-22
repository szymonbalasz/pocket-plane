// STATS §12 bench gates (run alone via `bun run bench`): 100 synthetic sessions of history (4 fights
// × 80 applies + 300 rolls + 300 other lines each, ≈ 92k log entries, 32k `hp_change`), written
// straight into the tables. Gates: one fight ≤ 20 ms (DM and player), one session ≤ 50 ms, the
// session list cold (a fresh boundary cache) ≤ 300 ms and warm (cache + memo) ≤ 5 ms. Sprint 8
// (FR-STATS-51): fight + Highlights ≤ 20 ms; luck, one session ≤ 50 ms; campaign warm (built
// partials, newest session recomputed, memo stale) ≤ 50 ms; the chunked build's longest block
// ≤ 50 ms.
import { beforeAll, describe, expect, test } from "bun:test";
import { best, GATE_TIMEOUT, logResults } from "@shared/bench-kit";
import { fixedClock } from "../../commands/context";
import { combatant, encounter, gameLogEntry, hpChange, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { SessionCache } from "./cache";
import {
  fightStats,
  luckStats,
  type StatsRead,
  sessionStats,
  sessionsStats,
  trophiesStats,
} from "./compute";
import { statsMemory } from "./index";
import { type StatsSetup, statsSetup } from "./testing";

const SESSIONS = 100;
const FIGHTS = 4;
const APPLIES = 80;
const ROLLS = 300;
const OTHER = 300;
const GATES = {
  fight: 20,
  session: 50,
  listCold: 300,
  listWarm: 5,
  luckSession: 50,
  campaignWarm: 50,
  buildBlock: 50,
};

type Rows<T extends { $inferInsert: unknown }> = T["$inferInsert"][];

/** Inserts in chunks (SQLite's variable limit). */
function insertAll<T extends Parameters<StatsSetup["s"]["db"]["insert"]>[0]>(
  t: StatsSetup,
  table: T,
  rows: object[],
) {
  for (let i = 0; i < rows.length; i += 200) {
    t.s.db
      .insert(table)
      .values(rows.slice(i, i + 200) as never)
      .run();
  }
}

/** ≈ 92k entries of synthetic history after the ambush the setup starts (its `n` continue). */
function history(t: StatsSetup) {
  const cid = t.h.campaignId;
  const t0 = fixedClock("2026-02-01T18:00:00Z").now();
  const iso = (ms: number) => fixedClock(ms).iso();
  let n = t.s.db.$client.query<{ n: number }, []>("SELECT max(n) AS n FROM game_log_entry").get()
    ?.n as number;
  let seq = 1_000_000;
  const encs: Rows<typeof encounter> = [];
  const cbs: Rows<typeof combatant> = [];
  const hps: Rows<typeof hpChange> = [];
  const entries: Rows<typeof gameLogEntry> = [];
  const rolls: Rows<typeof roll> = [];
  const pcs = [
    { id: t.miraId, name: "Mira" },
    { id: t.thornId, name: "Thorn" },
  ];
  for (let s = 0; s < SESSIONS; s++) {
    let ms = t0 + s * 24 * 3600_000;
    const at = () => {
      ms += 10_000;
      return iso(ms);
    };
    const line = (kind: string, pub: boolean, encounterId: string | null, rollIds: string[]) => {
      const id = `b-e-${++n}`;
      entries.push({
        id,
        campaignId: cid,
        n,
        at: at(),
        kind,
        category: kind === "roll" ? "attack" : "damage",
        public: pub,
        undone: false,
        rollerRole: "dm",
        rollerPlayerId: null,
        actorName: "DM",
        payload: {},
        dmPayload: null,
        rollIds,
        encounterId,
        audiencePlayerId: null,
        supersededBy: null,
      });
      return id;
    };
    for (let f = 0; f < FIGHTS; f++) {
      const encId = `b-enc-${s}-${f}`;
      const started = iso(ms);
      encs.push({
        id: encId,
        campaignId: cid,
        seq: ++seq,
        name: `Fight ${s}.${f}`,
        status: "ended",
        round: 3,
        startedAt: started,
        endedAt: started,
        createdAt: started,
        updatedAt: started,
      });
      const sides = [
        ...pcs.map((p, i) => ({
          id: `b-c-${s}-${f}-${i}`,
          kind: "pc" as const,
          entityId: p.id,
          name: p.name,
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `b-c-${s}-${f}-m${i}`,
          kind: "monster" as const,
          entityId: t.h.goblinId,
          name: `Goblin ${i + 1}`,
        })),
      ];
      for (const c of sides) {
        cbs.push({
          id: c.id,
          campaignId: cid,
          encounterId: encId,
          seq: ++seq,
          kind: c.kind,
          entityId: c.entityId,
          name: c.name,
          hidden: c.kind === "monster" && c.name === "Goblin 6",
          position: 1,
          hpCurrent: c.kind === "monster" ? 0 : null,
          hpMax: c.kind === "monster" ? 7 : null,
        });
      }
      for (let a = 0; a < APPLIES; a++) {
        const attacker = sides[a % sides.length] as (typeof sides)[number];
        const target = sides[(a * 7 + 3) % sides.length] as (typeof sides)[number];
        const raw = 1 + (a % 13);
        const hpBefore = a % 5 === 0 ? 7 : 20;
        const entryId = line(a % 9 === 0 ? "cbt.hp" : "cbt.attack", a % 4 !== 0, encId, []);
        hps.push({
          id: `b-h-${n}`,
          campaignId: cid,
          encounterId: encId,
          seq: ++seq,
          at: entries.at(-1)?.at as string,
          kind: a % 10 === 0 ? "heal" : "damage",
          source: "direct",
          rollIds: [],
          attackerId: attacker.id,
          attackerName: attacker.name,
          targetId: target.id,
          targetEntityId: target.entityId,
          targetName: target.name,
          targetAc: 12,
          damageTotal: raw,
          raw,
          applied: Math.min(raw, hpBefore),
          overkill: Math.max(0, raw - hpBefore),
          hpBefore,
          hpAfter: Math.max(0, hpBefore - raw),
          entryId,
          undone: a % 31 === 0,
        });
      }
    }
    for (let r = 0; r < ROLLS; r++) {
      const id = `b-r-${s}-${r}`;
      const pc = pcs[r % 2] as (typeof pcs)[number];
      rolls.push({
        id,
        campaignId: cid,
        at: at(),
        rollerRole: "dm",
        actorKind: "entity",
        actorId: pc.id,
        actorName: pc.name,
        category: "attack",
        source: "dice",
        expression: "1d20+5",
        mode: "normal",
        manual: false,
        dice: [{ faces: 20, value: (r % 20) + 1, kept: true }],
        constant: 5,
        total: (r % 20) + 6,
        natural: (r % 20) + 1,
      });
      line("roll", r % 3 !== 0, null, [id]);
    }
    for (let o = 0; o < OTHER; o++) line("roll", true, null, []);
  }
  insertAll(t, encounter, encs);
  insertAll(t, combatant, cbs);
  insertAll(t, gameLogEntry, entries);
  insertAll(t, hpChange, hps);
  insertAll(t, roll, rolls);
  return { entries: entries.length, hp: hps.length };
}

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
});
