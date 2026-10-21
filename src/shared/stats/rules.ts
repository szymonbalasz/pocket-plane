// Stats formulas (STATS §6, FR-STATS-06–15): pure functions over facts the server has already
// filtered for one viewer (FR-STATS-03: filter, then aggregate). No I/O, no clock.
import { isOverkillCallout } from "./callout";
import {
  AWARD_KEYS,
  type Award,
  type AwardKey,
  type AwardWinner,
  DM_DIRECT_KEY,
  DM_DIRECT_NAME,
  type DmFightRow,
  FIGHT_ROWS_MAX,
  type PlayerFightRow,
  SESSION_GAP_MS,
  TIED_MAX,
  UNATTRIBUTED_KEY,
  UNATTRIBUTED_NAME,
} from "./schemas";

export type StatsRole = "dm" | "player";

/** A combatant as stats reads it: current kind, owner and flags (FR-STATS-09: current owner). */
export interface StatsSide {
  id: string;
  name: string;
  kind: "pc" | "monster";
  /** A PC's character id; a monster's definition. */
  entityId: string;
  ownerCharacterId: string | null;
  hidden: boolean;
  ownerHidden: boolean;
  active: boolean;
}

/** One counted `hp_change` row (not undone) with its sides (FR-CBT-138). */
export interface StatsFact {
  encounterId: string;
  n: number;
  kind: "damage" | "heal";
  raw: number;
  applied: number;
  overkill: number;
  hpBefore: number;
  hpAfter: number;
  absorbed: number;
  attacker: StatsSide | null;
  /** Fact names (FR-STATS-04: an ended summon keeps its name). */
  attackerName: string | null;
  target: StatsSide;
  targetName: string;
}

/** One counted roll (FR-DICE-73). */
export interface StatsRoll {
  natural: number | null;
  category: string;
  actorKind: string;
  actorId: string | null;
}

export interface StatsCharacter {
  id: string;
  name: string;
  playerId: string | null;
}

// ---------- party (FR-STATS-09) ----------

/** A companion now (a charmed-away one has no owner: a monster, past facts too, #310). */
export const isCompanion = (s: StatsSide): boolean =>
  s.kind === "monster" && s.ownerCharacterId !== null;
export const isParty = (s: StatsSide): boolean => s.kind === "pc" || isCompanion(s);
/** The party character a side's credit rolls into; null = not party. */
export const characterOf = (s: StatsSide): string | null =>
  s.kind === "pc" ? s.entityId : s.ownerCharacterId;

/** FR-STATS-08: a monster (not a companion) going `hpBefore > 0 → 0`. */
export const isKill = (f: StatsFact): boolean =>
  f.kind === "damage" &&
  f.target.kind === "monster" &&
  !isCompanion(f.target) &&
  f.hpBefore > 0 &&
  f.hpAfter === 0;
/** FR-STATS-08: the same on a PC. */
export const isDown = (f: StatsFact): boolean =>
  f.kind === "damage" && f.target.kind === "pc" && f.hpBefore > 0 && f.hpAfter === 0;
export const isCallout = (f: StatsFact): boolean => f.kind === "damage" && isOverkillCallout(f);
/** OQ-STATS-06 A: the HP that counted (overkill excluded; absorbed temp HP included). */
const effectiveOf = (f: StatsFact): number =>
  f.kind === "damage" ? f.raw - f.overkill : f.applied;

// ---------- fight table (FR-STATS-18) ----------

interface Tally {
  dealt: number;
  taken: number;
  healed: number;
  kills: number;
  downs: number;
  eff: { dealt: number; taken: number; healed: number };
}
const tally = (): Tally => ({
  dealt: 0,
  taken: 0,
  healed: 0,
  kills: 0,
  downs: 0,
  eff: { dealt: 0, taken: 0, healed: 0 },
});

type RowOf<R extends StatsRole> = R extends "dm" ? DmFightRow : PlayerFightRow;

