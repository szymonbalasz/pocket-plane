// Stats read helper (FR-CBT-138, ADR-0059): read-only views of the combat facts for stats. Facts
// contract: `hp_change` rows, combatants and started / ended encounters are never deleted; rows
// change only by the undo marker; `raw`, `applied`, `overkill`, `hpBefore`, `hpAfter`, the temp
// fields and `entryId` keep their meaning (FR-CBT-22, FR-CBTX-15). Stats never write combat rows.
import type { StatsFact, StatsSide } from "@shared/stats/rules";
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { combatant, encounter, entity, gameLogEntry, hpChange, token } from "../../db/schema";

type Read = Pick<Tx, "select">;

/** A counted fact with its line's visibility facts (the stats viewer filter reads them). */
export interface CombatFact extends StatsFact {
  id: string;
  at: string;
  entryId: string;
  /** The line's `public` (stamped once, FR-DICE-13). */
  public: boolean;
  /** The line's kind (`cbt.attack` / `cbt.hp`), for the feature rule (FR-DICE-69). */
  entryKind: string;
  encounterName: string;
}

/**
 * One encounter, or a campaign's log range `fromN…toN` (inclusive) by the fact's line: a row's `at`
 * may be a millisecond after its line's, so sessions bound facts by `n`, never by time.
 */
export type FactsScope =
  | { encounterId: string }
  | { campaignId: string; fromN: number; toN: number };

const SIDE = {
  id: combatant.id,
  name: combatant.name,
  kind: combatant.kind,
  entityId: combatant.entityId,
  ownerCharacterId: combatant.ownerCharacterId,
  hidden: combatant.hidden,
  ownerHidden: combatant.ownerHidden,
  active: combatant.active,
  encounterId: combatant.encounterId,
};

/** Chunked `inArray` (SQLite's variable limit). */
function chunks<T>(xs: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function sidesById(db: Read, ids: readonly string[]): Map<string, StatsSide> {
  const out = new Map<string, StatsSide>();
  for (const part of chunks([...new Set(ids)])) {
    for (const r of db.select(SIDE).from(combatant).where(inArray(combatant.id, part)).all()) {
      out.set(r.id, r);
    }
  }
  return out;
}

function encounterNames(db: Read, ids: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of chunks([...new Set(ids)])) {
    const rows = db
      .select({ id: encounter.id, name: encounter.name })
      .from(encounter)
      .where(inArray(encounter.id, part))
      .all();
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}

/** The encounters named by a campaign's log lines in `fromN…toN` (every outcome line names its). */
function rangeEncounters(
  db: Read,
  scope: { campaignId: string; fromN: number; toN: number },
): string[] {
  const rows = db
    .select({ id: gameLogEntry.encounterId })
    .from(gameLogEntry)
    .where(
      and(
        eq(gameLogEntry.campaignId, scope.campaignId),
        gte(gameLogEntry.n, scope.fromN),
        lte(gameLogEntry.n, scope.toN),
      ),
    )
    .all();
  return [...new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))];
}

/**
 * FR-CBT-138: the non-undone `hp_change` rows of one encounter, or of a campaign whose lines are
 * in an `n` range, in log order, joined with their line's `public` / `n` / kind, the
 * attacker's and target's current kind, owner and hidden flags, and the encounter name.
 */
