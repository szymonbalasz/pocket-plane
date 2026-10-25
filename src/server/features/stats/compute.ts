// Stats on read (FR-STATS-01–15, ADR-0059): the viewer filter first (players: the hub filter for
// a viewer with no `playerId`, public lines only; DM all; feature-tagged kinds skipped while off),
// then the pure formulas of `@shared/stats/rules`. Reads only, through the owners' read helpers.

import { campaignAwards, campaignRecords, campaignRows } from "@shared/stats/campaign";
import {
  dayLabel,
  fightRows,
  neutralFightLabel,
  rollsForParty,
  type SessionBounds,
  type StatsCharacter,
  sessionAwards,
  sessionOf,
  type UnseenKind,
  unseenKindsOf,
  visibleSpan,
} from "@shared/stats/rules";
import {
  addLuck,
  fightHighlights,
  type LuckTally,
  luckRows,
  trophyCase,
} from "@shared/stats/rules-b";
import {
  FIGHTS_MAX,
  type FightSummary,
  SESSIONS_MAX,
  type SessionAwards,
  type SessionSummary,
} from "@shared/stats/schemas";
import { and, eq, sql } from "drizzle-orm";
import { forbidden, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { entity } from "../../db/schema";
import {
  type CombatFact,
  combatFacts,
  type FightRow,
  factRefs,
  fightActorIds,
  fightCombatants,
  fightsOf,
  ownedActors,
  ownedCombatantKey,
  publicFactEncounters,
  standingOf,
} from "../combat-tracker/stats-read";
import {
  entryVisible,
  lastEntryAt,
  nSpanOf,
  type RollFact,
  rollFacts,
  type StatsViewer,
} from "../dice-roll-log/stats-read";
import type { Partials } from "./partials";

type Read = Pick<Tx, "select" | "all">;

export interface StatsRead {
  db: Read;
  viewer: StatsViewer;
  campaignId: string;
}

/** FR-STATS-03: a fact counts for the viewer only if its line is visible to them. */
const visibleFacts = (v: StatsViewer, facts: readonly CombatFact[]) =>
  facts.filter((f) => entryVisible(v, { public: f.public, kind: f.entryKind }));

/** The DM's view with the viewer's features (what the DM counts that the viewer may not see). */
export const dmView = (v: StatsViewer): StatsViewer => ({ role: "dm", features: v.features });

/**
 * Sprint 10 BL-111 / sprint 12 BL-121 (FR-STATS-12, DM #343 / #353): a window's facts the viewer
 * counts (FR-STATS-03) and `unseen`: the kinds of party line the DM counts in it that this viewer
 * doesn't see (`unseenKindsOf`: dealt, healed, taken), so they don't get the awards those could
 * change. Existence only, never an amount, a name or a side: the same answer for every player.
 */
export function seenFacts(
  v: StatsViewer,
  all: readonly CombatFact[],
  chars: ReadonlyMap<string, StatsCharacter>,
): { facts: CombatFact[]; unseen: Set<UnseenKind> } {
  const facts = visibleFacts(v, all);
  const unseen = new Set<UnseenKind>();
  if (v.role === "dm" || facts.length === all.length) return { facts, unseen };
  const dm = dmView(v);
  for (const f of all) {
    const e = { public: f.public, kind: f.entryKind };
    if (!entryVisible(dm, e) || entryVisible(v, e)) continue;
    for (const k of unseenKindsOf(f, chars)) unseen.add(k);
  }
  return { facts, unseen };
}

/** A roll of a counted entry that isn't public, by a party character with a kept d20 (BL-121). */
export interface HiddenPartyRoll {
  rollId: string;
  n: number;
  encounterId: string | null;
  category: string;
  actorId: string | null;
}

/**
 * BL-121: the rolls listed by counted entries in `fromN…toN` that aren't public (FR-DICE-72's
 * counting: not undone, not superseded; a feature-tagged kind only while it's on), by a party
 * character with a kept d20 (`rollsForParty`): what could change players' Most nat 20s / 1s. One
 * pass over the non-public entries only, read for players (never the DM). A roll a public entry
 * lists too is theirs: `rolledUnseen` drops the ones they count.
 */
export function hiddenPartyRolls(
  r: StatsRead,
  chars: ReadonlyMap<string, StatsCharacter>,
  fromN: number,
  toN: number,
): HiddenPartyRoll[] {
  const rows = r.db.all<{
    n: number;
    kind: string;
    encounterId: string | null;
    rollId: string;
    natural: number | null;
    category: string;
    actorKind: string;
    actorId: string | null;
  }>(sql`SELECT e.n AS n, e.kind AS kind, e.encounter_id AS encounterId, r.id AS rollId,
      r.natural AS natural, r.category AS category, r.actor_kind AS actorKind, r.actor_id AS actorId
    FROM game_log_entry e, json_each(e.roll_ids) j JOIN roll r ON r.id = j.value
    WHERE e.campaign_id = ${r.campaignId} AND e.undone = 0 AND e.superseded_by IS NULL
      AND e.public = 0 AND e.n BETWEEN ${fromN} AND ${toN} AND r.natural IS NOT NULL`);
  const dm = dmView(r.viewer);
  return rows
    .filter((x) => entryVisible(dm, { public: false, kind: x.kind }) && rollsForParty(x, chars))
    .map(({ rollId, n, encounterId, category, actorId }) => ({
      rollId,
      n,
      encounterId,
      category,
      actorId,
    }));
}

/** BL-121: a hidden party roll the viewer doesn't count (`seen`: their counted rolls). */
export function rolledUnseen(
  hidden: readonly HiddenPartyRoll[],
  seen: readonly { rollId: string }[],
): boolean {
  if (hidden.length === 0) return false;
  const ids = new Set(seen.map((x) => x.rollId));
  return hidden.some((x) => !ids.has(x.rollId));
}

export interface Fights {
  /** The viewer's fights, oldest `startedAt` first. */
  listed: FightRow[];
  label: Map<string, string>;
}

/**
 * FR-STATS-15: the DM lists every started / ended encounter under its name; a player only those
 * with a counted public fact, as "Fight N · Tue 20 Oct" (N by `startedAt` among them, OQ-STATS-19).
 */
export function fightsFor(r: StatsRead): Fights {
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

/** FR-STATS-52: a player's label for the started fight before it has a public fact. */
export const THIS_FIGHT_LABEL = "This fight";

/** FR-STATS-32: the categories a combatant's roll counts in its fight by. */
const FIGHT_ROLL_CATEGORIES: ReadonlySet<string> = new Set(["attack", "saving-throw"]);

/** FR-STATS-32: a fight's `n` span `startedAt…endedAt` (now while started) and its actors. */
interface FightScope {
  fromN: number;
  toN: number;
  actors: ReadonlySet<string>;
}

function fightScope(r: StatsRead, fight: FightRow): FightScope | null {
  if (!fight.startedAt) return null;
  const span = nSpanOf(r.db, r.campaignId, fight.startedAt, fight.endedAt);
  return span ? { ...span, actors: fightActorIds(r.db, fight.id) } : null;
}

/** FR-STATS-32: a roll in the fight's span counts in it (its entry's encounter, or its actor's). */
const inFight = (
  x: Pick<RollFact, "encounterId" | "category" | "actorId">,
  fight: FightRow,
  scope: FightScope,
) =>
  x.encounterId === fight.id ||
  (FIGHT_ROLL_CATEGORIES.has(x.category) && x.actorId !== null && scope.actors.has(x.actorId));

/**
 * FR-STATS-32: a fight's rolls: counted rolls in its `n` span `startedAt…endedAt` (now while
 * started) listed by an entry with its `encounterId`, plus attack / saving-throw rolls by its
 * combatants' actors.
 */
export function fightRolls(
  r: StatsRead,
  fight: FightRow,
  scope: FightScope | null = fightScope(r, fight),
): RollFact[] {
  if (!scope) return [];
  return rollFacts(r.db, r.viewer, r.campaignId, scope.fromN, scope.toN).filter((x) =>
    inFight(x, fight, scope),
  );
}

/**
 * `stats.query {scope: "fight"}`: the given fight (unknown or not listed → `not_found`), else the
 * started one, else the newest ended; none → `fight: null`. FR-STATS-52 (BL-69): a player's
 * default (and the started fight by id) is the started one even before a public fact, labelled
 * "This fight", and it heads the picker's list then (SB1 walkthrough). Sprint 8: + `highlights` per role (FR-STATS-31).
 */
export function fightStats(r: StatsRead, encounterId: string | undefined) {
  const f = fightsFor(r);
  const started =
    r.viewer.role === "dm"
      ? undefined
      : fightsOf(r.db, r.campaignId).find((x) => x.status === "started");
  const pick = encounterId
    ? (f.listed.find((x) => x.id === encounterId) ??
      (started?.id === encounterId ? started : undefined))
    : (f.listed.find((x) => x.status === "started") ??
      started ??
      [...f.listed].reverse().find((x) => x.status === "ended"));
  if (encounterId && !pick) throw notFound("Fight not found");
  // FR-STATS-52: a player's started fight before a public fact heads the picker as "This fight".
  const unlisted = started && !f.listed.some((x) => x.id === started.id) ? started : undefined;
  const fights = unlisted
    ? [
        { key: unlisted.id, label: THIS_FIGHT_LABEL, status: unlisted.status },
        ...summaries(f),
      ].slice(0, FIGHTS_MAX)
    : summaries(f);
  if (!pick) return { fight: null, fights };
  const chars = characters(r.db, r.campaignId);
  const seen = seenFacts(r.viewer, combatFacts(r.db, { encounterId: pick.id }), chars);
  const facts = seen.facts;
  const scope = fightScope(r, pick);
  const rolls = fightRolls(r, pick, scope);
  // BL-121: a party roll of the fight (FR-STATS-32's rule) the DM counts and players don't see.
  if (r.viewer.role !== "dm" && scope) {
    const hidden = hiddenPartyRolls(r, chars, scope.fromN, scope.toN).filter((x) =>
      inFight(x, pick, scope),
    );
    if (rolledUnseen(hidden, rolls)) seen.unseen.add("rolled");
  }
  const combatants = fightCombatants(r.db, pick.id);
  // A started fight's duration runs to the newest entry (the same answer after a restart).
  const until = pick.endedAt ?? lastEntryAt(r.db, r.campaignId) ?? pick.startedAt;
  return {
    fight: {
      key: pick.id,
      label: f.label.get(pick.id) ?? THIS_FIGHT_LABEL,
      round: pick.round,
      status: pick.status,
      rows: fightRows(r.viewer.role, facts, combatants),
      highlights: fightHighlights({
        role: r.viewer.role,
        facts,
        rolls,
        characters: chars,
        round: pick.round,
        span: pick.startedAt ? { from: pick.startedAt, to: until } : null,
        standing: r.viewer.role === "dm" ? standingOf(r.db, pick.id) : [],
        unseen: seen.unseen,
      }),
    },
    fights,
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

export function characters(db: Read, campaignId: string): Map<string, StatsCharacter> {
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
  const chars = characters(r.db, r.campaignId);
  const rolls = rollFacts(r.db, r.viewer, r.campaignId, s.fromN, s.toN);
  const { facts, unseen } = sessionSeenFacts(r, s, chars, rolls);
  const labels = fightsFor(r).label;
  const awards = sessionAwards({
    role: r.viewer.role,
    facts,
    rolls,
    characters: chars,
    fightLabel: (id) => labels.get(id) ?? "",
    unseen,
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

/** A session's counted facts the viewer sees (by line `n`, FR-STATS-13). */
export const sessionFactsOf = (r: StatsRead, s: SessionBounds): CombatFact[] =>
  visibleFacts(
    r.viewer,
    combatFacts(r.db, { campaignId: r.campaignId, fromN: s.fromN, toN: s.toN }),
  );

/**
 * `sessionFactsOf` + BL-121's `unseen` for the session's awards: the facts' kinds (`seenFacts`)
 * and, for players, `rolled` when the DM counts a party roll in it they don't see (`rolls`: the
 * viewer's counted rolls of the session, when the caller holds them).
 */
export function sessionSeenFacts(
  r: StatsRead,
  s: SessionBounds,
  chars: ReadonlyMap<string, StatsCharacter>,
  rolls?: readonly { rollId: string }[],
): { facts: CombatFact[]; unseen: Set<UnseenKind> } {
  const seen = seenFacts(
    r.viewer,
    combatFacts(r.db, { campaignId: r.campaignId, fromN: s.fromN, toN: s.toN }),
    chars,
  );
  if (r.viewer.role === "dm") return seen;
  const hidden = hiddenPartyRolls(r, chars, s.fromN, s.toN);
  const counted = () => rolls ?? rollFacts(r.db, r.viewer, r.campaignId, s.fromN, s.toN);
  if (hidden.length > 0 && rolledUnseen(hidden, counted())) seen.unseen.add("rolled");
  return seen;
}

/**
 * FR-STATS-78 (RECAP's read seam): the fights with a counted fact the viewer sees inside session
 * `s` (the rule `sessionsStats` counts by), oldest `startedAt` first, among the viewer's fights
 * (`fightsFor`). A caller holding the session's facts and `fightsFor` passes them (one read each).
 */
export function sessionFights(
  r: StatsRead,
  s: SessionBounds,
  facts: readonly CombatFact[] = sessionFactsOf(r, s),
  fights: Fights = fightsFor(r),
): FightRow[] {
  const ids = new Set(facts.map((f) => f.encounterId));
  return fights.listed.filter((f) => ids.has(f.id));
}

/** FR-NOTE-48's payload: the key, the times players see (else the DM's) and a date label. */
export function awardsPayload(s: SessionBounds, features: readonly string[]) {
  const span = visibleSpan(s, "player", features) ?? s;
  return { fromN: s.fromN, toN: s.toN, from: span.from, to: span.to, label: dayLabel(span.from) };
}

// ---------- luck and trophies (sprint 8, FR-STATS-37–46) ----------

/**
 * Luck's counted rolls of `fromN…toN` (absent: the campaign), each marked `owned` when its actor is
 * an owned creature now (a pet entity, an owned token, an owned combatant by its line's encounter
 * and name): integrator ruling (SB0 gate pick 6), such rolls count nowhere.
 */
export function luckRolls(r: StatsRead, fromN?: number, toN?: number): RollFact[] {
  const rolls = rollFacts(r.db, r.viewer, r.campaignId, fromN, toN);
  const o = ownedActors(r.db, r.campaignId);
  for (const x of rolls) {
    if (x.actorId === null) continue;
    if (x.actorKind === "token") x.owned = o.tokens.has(x.actorId);
    else if (x.actorKind === "entity") {
      x.owned =
        o.entities.has(x.actorId) ||
        (x.encounterId !== null &&
          o.combatants.has(ownedCombatantKey(x.encounterId, x.actorId, x.actorName))) ||
        o.named.has(`${x.actorId}|${x.actorName}`);
    }
  }
  return rolls;
}

/**
 * `stats.query {scope: "luck"}` (FR-STATS-40): one session the viewer can list (`n` inside it;
 * absent = the newest) read now, or the campaign from the session partials (FR-STATS-46).
 */
export function luckStats(
  r: StatsRead,
  sessions: readonly SessionBounds[],
  partials: Partials,
  input: { n?: number; campaign?: true },
) {
  const chars = characters(r.db, r.campaignId);
  if (input.campaign) {
    const all = partials.campaign(r, chars);
    if (all.pending)
      return { luck: { scope: "campaign" as const, pending: true as const, rows: [] } };
    return { luck: { scope: "campaign" as const, rows: luckRows(all.luck, chars, r.viewer.role) } };
  }
  const hit = pickSession(r, sessions, input.n);
  if (!hit) return { luck: { scope: "session" as const, rows: [] } };
  const tallies = new Map<string, LuckTally>();
  addLuck(tallies, luckRolls(r, hit.s.fromN, hit.s.toN), chars, r.viewer.role);
  return {
    luck: {
      scope: "session" as const,
      fromN: hit.s.fromN,
      rows: luckRows(tallies, chars, r.viewer.role),
    },
  };
}

/**
 * `stats.query {scope: "trophies", characterId}` (FR-STATS-42, -43): the DM any character, a player
 * only their own (else `forbidden`), campaign-wide from the session partials.
 */
export function trophiesStats(
  r: StatsRead,
  partials: Partials,
  characterId: string,
  playerId: string | null,
) {
  const chars = characters(r.db, r.campaignId);
  const c = chars.get(characterId);
  if (!c) throw notFound("Character not found");
  if (r.viewer.role !== "dm" && (playerId === null || c.playerId !== playerId)) {
    throw forbidden("Only your own character's trophies");
  }
  const all = partials.campaign(r, chars);
  if (all.pending) return { trophies: { characterId, pending: true as const } };
  const labels = fightsFor(r).label;
  return {
    trophies: {
      characterId,
      ...trophyCase(
        all.trophies.get(characterId),
        all.luck.get(characterId),
        (id) => labels.get(id) ?? "",
        all.unseen,
      ),
    },
  };
}

// ---------- campaign (sprint 10 T3, FR-STATS-81–87) ----------

/** FR-STATS-83: a record's fight: the DM's name + day; a player's neutral label (holds the day). */
function fightWhen(r: StatsRead, fights: Fights): (encounterId: string) => string {
  const startedAt = new Map(fights.listed.map((f) => [f.id, f.startedAt]));
  return (id) => {
    const label = fights.label.get(id) ?? "";
    const at = startedAt.get(id);
    if (r.viewer.role !== "dm" || !at) return label;
    return `${label.slice(0, 64)} · ${dayLabel(at)}`;
  };
}

/**
 * `stats.query {scope: "campaign"}` (FR-STATS-81–84): the header (sessions the viewer lists,
 * fights with a counted fact they see, monsters slain), the party's lifetime table, the records
 * and the session awards won, all from the session partials (FR-STATS-46, ADR-0062).
 */
export function campaignStats(
  r: StatsRead,
  sessions: readonly SessionBounds[],
  partials: Partials,
) {
  const chars = characters(r.db, r.campaignId);
  const all = partials.campaign(r, chars);
  if (all.pending) return { campaign: { pending: true as const } };
  return {
    campaign: {
      sessions: listable(r, sessions).length,
      fights: all.fights.size,
      slain: all.slain,
      rows: campaignRows(all.trophies, all.luck, chars),
      records: campaignRecords(all.trophies, chars, fightWhen(r, fightsFor(r)), all.unseen),
      awards: campaignAwards(all.wins, chars),
    },
  };
}