/**
 * FR-STATS-06–09, -18: one row per combatant (companions under their current owner), by Dealt.
 * DM: every combatant + "DM (direct)" / "Unattributed" when non-zero. Player: party rows that
 * appear in a visible fact or are on players' screens now (active, not hidden).
 */
export function fightRows<R extends StatsRole>(
  role: R,
  facts: readonly StatsFact[],
  combatants: readonly StatsSide[],
): RowOf<R>[] {
  const by = new Map<string, Tally>();
  const t = (key: string) => {
    let x = by.get(key);
    if (!x) {
      x = tally();
      by.set(key, x);
    }
    return x;
  };
  for (const f of facts) {
    const eff = effectiveOf(f);
    if (f.kind === "damage") {
      const a = t(f.attacker?.id ?? DM_DIRECT_KEY);
      a.dealt += f.raw;
      a.eff.dealt += eff;
      if (isKill(f)) a.kills += 1;
      const d = t(f.target.id);
      d.taken += f.raw;
      d.eff.taken += eff;
      if (isDown(f)) d.downs += 1;
    } else {
      const h = t(f.attacker?.id ?? UNATTRIBUTED_KEY);
      h.healed += f.raw;
      h.eff.healed += eff;
    }
  }
  const sides = new Map(combatants.map((c) => [c.id, c]));
  // Fact sides missing from the list (another fight's combatant can't be here; safety only).
  for (const f of facts) {
    for (const s of [f.attacker, f.target]) if (s && !sides.has(s.id)) sides.set(s.id, s);
  }
  const shown = [...sides.values()].filter((s) =>
    role === "dm"
      ? true
      : isParty(s) && (by.has(s.id) || (s.active && !s.hidden && !s.ownerHidden)),
  );
  const pcKeyOf = new Map(shown.filter((s) => s.kind === "pc").map((s) => [s.entityId, s.id]));
  const row = (s: StatsSide): RowOf<R> => {
    const x = by.get(s.id) ?? tally();
    const owner = isCompanion(s) ? pcKeyOf.get(s.ownerCharacterId as string) : undefined;
    const base = {
      key: s.id,
      name: s.name,
      ...(owner ? { ownerKey: owner } : {}),
      dealt: x.dealt,
      taken: x.taken,
      healed: x.healed,
      kills: x.kills,
    };
    if (role !== "dm") {
      return { ...base, kind: isCompanion(s) ? "companion" : "pc" } as RowOf<R>;
    }
    return {
      ...base,
      kind: s.kind === "pc" ? "pc" : isCompanion(s) ? "companion" : "monster",
      hidden: s.hidden || s.ownerHidden,
      downs: x.downs,
      effective: { ...x.eff },
    } as RowOf<R>;
  };
  const rows = shown.map(row);
  const byDealt = (a: RowOf<R>, b: RowOf<R>) => b.dealt - a.dealt || a.name.localeCompare(b.name);
  const top = rows.filter((r) => r.ownerKey === undefined).sort(byDealt);
  const under = rows.filter((r) => r.ownerKey !== undefined).sort(byDealt);
  const out: RowOf<R>[] = [];
  for (const r of top) out.push(r, ...under.filter((u) => u.ownerKey === r.key));
  if (role === "dm") {
    for (const [key, name] of [
      [DM_DIRECT_KEY, DM_DIRECT_NAME],
      [UNATTRIBUTED_KEY, UNATTRIBUTED_NAME],
    ] as const) {
      const x = by.get(key);
      if (!x) continue;
      out.push({
        key,
        name,
        kind: "special",
        hidden: false,
        dealt: x.dealt,
        taken: 0,
        healed: x.healed,
        kills: x.kills,
        downs: 0,
        effective: { dealt: x.eff.dealt, taken: 0, healed: x.eff.healed },
      } as RowOf<R>);
    }
  }
  return out.slice(0, FIGHT_ROWS_MAX);
}

// ---------- session awards (FR-STATS-12) ----------