export function combatFacts(db: Read, scope: FactsScope): CombatFact[] {
  // A range reads the encounters its lines name (on the `(campaign_id, n)` index), then their
  // facts on `hp_change_encounter`: `hp_change` has no campaign / entry index, so a campaign-wide
  // filter would scan every fact (FR-STATS-46's chunks, FR-STATS-51).
  const where =
    "encounterId" in scope
      ? eq(hpChange.encounterId, scope.encounterId)
      : and(
          inArray(hpChange.encounterId, rangeEncounters(db, scope)),
          gte(gameLogEntry.n, scope.fromN),
          lte(gameLogEntry.n, scope.toN),
        );
  const rows = db
    .select({
      id: hpChange.id,
      encounterId: hpChange.encounterId,
      at: hpChange.at,
      kind: hpChange.kind,
      attackerId: hpChange.attackerId,
      attackerName: hpChange.attackerName,
      targetId: hpChange.targetId,
      targetName: hpChange.targetName,
      raw: hpChange.raw,
      applied: hpChange.applied,
      overkill: hpChange.overkill,
      hpBefore: hpChange.hpBefore,
      hpAfter: hpChange.hpAfter,
      tempBefore: hpChange.tempBefore,
      tempAfter: hpChange.tempAfter,
      entryId: hpChange.entryId,
      n: gameLogEntry.n,
      public: gameLogEntry.public,
      entryKind: gameLogEntry.kind,
    })
    .from(hpChange)
    .innerJoin(gameLogEntry, eq(gameLogEntry.id, hpChange.entryId))
    .where(and(where, eq(hpChange.undone, false)))
    .orderBy(asc(gameLogEntry.n))
    .all();
  const sides = sidesById(
    db,
    rows.flatMap((r) => (r.attackerId ? [r.attackerId, r.targetId] : [r.targetId])),
  );
  const names = encounterNames(
    db,
    rows.map((r) => r.encounterId),
  );
  return rows.flatMap((r): CombatFact[] => {
    const target = sides.get(r.targetId);
    if (!target) return [];
    const { tempBefore, tempAfter, attackerId, targetId: _t, ...rest } = r;
    return [
      {
        ...rest,
        absorbed: r.kind === "damage" ? Math.max(0, tempBefore - tempAfter) : 0,
        attacker: attackerId ? (sides.get(attackerId) ?? null) : null,
        target,
        encounterName: names.get(r.encounterId) ?? "",
      },
    ];
  });
}

/** Every combatant of an encounter (removed and dismissed ones too), as stats sides. */
export function fightCombatants(db: Read, encounterId: string): StatsSide[] {
  return db
    .select(SIDE)
    .from(combatant)
    .where(eq(combatant.encounterId, encounterId))
    .orderBy(asc(combatant.seq))
    .all();
}

export interface FightRow {
  id: string;
  name: string;
  status: "started" | "ended";
  round: number;
  startedAt: string;
  /** Null while started. */
  endedAt: string | null;
}

/** The campaign's started and ended encounters, oldest `startedAt` first (planned never count). */
export function fightsOf(db: Read, campaignId: string): FightRow[] {
  return db
    .select({
      id: encounter.id,
      name: encounter.name,
      status: encounter.status,
      round: encounter.round,
      startedAt: encounter.startedAt,
      endedAt: encounter.endedAt,
    })
    .from(encounter)
    .where(and(eq(encounter.campaignId, campaignId), ne(encounter.status, "planned")))
    .orderBy(asc(encounter.startedAt), asc(encounter.seq))
    .all()
    .flatMap((r) =>
      r.status === "planned" ? [] : [{ ...r, status: r.status, startedAt: r.startedAt ?? "" }],
    );
}

/**
 * The encounters of a campaign with at least one counted public fact (a non-undone `hp_change`
 * whose line is public): the fights a player lists (OQ-STATS-19 A). On `hp_change_encounter`.
 */
export function publicFactEncounters(db: Read, campaignId: string): Set<string> {
  const rows = db
    .select({ id: encounter.id })
    .from(encounter)
    .where(
      and(
        eq(encounter.campaignId, campaignId),
        ne(encounter.status, "planned"),
        sql`exists (select 1 from ${hpChange} join ${gameLogEntry} on ${gameLogEntry.id} = ${hpChange.entryId} where ${hpChange.encounterId} = ${encounter.id} and ${hpChange.undone} = 0 and ${gameLogEntry.public} = 1)`,
      ),
    )
    .all();
  return new Set(rows.map((r) => r.id));
}

export interface FactRef {
  encounterId: string;
  /** The line's `n` (sessions are `n` ranges, FR-STATS-13). */
  n: number;
  public: boolean;
  entryKind: string;
}

/**
 * Every counted (non-undone) fact of a campaign, reduced to its encounter and line: the session
 * list's per-session fight counts (FR-STATS-13, -15) without loading the facts themselves.
 */
export function factRefs(db: Read, campaignId: string): FactRef[] {
  return db
    .select({
      encounterId: hpChange.encounterId,
      n: gameLogEntry.n,
      public: gameLogEntry.public,
      entryKind: gameLogEntry.kind,
    })
    .from(hpChange)
    .innerJoin(gameLogEntry, eq(gameLogEntry.id, hpChange.entryId))
    .where(and(eq(hpChange.campaignId, campaignId), eq(hpChange.undone, false)))
    .all();
}

/**
 * FR-CBT-153 / FR-STATS-33: one indexed existence query on `hp_change_encounter` at End: does the
 * encounter have a counted (non-undone) fact, and one whose line is public?
 */
