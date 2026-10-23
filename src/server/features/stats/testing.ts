// Test support for stats: combat-tracker's ambush (Mira, Thorn; Goblin, Goblin 2 visible; Wolf,
// Elite hidden) started, with helpers to apply, roll and query as the DM or a player.
import {
  type DmFightResult,
  type DmLuckResult,
  type PlayerFightResult,
  type SessionResult,
  type SessionsResult,
  STATS_QUERY_INTENT,
  type StatsQueryInput,
  type TrophiesResult,
} from "@shared/stats/schemas";
import { fixedClock } from "../../commands/context";
import { combatant, encounter, gameLogEntry, hpChange, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { applyHp, undoCommand } from "../combat-tracker/hp";
import { startCommand } from "../combat-tracker/lifecycle";
import { combatSetup } from "../combat-tracker/testing";
import { ROLL } from "../dice-roll-log/commands";
import { statsMemory } from "./index";

export function statsSetup() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const clock = t.s.clock as typeof t.s.clock & { advance(ms: number): void };
  const hp = (
    target: string,
    kind: "damage" | "heal",
    amount: number,
    o: { from?: string; public?: boolean } = {},
  ) =>
    t.run<{ hpChangeId: string }>(applyHp.name, {
      combatantId: id(target),
      kind,
      amount,
      public: o.public ?? true,
      ...(o.from ? { sourceId: id(o.from) } : {}),
    }).hpChangeId;
  const undo = (hpChangeId: string) => t.run(undoCommand.name, { expectedHpChangeId: hpChangeId });
  /** A d20 roll with a known natural: as a player (their character) or the DM (`public`). */
  const roll = (
    who: "Mira" | "Thorn",
    natural: number,
    o: { actor?: Actor; public?: boolean; category?: string } = {},
  ) =>
    t.run<{ rollId: string; entryId: string }>(
      ROLL,
      {
        expression: "1d20+5",
        category: o.category ?? "attack",
        actor: { entityId: who === "Mira" ? t.miraId : t.thornId },
        manual: { diceTotal: natural },
        ...(o.public !== undefined ? { public: o.public } : {}),
      },
      o.actor ?? t.h.dm,
    );
  const query = <R>(input: StatsQueryInput, actor: Actor = t.h.dm) =>
    t.run<R>(STATS_QUERY_INTENT, input, actor);
  // Each query is its own second, so the per-actor rate (FR-STATS-16) never trips by accident.
  const fresh = <R>(input: StatsQueryInput, actor: Actor = t.h.dm) => {
    clock.advance(1000);
    return query<R>(input, actor);
  };
  const fight = (actor: Actor = t.h.dm, encounterId?: string) =>
    fresh<DmFightResult & PlayerFightResult>(
      { scope: "fight", ...(encounterId ? { encounterId } : {}) },
      actor,
    );
  const session = (actor: Actor = t.h.dm, n?: number) =>
    fresh<SessionResult>({ scope: "session", ...(n !== undefined ? { n } : {}) }, actor);
  const sessions = (actor: Actor = t.h.dm) => fresh<SessionsResult>({ scope: "sessions" }, actor);
  /** Sprint 8: luck of a session (`n` inside it; absent = the newest) or the campaign. */
  const luck = (actor: Actor = t.h.dm, o: { n?: number; campaign?: true } = {}) =>
    fresh<DmLuckResult>({ scope: "luck", ...o }, actor).luck;
  const trophies = (characterId: string, actor: Actor = t.h.dm) =>
    fresh<TrophiesResult>({ scope: "trophies", characterId }, actor).trophies;
  const memory = () => statsMemory(t.s);
  return {
    ...t,
    enc,
    id,
    clock,
    hp,
    undo,
    roll,
    query,
    fight,
    session,
    sessions,
    luck,
    trophies,
    memory,
  };
}

export type StatsSetup = ReturnType<typeof statsSetup>;

/** A fight row by name. */
export const rowOf = <R extends { name: string }>(rows: readonly R[], name: string) =>
  rows.find((r) => r.name === name);

/** An award by key. */
export const awardOf = <A extends { key: string }>(awards: readonly A[], key: string) =>
  awards.find((a) => a.key === key) as A;

// ---------- bench history (STATS §12, RECAP §12) ----------

/**
 * STATS §12 bench history (`stats.bench.ts`, RECAP's `recap.bench.ts`): 100 sessions of 4 fights
 * × 80 applies + 300 rolls + 300 other lines each (≈ 92k log entries, 32k `hp_change`).
 */
export const BENCH_SESSIONS = 100;
const FIGHTS = 4;
const APPLIES = 80;
const ROLLS = 300;
const OTHER = 300;

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
export function history(t: StatsSetup) {
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
  for (let s = 0; s < BENCH_SESSIONS; s++) {
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