interface Score {
  value: number;
  /** Companion names whose facts counted (shown "Mira + Owlbear"). */
  with: Set<string>;
  /** The deciding fact (biggest-*): the earliest at the max. */
  fact?: StatsFact;
}

export interface AwardsInput {
  role: StatsRole;
  facts: readonly StatsFact[];
  rolls: readonly StatsRoll[];
  characters: ReadonlyMap<string, StatsCharacter>;
  /** The viewer's fight label (DM: the name; a player: "Fight N · Tue 20 Oct"). */
  fightLabel(encounterId: string): string;
}

/** FR-STATS-12: the 9 awards in card order; party only, ties list all (≤ 8), zero = empty. */
export function sessionAwards(input: AwardsInput): Award[] {
  const { role, facts, rolls, characters } = input;
  const scores = new Map<AwardKey, Map<string, Score>>(AWARD_KEYS.map((k) => [k, new Map()]));
  const add = (key: AwardKey, side: StatsSide | null, amount: number, fact?: StatsFact) => {
    if (!side || amount <= 0) return;
    const ch = characterOf(side);
    if (!ch || !characters.has(ch)) return;
    const m = scores.get(key) as Map<string, Score>;
    let s = m.get(ch);
    if (!s) {
      s = { value: 0, with: new Set() };
      m.set(ch, s);
    }
    if (fact) {
      // Max-type award: keep the best (earliest on a tie, facts come in `n` order).
      if (amount <= s.value) return;
      s.value = amount;
      s.with = new Set(isCompanion(side) ? [side.name] : []);
      s.fact = fact;
      return;
    }
    s.value += amount;
    if (isCompanion(side)) s.with.add(side.name);
  };
  for (const f of facts) {
    if (f.kind === "heal") {
      add("most-healing", f.attacker, f.raw);
      continue;
    }
    add("most-dealt", f.attacker, f.raw);
    add("biggest-hit", f.attacker, f.raw, f);
    if (role === "dm") {
      if (f.overkill > 0) add("biggest-overkill", f.attacker, f.overkill, f);
    } else if (isCallout(f)) {
      // Rulings-a #2: players rank and value the callout lines by `raw`.
      add("biggest-overkill", f.attacker, f.raw, f);
    }
    if (isKill(f)) add("most-kills", f.attacker, 1);
    // Taken and downs stay the PC's (OQ-STATS-12 A).
    if (f.target.kind === "pc") {
      add("most-taken", f.target, f.raw);
      if (isDown(f)) add("most-downed", f.target, 1);
    }
  }
  for (const r of rolls) {
    if (r.actorKind !== "entity" || r.actorId === null || r.category === "initiative") continue;
    const ch = characters.get(r.actorId);
    if (!ch) continue;
    const key = r.natural === 20 ? "most-nat20" : r.natural === 1 ? "most-nat1" : null;
    if (!key) continue;
    const m = scores.get(key) as Map<string, Score>;
    const s = m.get(ch.id) ?? { value: 0, with: new Set<string>() };
    s.value += 1;
    m.set(ch.id, s);
  }
  return AWARD_KEYS.map((key) => {
    const m = scores.get(key) as Map<string, Score>;
    let best = 0;
    for (const s of m.values()) best = Math.max(best, s.value);
    if (best === 0) return { key, value: null, winners: [] };
    const tied = [...m.entries()]
      .filter(([, s]) => s.value === best)
      .sort(([, a], [, b]) => (a.fact?.n ?? 0) - (b.fact?.n ?? 0));
    const winners: AwardWinner[] = tied.slice(0, TIED_MAX).map(([id, s]) => {
      const ch = characters.get(id) as StatsCharacter;
      const w = [...s.with].sort().slice(0, 8);
      return {
        characterId: id,
        name: ch.name,
        playerId: ch.playerId,
        ...(w.length ? { with: w } : {}),
      };
    });
    const award: Award = { key, value: best, winners };
    if (tied.length > TIED_MAX) award.more = tied.length - TIED_MAX;
    const fact = tied[0]?.[1].fact;
    if (fact) {
      award.detail = {
        from: fact.attackerName ?? fact.attacker?.name ?? "",
        to: fact.targetName,
        raw: fact.raw,
        fight: input.fightLabel(fact.encounterId),
      };
    }
    return award;
  });
}

