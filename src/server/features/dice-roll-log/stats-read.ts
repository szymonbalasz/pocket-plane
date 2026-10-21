// Stats read helper (FR-DICE-72, -73, ADR-0059): read-only views of the log for stats. Rules on
// top of GM's supersede contract (FR-DICE-63 / -67): only a roll listed by an entry that is neither
// undone nor superseded counts, once; (a) players: the hub filter for a viewer with no `playerId`
// (public only: `audiencePlayerId` lines count for the DM only); (b) feature-tagged kinds are
// skipped while their feature is off; (c) `natural`, `category`, `rollIds`, `encounterId` and
// `public` keep their meaning (a change needs a stats review).
import { getLogKind } from "@shared/dice-roll-log/kinds";
import type { StatsRole, StatsRoll, TimelineEntry } from "@shared/stats/rules";
import { and, asc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { gameLogEntry, roll } from "../../db/schema";

type Read = Pick<Tx, "select">;

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
}

/**
 * FR-DICE-73: one row per counted roll listed by an entry in `fromN…toN`, after the viewer filter
 * (a roll a reroll replaced never: FR-DICE-67):
 * a roll in two entries returns once (`public` if any counted listing entry is public); a roll no
 * counted entry lists is absent.
 */
export function rollFacts(
  db: Read,
  viewer: StatsViewer,
  campaignId: string,
  fromN: number,
  toN: number,
): RollFact[] {
  const entries = db
    .select({
      kind: gameLogEntry.kind,
      public: gameLogEntry.public,
      undone: gameLogEntry.undone,
      supersededBy: gameLogEntry.supersededBy,
      rollIds: gameLogEntry.rollIds,
    })
    .from(gameLogEntry)
    .where(
      and(
        eq(gameLogEntry.campaignId, campaignId),
        gte(gameLogEntry.n, fromN),
        lte(gameLogEntry.n, toN),
      ),
    )
    .orderBy(asc(gameLogEntry.n))
    .all();
  const pub = new Map<string, boolean>();
  for (const e of entries) {
    if (e.undone || e.supersededBy !== null || !entryVisible(viewer, e)) continue;
    for (const id of e.rollIds as string[]) pub.set(id, (pub.get(id) ?? false) || e.public);
  }
  const ids = [...pub.keys()];
  const out: RollFact[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = db
      .select({
        rollId: roll.id,
        natural: roll.natural,
        category: roll.category,
        actorKind: roll.actorKind,
        actorId: roll.actorId,
      })
      .from(roll)
      .where(and(eq(roll.campaignId, campaignId), inArray(roll.id, ids.slice(i, i + 500))))
      .all();
    for (const r of rows) out.push({ ...r, public: pub.get(r.rollId) ?? false });
  }
  // FR-DICE-67: final roll only. A roll another roll replaces (`replacesRollId`, GM1's reroll)
  // never counts, even if a line that is not superseded still lists it.
  const replaced = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = db
      .select({ id: roll.replacesRollId })
      .from(roll)
      .where(
        and(eq(roll.campaignId, campaignId), inArray(roll.replacesRollId, ids.slice(i, i + 500))),
      )
      .all();
    for (const r of rows) if (r.id) replaced.add(r.id);
  }
  return replaced.size ? out.filter((r) => !replaced.has(r.rollId)) : out;
}
