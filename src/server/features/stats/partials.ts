// Session partials (FR-STATS-46, ADR-0062): per (campaign, viewer class, features) one tally of
// luck and trophies per closed session, in server memory, never persisted. A memo derived only
// from facts: built at server start (and after a drop-all) in yielding 5-session chunks; the
// newest session is always recomputed. A commit touching an entry / fact drops its session's
// partials; a combatant's owner / kind change or a feature switch drops all. Unsure → drop all.
// Sprint 10 T3 (FR-STATS-81–84): a partial also keeps the session's award winners, its fights and
// its monster kills, for the Campaign tab.
import { COMBATANT_TYPE, HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { type AwardWins, addWins, mergeWins } from "@shared/stats/campaign";
import {
  isKill,
  type SessionBounds,
  type StatsCharacter,
  sessionAwards,
  sessionOf,
  type UnseenKind,
} from "@shared/stats/rules";
import {
  addLuck,
  addTrophies,
  type LuckTally,
  mergeLuck,
  mergeTrophies,
  type TrophyTally,
} from "@shared/stats/rules-b";
import { eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { gameLogEntry } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { type CombatFact, combatFacts } from "../combat-tracker/stats-read";
import { hiddenPartyRolls, luckRolls, rolledUnseen, type StatsRead, seenFacts } from "./compute";

type Read = Pick<Tx, "select" | "all">;

/** One closed session's tallies for one viewer class. */
export interface SessionPartial {
  luck: Map<string, LuckTally>;
  trophies: Map<string, TrophyTally>;
  /** The session's awards (FR-STATS-12) won per character (FR-STATS-84). */
  wins: AwardWins;
  /** Encounters with a counted fact the viewer sees (FR-STATS-81's fights). */
  fights: Set<string>;
  /** Monster kills the viewer sees, whoever the attacker (FR-STATS-81's monsters slain). */
  slain: number;
  /**
   * BL-121: the kinds of party line or roll in the session the viewer doesn't see (players; the
   * DM's is empty). The campaign's union withholds records (FR-STATS-83, Trophies).
   */
  unseen: Set<UnseenKind>;
}

const emptyPartial = (): SessionPartial => ({
  luck: new Map(),
  trophies: new Map(),
  wins: new Map(),
  fights: new Set(),
  slain: 0,
  unseen: new Set(),
});

/** Sessions per chunk (≈ 40 ms at 100 sessions, ADR-0062). */
export const CHUNK_SESSIONS = 5;
/** More unbuilt sessions than this → `{pending: true}` (FR-STATS-46). */
export const UNCACHED_MAX = 5;

/** The memo key of a viewer: role + enabled features (every player shares one). */
export const classKeyOf = (r: StatsRead) => `${r.viewer.role}|${r.viewer.features.join(",")}`;

/**
 * The partials of `sessions` (ascending) from one `n`-range read: the viewer's counted facts and
 * rolls, filtered first (filter, then aggregate). Every session gets a partial, empty ones too.
 */
export function computePartials(
  r: StatsRead,
  sessions: readonly SessionBounds[],
  characters: ReadonlyMap<string, StatsCharacter>,
): Map<number, SessionPartial> {
  const out = new Map<number, SessionPartial>();
  const first = sessions[0];
  const last = sessions.at(-1);
  if (!first || !last) return out;
  for (const s of sessions) out.set(s.fromN, emptyPartial());
  // Every counted fact, grouped by session, then filtered per session (BL-111 reads the unseen).
  const allBy = new Map<number, CombatFact[]>();
  for (const f of combatFacts(r.db, {
    campaignId: r.campaignId,
    fromN: first.fromN,
    toN: last.toN,
  })) {
    const s = sessionOf(sessions, f.n);
    if (!s) continue;
    const xs = allBy.get(s.fromN) ?? [];
    xs.push(f);
    allBy.set(s.fromN, xs);
  }
  const factsBy = new Map<number, { facts: CombatFact[]; unseen: Set<UnseenKind> }>();
  for (const [fromN, all] of allBy) factsBy.set(fromN, seenFacts(r.viewer, all, characters));
  const rolls = luckRolls(r, first.fromN, last.toN);
  const rollsBy = new Map<number, typeof rolls>();
  for (const x of rolls) {
    const s = sessionOf(sessions, x.n);
    if (!s) continue;
    const xs = rollsBy.get(s.fromN) ?? [];
    xs.push(x);
    rollsBy.set(s.fromN, xs);
  }
  // BL-121: players: the sessions holding a party roll the DM counts and they don't see.
  const rolledIn = new Set<number>();
  if (r.viewer.role !== "dm") {
    for (const x of hiddenPartyRolls(r, characters, first.fromN, last.toN)) {
      const s = sessionOf(sessions, x.n);
      if (s && !rolledIn.has(s.fromN) && rolledUnseen([x], rollsBy.get(s.fromN) ?? [])) {
        rolledIn.add(s.fromN);
      }
    }
  }
  for (const [fromN, p] of out) {
    const seen = factsBy.get(fromN);
    const sf = seen?.facts ?? [];
    const sr = rollsBy.get(fromN) ?? [];
    for (const k of seen?.unseen ?? []) p.unseen.add(k);
    if (rolledIn.has(fromN)) p.unseen.add("rolled");
    addTrophies(p.trophies, sf, characters, r.viewer.role);
    addLuck(p.luck, sr, characters, r.viewer.role);
    for (const f of sf) {
      p.fights.add(f.encounterId);
      if (isKill(f)) p.slain += 1;
    }
    // FR-STATS-84: the Session tab's awards for this session (winners only: no labels needed).
    if (sf.length > 0 || sr.length > 0) {
      addWins(
        p.wins,
        sessionAwards({
          role: r.viewer.role,
          facts: sf,
          rolls: sr,
          characters,
          fightLabel: () => "",
          // BL-111 / BL-121: an award players' cards leave out isn't counted as won either
          // (FR-STATS-84).
          unseen: p.unseen,
        }),
      );
    }
  }
  return out;
}

/** Contiguous runs of sessions (one range read each). */
function runsOf(all: readonly SessionBounds[], pick: readonly SessionBounds[]): SessionBounds[][] {
  const want = new Set(pick);
  const runs: SessionBounds[][] = [];
  let run: SessionBounds[] = [];
  for (const s of all) {
    if (want.has(s)) run.push(s);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

const yieldTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface CampaignMemo {
  /** classKey → session `fromN` → partial. */
  byClass: Map<string, Map<number, SessionPartial>>;
  /** Bumped by a drop-all: a running build of an older generation starts over. */
  generation: number;
}

export type CampaignTallies = { pending: true } | ({ pending?: undefined } & SessionPartial);

export interface BuildEnv {
  db: Read;
  sessions(campaignId: string): SessionBounds[];
  /** The viewers to build for (both roles, current features). */
  reads(campaignId: string): StatsRead[];
  characters(campaignId: string): ReadonlyMap<string, StatsCharacter>;
  /** Called after a drop-all (the owner schedules a rebuild). */
  onDropAll?(campaignId: string): void;
  /**
   * A background build failed (e.g. the server stopped and closed its DB mid-build): the build
   * stops; built partials stay, the rest is read on demand or rebuilt after the next drop-all.
   */
  onError?(err: unknown): void;
}

export class Partials {
  private campaigns = new Map<string, CampaignMemo>();
  private running = new Map<string, Promise<void>>();
  /** Longest synchronous block of the builds so far, ms (the bench gate, FR-STATS-51). */
  longestBlockMs = 0;
  /** Computed partials (tests). */
  computed = 0;

  constructor(private env: BuildEnv) {}

  private memo(campaignId: string): CampaignMemo {
    let m = this.campaigns.get(campaignId);
    if (!m) {
      m = { byClass: new Map(), generation: 0 };
      this.campaigns.set(campaignId, m);
    }
    return m;
  }

  private store(campaignId: string, classKey: string, parts: Map<number, SessionPartial>) {
    const m = this.memo(campaignId);
    let c = m.byClass.get(classKey);
    if (!c) {
      c = new Map();
      m.byClass.set(classKey, c);
    }
    for (const [k, p] of parts) c.set(k, p);
    this.computed += parts.size;
  }

  /** Built partials of a class (tests). */
  built(campaignId: string, classKey: string): number {
    return this.campaigns.get(campaignId)?.byClass.get(classKey)?.size ?? 0;
  }

  isBuilding(campaignId: string): boolean {
    return this.running.has(campaignId);
  }

  /**
   * The cold build (ADR-0062 §3): every unbuilt closed session of each viewer class in chunks of
   * 5, one `n`-range read each, yielding to the event loop between chunks so hub frames
   * interleave. One build per campaign at a time (a second call joins it); a drop-all meanwhile
   * makes it start over.
   */
  build(campaignId: string): Promise<void> {
    const running = this.running.get(campaignId);
    if (running) return running;
    const p = this.run(campaignId)
      .catch((err) => this.env.onError?.(err))
      .finally(() => this.running.delete(campaignId));
    this.running.set(campaignId, p);
    return p;
  }

  private async run(campaignId: string): Promise<void> {
    const m = this.memo(campaignId);
    restart: for (;;) {
      const generation = m.generation;
      for (const r of this.env.reads(campaignId)) {
        const key = classKeyOf(r);
        for (;;) {
          if (m.generation !== generation) continue restart;
          const t0 = performance.now();
          const sessions = this.env.sessions(campaignId);
          const have = m.byClass.get(key);
          const todo = sessions.slice(0, -1).filter((s) => !have?.has(s.fromN));
          if (todo.length === 0) break;
          const chunk = todo.slice(0, CHUNK_SESSIONS);
          const characters = this.env.characters(campaignId);
          for (const run of runsOf(sessions, chunk)) {
            this.store(campaignId, key, computePartials(r, run, characters));
          }
          this.longestBlockMs = Math.max(this.longestBlockMs, performance.now() - t0);
          await yieldTick();
        }
      }
      return;
    }
  }

  /**
   * FR-STATS-46: the campaign's tallies for one viewer: built partials + the unbuilt closed
   * sessions read now when ≤ 5 (then kept), else `{pending: true}` (and a build is started); the
   * newest session is always recomputed.
   */
  campaign(r: StatsRead, characters: ReadonlyMap<string, StatsCharacter>): CampaignTallies {
    const sessions = this.env.sessions(r.campaignId);
    const key = classKeyOf(r);
    const m = this.memo(r.campaignId);
    const closed = sessions.slice(0, -1);
    const have = m.byClass.get(key);
    const missing = closed.filter((s) => !have?.has(s.fromN));
    if (missing.length > UNCACHED_MAX) {
      // Started after this answer (not inside the query's frame).
      if (!this.running.has(r.campaignId)) setTimeout(() => void this.build(r.campaignId), 0);
      return { pending: true };
    }
    for (const run of runsOf(sessions, missing)) {
      this.store(r.campaignId, key, computePartials(r, run, characters));
    }
    const all = emptyPartial();
    const merge = (p: SessionPartial) => {
      mergeLuck(all.luck, p.luck);
      mergeTrophies(all.trophies, p.trophies);
      mergeWins(all.wins, p.wins);
      for (const e of p.fights) all.fights.add(e);
      all.slain += p.slain;
      for (const k of p.unseen) all.unseen.add(k);
    };
    const parts = m.byClass.get(key);
    for (const s of closed) {
      const p = parts?.get(s.fromN);
      if (p) merge(p);
    }
    const newest = sessions.at(-1);
    if (newest) {
      const p = computePartials(r, [newest], characters).get(newest.fromN);
      if (p) merge(p);
    }
    return all;
  }

  /** Drops every partial of the campaign; a running build stops; the owner rebuilds. */
  dropAll(campaignId: string): void {
    const m = this.campaigns.get(campaignId);
    if (!m) return;
    m.byClass.clear();
    m.generation += 1;
    this.env.onDropAll?.(campaignId);
  }

  /** Drops the partials of the sessions holding `ns` (every viewer class). */
  dropSessions(campaignId: string, ns: Iterable<number>): void {
    const m = this.campaigns.get(campaignId);
    if (!m || m.byClass.size === 0) return;
    const sessions = this.env.sessions(campaignId);
    for (const n of ns) {
      const s = sessionOf(sessions, n);
      if (!s) continue;
      for (const c of m.byClass.values()) c.delete(s.fromN);
    }
  }

  /**
   * ADR-0062 §2, from the fact-version listener: entries / facts touched → their sessions'
   * partials; a combatant's owner or kind change, or the campaign's features → all.
   */
  invalidate(campaignId: string, changes: readonly RecordChange[]): void {
    const m = this.campaigns.get(campaignId);
    if (!m || (m.byClass.size === 0 && !this.running.has(campaignId))) return;
    const ns: number[] = [];
    const entryIds: string[] = [];
    for (const c of changes) {
      const before = c.before as Record<string, unknown> | null;
      const after = c.after as Record<string, unknown> | null;
      if (c.type === GAME_LOG_ENTRY_TYPE) {
        const n = (after ?? before)?.n;
        if (typeof n === "number") ns.push(n);
      } else if (c.type === HP_CHANGE_TYPE) {
        const id = (after ?? before)?.entryId;
        if (typeof id === "string") entryIds.push(id);
      } else if (c.type === COMBATANT_TYPE) {
        if (
          before &&
          after &&
          (before.kind !== after.kind ||
            (before.ownerCharacterId ?? null) !== (after.ownerCharacterId ?? null))
        ) {
          this.dropAll(campaignId);
          return;
        }
      } else if (c.type === ENTITY_TYPE || c.type === TOKEN_TYPE) {
        // An owned creature's rolls count nowhere (gate pick 6): a pet's or token's owner change.
        const field = c.type === ENTITY_TYPE ? "companionOf" : "ownerPlayerId";
        if (before && after && (before[field] ?? null) !== (after[field] ?? null)) {
          this.dropAll(campaignId);
          return;
        }
      } else if (c.type === "campaign") {
        const f = (x: Record<string, unknown> | null) => JSON.stringify(x?.features ?? []);
        if (before && after && f(before) !== f(after)) {
          this.dropAll(campaignId);
          return;
        }
      }
    }
    for (const id of entryIds) {
      const n = this.env.db
        .select({ n: gameLogEntry.n })
        .from(gameLogEntry)
        .where(eq(gameLogEntry.id, id))
        .get()?.n;
      if (n === undefined) {
        this.dropAll(campaignId);
        return;
      }
      ns.push(n);
    }
    this.dropSessions(campaignId, ns);
  }
}
