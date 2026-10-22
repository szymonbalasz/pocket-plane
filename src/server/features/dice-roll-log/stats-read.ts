// Stats read helper (FR-DICE-72, -73, ADR-0059): read-only views of the log for stats. Rules on
// top of GM's supersede contract (FR-DICE-63 / -67): only a roll listed by an entry that is neither
// undone nor superseded counts, once; (a) players: the hub filter for a viewer with no `playerId`
// (public only: `audiencePlayerId` lines count for the DM only); (b) feature-tagged kinds are
// skipped while their feature is off; (c) `natural`, `category`, `rollIds`, `encounterId` and
// `public` keep their meaning (a change needs a stats review).
import { getLogKind } from "@shared/dice-roll-log/kinds";
import type { StatsRole, StatsRoll, TimelineEntry } from "@shared/stats/rules";
import { and, asc, desc, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { gameLogEntry, roll } from "../../db/schema";

type Read = Pick<Tx, "select" | "all">;

/** Who stats count for: the role and the campaign's enabled features (ADR-0058). */
export interface StatsViewer {
  role: StatsRole;
  features: readonly string[];
}

/** The kind's feature tag (FR-DICE-69), or null. */
export const featureOfKind = (kind: string): string | null => getLogKind(kind)?.feature ?? null;

/** The stats viewer filter on one entry (FR-DICE-72 (a), (b)); counting (undone / superseded) aside. */
export function entryVisible(v: StatsViewer, e: { public: boolean; kind: string }): boolean {
  const tag = featureOfKind(e.kind);
  if (tag !== null && !v.features.includes(tag)) return false;
  return v.role === "dm" || e.public;
}

/**
 * FR-DICE-73: `{n, at, public, feature}` ascending after `afterN`, on the unique
 * `(campaign_id, n)` index (sessions are derived from it, FR-STATS-13).
 */
export function logTimeline(db: Read, campaignId: string, afterN = 0): TimelineEntry[] {
  return db
    .select({
      n: gameLogEntry.n,
      at: gameLogEntry.at,
      public: gameLogEntry.public,
      kind: gameLogEntry.kind,
    })
    .from(gameLogEntry)
    .where(and(eq(gameLogEntry.campaignId, campaignId), gt(gameLogEntry.n, afterN)))
    .orderBy(asc(gameLogEntry.n))
    .all()
    .map((r) => ({ n: r.n, at: r.at, public: r.public, feature: featureOfKind(r.kind) }));
}

export interface RollFact extends StatsRoll {
  rollId: string;
  /** Some counted listing entry is public. */
  public: boolean;
  /** FR-DICE-89: the first counted listing entry's `n` (sessions are `n` ranges). */
  n: number;
  /** That entry's encounter (FR-STATS-32), or null. */
  encounterId: string | null;
  /** FR-DICE-89: physical dice. */
  manual: boolean;
  /** FR-DICE-89: every `faces: 20` die with a value, kept and dropped (FR-DICE-04). */
  d20: number[];
  /** The roll has a d20 die at all (a physical several-dice total has no values). */
  hasD20: boolean;
}

interface StoredDie {
  faces: number;
  value: number | null;
}

/**
 * FR-DICE-73 / -89: one row per counted roll listed by an entry in `fromN…toN` (absent: the whole
 * campaign in one pass), after the viewer filter (a roll a reroll replaced never: FR-DICE-67):
 * a roll in two entries returns once (`public` if any counted listing entry is public; `n` and
 * `encounterId` the first's); a roll no counted entry lists is absent.
 */
export function rollFacts(
  db: Read,
  viewer: StatsViewer,
  campaignId: string,
  fromN?: number,
  toN?: number,
): RollFact[] {
  const range =
    fromN !== undefined && toN !== undefined ? sql` AND e.n BETWEEN ${fromN} AND ${toN}` : sql``;
  // One pass on the `(campaign_id, n)` index: counted entries × their `rollIds` × the roll rows
  // (by primary key), in log order (FR-STATS-46's chunks, FR-STATS-51).
  const rows = db.all<{
    n: number;
    kind: string;
    public: number;
    encounterId: string | null;
    rollId: string;
    natural: number | null;
    category: string;
    actorKind: string;
    actorId: string | null;
    manual: number;
    dice: string;
    replaces: string | null;
  }>(sql`SELECT e.n AS n, e.kind AS kind, e.public AS public, e.encounter_id AS encounterId,
      r.id AS rollId, r.natural AS natural, r.category AS category, r.actor_kind AS actorKind,
      r.actor_id AS actorId, r.manual AS manual, r.dice AS dice, r.replaces_roll_id AS replaces
    FROM game_log_entry e, json_each(e.roll_ids) j JOIN roll r ON r.id = j.value
    WHERE e.campaign_id = ${campaignId} AND e.undone = 0 AND e.superseded_by IS NULL${range}
    ORDER BY e.n`);
  const byId = new Map<string, RollFact>();
  for (const x of rows) {
    const pub = x.public === 1;
    if (!entryVisible(viewer, { public: pub, kind: x.kind })) continue;
    const had = byId.get(x.rollId);
    if (had) {
      had.public ||= pub;
      continue;
    }
    const d20s = (JSON.parse(x.dice) as StoredDie[]).filter((d) => d.faces === 20);
    byId.set(x.rollId, {
      rollId: x.rollId,
      natural: x.natural,
      category: x.category,
      actorKind: x.actorKind,
      actorId: x.actorId,
      public: pub,
      n: x.n,
      encounterId: x.encounterId,
      manual: x.manual === 1,
      d20: d20s.flatMap((d) => (d.value === null ? [] : [d.value])),
      hasD20: d20s.length > 0,
    });
  }
  if (byId.size === 0) return [];
  // FR-DICE-67: final roll only. A roll another roll replaces (`replacesRollId`, GM1's reroll)
  // never counts, even if a line that is not superseded still lists it (the new roll may sit
  // past the range: one pass over the campaign's rerolls, on `roll_campaign`).
  const replaced = db
    .select({ id: roll.replacesRollId })
    .from(roll)
    .where(and(eq(roll.campaignId, campaignId), isNotNull(roll.replacesRollId)))
    .all();
  for (const r of replaced) if (r.id) byId.delete(r.id);
  return [...byId.values()];
}

/** The newest entry's time (a started fight's duration runs to it: facts, never the clock). */
export function lastEntryAt(db: Read, campaignId: string): string | null {
  return (
    db
      .select({ at: gameLogEntry.at })
      .from(gameLogEntry)
      .where(eq(gameLogEntry.campaignId, campaignId))
      .orderBy(desc(gameLogEntry.n))
      .limit(1)
      .get()?.at ?? null
  );
}

/**
 * FR-STATS-32: the log's `n` span of a time span (`toIso` null = up to the newest entry), by binary
 * search on the unique `(campaign_id, n)` index (`at` grows with `n`: entries are appended with the
 * clock). Null = no entry inside.
 */
export function nSpanOf(
  db: Read,
  campaignId: string,
  fromIso: string,
  toIso: string | null,
): { fromN: number; toN: number } | null {
  const last = db
    .select({ n: gameLogEntry.n })
    .from(gameLogEntry)
    .where(eq(gameLogEntry.campaignId, campaignId))
    .orderBy(desc(gameLogEntry.n))
    .limit(1)
    .get()?.n;
  if (last === undefined) return null;
  /** The entry at or after `n` (gaps tolerated). */
  const at = (n: number) =>
    db
      .select({ n: gameLogEntry.n, at: gameLogEntry.at })
      .from(gameLogEntry)
      .where(and(eq(gameLogEntry.campaignId, campaignId), gte(gameLogEntry.n, n)))
      .orderBy(asc(gameLogEntry.n))
      .limit(1)
      .get();
  /** The smallest `n` whose entry passes `ok`, given `ok` is false then true along `n`. */
  const first = (ok: (iso: string) => boolean): number => {
    let lo = 1;
    let hi = last + 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const e = at(mid);
      if (!e || ok(e.at)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const fromN = first((iso) => iso >= fromIso);
  const toN = toIso === null ? last : first((iso) => iso > toIso) - 1;
  return fromN <= toN ? { fromN, toN } : null;
}