export function fightFactPresence(
  db: Read,
  encounterId: string,
): { counted: boolean; public: boolean } {
  const row = db
    .select({
      // Raw names: inside select fields drizzle drops the table prefix (ambiguous columns).
      counted: sql<number>`exists (select 1 from hp_change h where h.encounter_id = ${encounterId} and h.undone = 0)`,
      public: sql<number>`exists (select 1 from hp_change h join game_log_entry e on e.id = h.entry_id where h.encounter_id = ${encounterId} and h.undone = 0 and e.public = 1)`,
    })
    .from(encounter)
    .where(eq(encounter.id, encounterId))
    .get();
  return { counted: Boolean(row?.counted), public: Boolean(row?.public) };
}

/**
 * FR-STATS-32: the actors a fight's rolls are attributed by: its combatants' entities (a PC's
 * character, a monster's definition) and tokens.
 */
export function fightActorIds(db: Read, encounterId: string): Set<string> {
  const rows = db
    .select({ entityId: combatant.entityId, tokenId: combatant.tokenId })
    .from(combatant)
    .where(eq(combatant.encounterId, encounterId))
    .all();
  return new Set(rows.flatMap((r) => (r.tokenId ? [r.entityId, r.tokenId] : [r.entityId])));
}

export interface StandingRow {
  id: string;
  name: string;
  hidden: boolean;
}

/**
 * FR-STATS-31 (DM only): the fight's monsters still standing: not companions, not removed, HP
 * above 0 (unknown HP counts as standing), in initiative-list order.
 */
export function standingOf(db: Read, encounterId: string): StandingRow[] {
  return db
    .select({
      id: combatant.id,
      name: combatant.name,
      hidden: combatant.hidden,
      ownerCharacterId: combatant.ownerCharacterId,
      removed: combatant.removed,
      hpCurrent: combatant.hpCurrent,
    })
    .from(combatant)
    .where(and(eq(combatant.encounterId, encounterId), eq(combatant.kind, "monster")))
    .orderBy(asc(combatant.seq))
    .all()
    .filter((c) => c.ownerCharacterId === null && !c.removed && (c.hpCurrent ?? 1) > 0)
    .map((c) => ({ id: c.id, name: c.name, hidden: c.hidden }));
}

/** The campaign's owned creatures as roll actors (ADR-0056: a pet, summon or companion). */
export interface OwnedActors {
  /** Pet entities (`companionOf` set). */
  entities: Set<string>;
  /** Tokens with an owning player. */
  tokens: Set<string>;
  /** `${encounterId}|${entityId}|${name}` of combatants with an owner (combat rolls name them). */
  combatants: Set<string>;
  /**
   * `${entityId}|${name}` of owned combatants that no unowned combatant shares: a roll whose line
   * names no encounter (the DM's `dice.roll` as a combatant).
   */
  named: Set<string>;
}

export const ownedCombatantKey = (encounterId: string, entityId: string, name: string) =>
  `${encounterId}|${entityId}|${name}`;

/** Every owned creature of a campaign now (current owner, FR-STATS-09): three small reads. */
export function ownedActors(db: Read, campaignId: string): OwnedActors {
  const entities = db
    .select({ id: entity.id })
    .from(entity)
    .where(and(eq(entity.campaignId, campaignId), isNotNull(entity.companionOf)))
    .all();
  const tokens = db
    .select({ id: token.id })
    .from(token)
    .where(and(eq(token.campaignId, campaignId), isNotNull(token.ownerPlayerId)))
    .all();
  const all = db
    .select({
      e: combatant.encounterId,
      entityId: combatant.entityId,
      name: combatant.name,
      owner: combatant.ownerCharacterId,
    })
    .from(combatant)
    .where(eq(combatant.campaignId, campaignId))
    .all();
  const owned = all.filter((c) => c.owner !== null);
  const unowned = new Set(
    all.filter((c) => c.owner === null).map((c) => `${c.entityId}|${c.name}`),
  );
  return {
    entities: new Set(entities.map((r) => r.id)),
    tokens: new Set(tokens.map((r) => r.id)),
    combatants: new Set(owned.map((c) => ownedCombatantKey(c.e, c.entityId, c.name))),
    named: new Set(owned.map((c) => `${c.entityId}|${c.name}`).filter((k) => !unowned.has(k))),
  };
}
