// Stats on read (FR-STATS-01–15, ADR-0059): the viewer filter first (players: the hub filter for
// a viewer with no `playerId`, public lines only; DM all; feature-tagged kinds skipped while off),
// then the pure formulas of `@shared/stats/rules`. Reads only, through the owners' read helpers.

import {
  dayLabel,
  fightRows,
  neutralFightLabel,
  type SessionBounds,
  type StatsCharacter,
  sessionAwards,
  sessionOf,
  visibleSpan,
} from "@shared/stats/rules";
import {
  FIGHTS_MAX,
  type FightSummary,
  SESSIONS_MAX,
  type SessionAwards,
  type SessionSummary,
} from "@shared/stats/schemas";
import { and, eq } from "drizzle-orm";
import { notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { entity } from "../../db/schema";
import {
  type CombatFact,
  combatFacts,
  type FightRow,
  factRefs,
  fightCombatants,
  fightsOf,
  publicFactEncounters,
} from "../combat-tracker/stats-read";
import { entryVisible, rollFacts, type StatsViewer } from "../dice-roll-log/stats-read";

type Read = Pick<Tx, "select">;

export interface StatsRead {
  db: Read;
  viewer: StatsViewer;
  campaignId: string;
}

/** FR-STATS-03: a fact counts for the viewer only if its line is visible to them. */
const visibleFacts = (v: StatsViewer, facts: readonly CombatFact[]) =>
  facts.filter((f) => entryVisible(v, { public: f.public, kind: f.entryKind }));

interface Fights {
  /** The viewer's fights, oldest `startedAt` first. */
  listed: FightRow[];
  label: Map<string, string>;
}

/**
 * FR-STATS-15: the DM lists every started / ended encounter under its name; a player only those
 * with a counted public fact, as "Fight N · Tue 20 Oct" (N by `startedAt` among them, OQ-STATS-19).
 */
function fightsFor(r: StatsRead): Fights {
  const all = fightsOf(r.db, r.campaignId);
  if (r.viewer.role === "dm") {
    return { listed: all, label: new Map(all.map((f) => [f.id, f.name])) };
  }
  const withFact = publicFactEncounters(r.db, r.campaignId);
  const listed = all.filter((f) => withFact.has(f.id));
  return {
    listed,
    label: new Map(listed.map((f, i) => [f.id, neutralFightLabel(i + 1, f.startedAt)])),
  };
}

const summaries = (f: Fights): FightSummary[] =>
  [...f.listed]
    .reverse()
    .slice(0, FIGHTS_MAX)
    .map((x) => ({ key: x.id, label: f.label.get(x.id) ?? "", status: x.status }));

/**
 * `stats.query {scope: "fight"}`: the given fight (unknown or not listed → `not_found`), else the
 * started one, else the newest ended; none → `fight: null`.
 */
export function fightStats(r: StatsRead, encounterId: string | undefined) {
  const f = fightsFor(r);
  const pick = encounterId
    ? f.listed.find((x) => x.id === encounterId)
    : (f.listed.find((x) => x.status === "started") ??
      [...f.listed].reverse().find((x) => x.status === "ended"));
  if (encounterId && !pick) throw notFound("Fight not found");
  if (!pick) return { fight: null, fights: summaries(f) };
  const facts = visibleFacts(r.viewer, combatFacts(r.db, { encounterId: pick.id }));
  return {
    fight: {
      key: pick.id,
      label: f.label.get(pick.id) ?? "",
      round: pick.round,
      status: pick.status,
      rows: fightRows(r.viewer.role, facts, fightCombatants(r.db, pick.id)),
    },
    fights: summaries(f),
  };
}

/** Sessions the viewer can list, ascending, with their clipped spans (FR-STATS-13). */
function listable(r: StatsRead, sessions: readonly SessionBounds[]) {
  return sessions.flatMap((s) => {
    const span = visibleSpan(s, r.viewer.role, r.viewer.features);
    return span ? [{ s, span }] : [];
  });
}

/** `stats.query {scope: "sessions"}`: the newest 200 the viewer can list, newest first. */
export function sessionsStats(r: StatsRead, sessions: readonly SessionBounds[]) {
  const list = listable(r, sessions);
  // Per-session fight counts from the counted facts the viewer sees (one read for all).
  const fights = new Map<SessionBounds, Set<string>>();
  for (const ref of factRefs(r.db, r.campaignId)) {
    if (!entryVisible(r.viewer, { public: ref.public, kind: ref.entryKind })) continue;
    const s = sessionOf(sessions, ref.n);
    if (!s) continue;
    let set = fights.get(s);
    if (!set) {
      set = new Set();
      fights.set(s, set);
    }
    set.add(ref.encounterId);
  }
  const out: SessionSummary[] = list
    .slice(-SESSIONS_MAX)
    .reverse()
    .map(({ s, span }) => ({
      fromN: s.fromN,
      toN: s.toN,
      from: span.from,
      to: span.to,
      fights: fights.get(s)?.size ?? 0,
    }));
  return { sessions: out };
}

function characters(db: Read, campaignId: string): Map<string, StatsCharacter> {
  const rows = db
    .select({ id: entity.id, name: entity.name, playerId: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.campaignId, campaignId), eq(entity.kind, "character")))
    .all();
  return new Map(rows.map((c) => [c.id, c]));
}

/** The session holding `n` (absent: the newest) that the viewer can list; else null / `not_found`. */
export function pickSession(
  r: StatsRead,
  sessions: readonly SessionBounds[],
  n: number | undefined,
) {
  const list = listable(r, sessions);
  if (n === undefined) return list.at(-1) ?? null;
  const s = sessionOf(sessions, n);
  const hit = s ? list.find((x) => x.s === s) : undefined;
  if (!hit) throw notFound("Session not found");
  return hit;
}

/** `stats.query {scope: "session"}`: one session's 9 awards for the viewer (FR-STATS-12). */
export function sessionStats(
  r: StatsRead,
  sessions: readonly SessionBounds[],
  n: number | undefined,
): { session: SessionAwards | null } {
  const hit = pickSession(r, sessions, n);
  if (!hit) return { session: null };
  const { s, span } = hit;
  const facts = visibleFacts(
    r.viewer,
    combatFacts(r.db, { campaignId: r.campaignId, from: s.from, to: s.to }),
  );
  const labels = fightsFor(r).label;
  const awards = sessionAwards({
    role: r.viewer.role,
    facts,
    rolls: rollFacts(r.db, r.viewer, r.campaignId, s.fromN, s.toN),
    characters: characters(r.db, r.campaignId),
    fightLabel: (id) => labels.get(id) ?? "",
  });
  return {
    session: {
      fromN: s.fromN,
      toN: s.toN,
      from: span.from,
      to: span.to,
      fights: new Set(facts.map((f) => f.encounterId)).size,
      awards,
    },
  };
}

/** FR-NOTE-48's payload: the key, the times players see (else the DM's) and a date label. */
export function awardsPayload(s: SessionBounds, features: readonly string[]) {
  const span = visibleSpan(s, "player", features) ?? s;
  return { fromN: s.fromN, toN: s.toN, from: span.from, to: span.to, label: dayLabel(span.from) };
}