// ---------- sessions (FR-STATS-13) ----------

/** One log entry of the timeline (FR-DICE-73). */
export interface TimelineEntry {
  n: number;
  at: string;
  public: boolean;
  /** The kind's feature tag (FR-DICE-69); null = none. */
  feature: string | null;
}

/** First / last entry of one visibility class inside a session. */
export interface SessionSpan {
  fromN: number;
  toN: number;
  from: string;
  to: string;
}

/**
 * A derived session: the unclipped span (the key is `fromN`, FR-STATS-13) and per visibility
 * class (`public` × feature tag) the span of its entries, for each viewer's clipped times.
 */
export interface SessionBounds extends SessionSpan {
  toMs: number;
  /** Key `${public ? 1 : 0}|${feature ?? ""}`. */
  spans: Map<string, SessionSpan>;
}

export const spanKey = (pub: boolean, feature: string | null) => `${pub ? 1 : 0}|${feature ?? ""}`;

const widen = (s: SessionSpan, e: TimelineEntry) => {
  s.toN = e.n;
  s.to = e.at;
};

/**
 * Extends `sessions` (ascending, mutated) with entries after its last `n`: a gap of ≥ 6 h from
 * the previous entry starts a new session. Append-only, so a cache can keep the result.
 */
export function extendSessions(sessions: SessionBounds[], timeline: readonly TimelineEntry[]) {
  for (const e of timeline) {
    const ms = Date.parse(e.at);
    let s = sessions.at(-1);
    if (!s || ms - s.toMs >= SESSION_GAP_MS) {
      s = { fromN: e.n, toN: e.n, from: e.at, to: e.at, toMs: ms, spans: new Map() };
      sessions.push(s);
    } else {
      widen(s, e);
      s.toMs = Math.max(s.toMs, ms);
    }
    const k = spanKey(e.public, e.feature);
    const span = s.spans.get(k);
    if (span) widen(span, e);
    else s.spans.set(k, { fromN: e.n, toN: e.n, from: e.at, to: e.at });
  }
}

/**
 * The viewer's span of a session (FR-STATS-13): entries it can see (players: public only; both:
 * feature tags that are on), or null = the viewer can't list it. Times are clipped to it.
 */
export function visibleSpan(
  s: SessionBounds,
  role: StatsRole,
  features: readonly string[],
): SessionSpan | null {
  let out: SessionSpan | null = null;
  for (const [k, span] of s.spans) {
    const [pub, feature] = k.split("|") as [string, string];
    if (role !== "dm" && pub !== "1") continue;
    if (feature !== "" && !features.includes(feature)) continue;
    if (!out) out = { ...span };
    else {
      if (span.fromN < out.fromN) Object.assign(out, { fromN: span.fromN, from: span.from });
      if (span.toN > out.toN) Object.assign(out, { toN: span.toN, to: span.to });
    }
  }
  return out;
}

/** The session holding entry `n` (binary search over ascending sessions), or undefined. */
export function sessionOf(
  sessions: readonly SessionBounds[],
  n: number,
): SessionBounds | undefined {
  let lo = 0;
  let hi = sessions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sessions[mid] as SessionBounds;
    if (n < s.fromN) hi = mid - 1;
    else if (n > s.toN) lo = mid + 1;
    else return s;
  }
  return undefined;
}

// ---------- labels ----------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 20 Oct", in the server's local time (the table's clock; FR-NOTE-48's `label`). */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** OQ-STATS-19 A: a player's neutral fight label, N by `startedAt` among the fights they list. */
export const neutralFightLabel = (n: number, startedAt: string): string =>
  `Fight ${n} · ${dayLabel(startedAt)}`;
