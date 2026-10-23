// Recap on read (FR-RECAP-01–18): one derived session, filtered per viewer before counting
// (FR-RECAP-03), composed only from stats' compute helpers and formulas (FR-RECAP-04, FR-STATS-78)
// plus the loot ledger in the session's time range (FR-RECAP-14). Nothing is stored.
//
// Split for the memo (FR-RECAP-29): `recapBody` (fights, party, loot, rolls, awards) is memoised;
// the header (the viewer's clipped span) and `shared` are read per query outside it.
import {
  DmRecap,
  OMITTABLE_SECTIONS,
  PlayerRecap,
  RECAP_FIGHTS_MAX,
  RECAP_LOOT_MAX,
  RECAP_ROLLS_MAX,
  type RecapCoins,
  type RecapLoot,
  type RecapPartyRow,
  type RecapShared,
  SESSION_RECAP_KIND,
  SessionRecapPayload,
} from "@shared/session-recap/schemas";
import { dayLabel, type SessionBounds, type SessionSpan, sessionAwards } from "@shared/stats/rules";
import {
  addLuck,
  addTrophies,
  avgOf,
  fightHighlights,
  type LuckTally,
  luckKeyOf,
  type TrophyTally,
} from "@shared/stats/rules-b";
import { type Award, DM_DICE_KEY, type DmHighlights } from "@shared/stats/schemas";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { gameLogEntry, notification, roll } from "../../db/schema";
import {
  type CombatFact,
  combatFacts,
  type FightRow,
  standingOf,
} from "../combat-tracker/stats-read";
import { entryVisible, type RollFact } from "../dice-roll-log/stats-read";
import { lootRows } from "../party-loot/recap-read";
import { characters, type Fights, fightsFor, luckRolls, type StatsRead } from "../stats/compute";

type Read = Pick<Tx, "select" | "all">;

/** FR-STATS-03: a fact counts for the viewer only if its line is visible to them. */
const visibleFacts = (r: StatsRead, facts: readonly CombatFact[]) =>
  facts.filter((f) => entryVisible(r.viewer, { public: f.public, kind: f.entryKind }));

/** The session's counted facts the viewer sees (by line `n`, FR-STATS-13). */
const sessionFacts = (r: StatsRead, s: SessionBounds) =>
  visibleFacts(r, combatFacts(r.db, { campaignId: r.campaignId, fromN: s.fromN, toN: s.toN }));

/**
 * FR-STATS-78 `sessionFights(r, s)`: the fights with a counted fact the viewer sees inside session
 * `s` (the rule `sessionsStats` counts by), oldest `startedAt` first, among the viewer's fights.
 * > Moves to `stats/compute.ts` with SP3's stats edits (after FX1, seams S7).
 */
export function sessionFights(
  r: StatsRead,
  s: SessionBounds,
  facts: readonly CombatFact[] = sessionFacts(r, s),
  fights: Fights = fightsFor(r),
): FightRow[] {
  const ids = new Set(facts.map((f) => f.encounterId));
  return fights.listed.filter((f) => ids.has(f.id));
}

// ---------- header and share (per query) ----------

/** FR-RECAP-11: the viewer's clipped span and its date label. */
export function recapHeader(hit: { s: SessionBounds; span: SessionSpan }) {
  return {
    fromN: hit.s.fromN,
    toN: hit.s.toN,
    from: hit.span.from,
    to: hit.span.to,
    label: dayLabel(hit.span.from),
  };
}

/** FR-RECAP-22: the newest `session-recap` row of the session (one read on the campaign's rows). */
export function sharedOf(db: Read, campaignId: string, fromN: number): RecapShared | null {
  const row = db
    .select({ payload: notification.payload, at: notification.createdAt })
    .from(notification)
    .where(
      and(
        eq(notification.campaignId, campaignId),
        eq(notification.kind, SESSION_RECAP_KIND),
        sql`json_extract(${notification.payload}, '$.fromN') = ${fromN}`,
      ),
    )
    .orderBy(desc(notification.seq))
    .limit(1)
    .get();
  const p = row ? SessionRecapPayload.safeParse(row.payload) : null;
  return p?.success && row ? { note: p.data.note ?? null, omit: p.data.omit, at: row.at } : null;
}

// ---------- body (memoised) ----------

/** The DM's body; players' is the same shape before their schema strips it (FR-RECAP-08). */
export interface RecapBody {
  fights: unknown[];
  fightsMore?: number;
  party: RecapPartyRow[];
  loot: RecapLoot;
  rolls: { rows: unknown[]; more?: number };
  awards: Award[];
}

const more = (total: number, max: number) => (total > max ? { more: total - max } : {});

/** FR-RECAP-12: one fight line from its Highlights (the whole fight, stats' fight scope). */
function fightLine(r: StatsRead, f: FightRow, label: string, chars: ReturnType<typeof characters>) {
  const h = fightHighlights({
    role: r.viewer.role,
    facts: visibleFacts(r, combatFacts(r.db, { encounterId: f.id })),
    rolls: [],
    characters: chars,
    round: f.round,
    // An ended fight's Start → End; a running one shows "running" (no duration).
    span: f.endedAt ? { from: f.startedAt, to: f.endedAt } : null,
    standing: r.viewer.role === "dm" ? standingOf(r.db, f.id) : [],
  }) as DmHighlights;
  return {
    key: f.id,
    label,
    status: f.status,
    rounds: f.round,
    duration: f.endedAt ? h.duration : null,
    mvp: h.mvp,
    kills: h.kills,
    downed: h.downed,
    ...(r.viewer.role === "dm" ? { standing: h.standing } : {}),
  };
}

/** FR-RECAP-13: party characters with a counted fact or roll, by Dealt (then name). */
function partyRows(
  trophies: ReadonlyMap<string, TrophyTally>,
  luck: ReadonlyMap<string, LuckTally>,
  chars: ReturnType<typeof characters>,
): RecapPartyRow[] {
  const ids = new Set([...trophies.keys(), ...luck.keys()].filter((id) => chars.has(id)));
  return [...ids]
    .map((id) => {
      const c = chars.get(id) as NonNullable<ReturnType<typeof chars.get>>;
      const t = trophies.get(id);
      const l = luck.get(id);
      return {
        characterId: id,
        name: c.name,
        playerId: c.playerId,
        dealt: t?.dealt ?? 0,
        kills: t?.kills ?? 0,
        downed: t?.downed ?? 0,
        healed: t?.healing ?? 0,
        nat20: l?.nat20 ?? 0,
        nat1: l?.nat1 ?? 0,
        avg: l ? avgOf(l) : null,
      };
    })
    .sort((a, b) => b.dealt - a.dealt || a.name.localeCompare(b.name));
}

const COIN_KEYS = ["cp", "sp", "ep", "gp", "pp"] as const;

/** FR-RECAP-14: the session's `[from, next from)` (the newest: up to now). */
export function lootRange(sessions: readonly SessionBounds[], s: SessionBounds) {
  const i = sessions.indexOf(s);
  return { fromAt: s.from, toAt: sessions[i + 1]?.from ?? null };
}

/** FR-RECAP-14: ledger rows ≤ 60, then "+N more"; totals per coin and item name over all. */
function lootOf(r: StatsRead, sessions: readonly SessionBounds[], s: SessionBounds): RecapLoot {
  const { fromAt, toAt } = lootRange(sessions, s);
  const rows = lootRows(r.db, r.campaignId, fromAt, toAt);
  const chars = characters(r.db, r.campaignId);
  const coins: RecapCoins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const items = new Map<string, { name: string; qty: number }>();
  const listed = rows.map((x) => {
    const c: RecapCoins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    for (const k of COIN_KEYS) {
      c[k] = x.sign * x[k];
      coins[k] += c[k];
    }
    const isItem = x.kind === "item";
    if (isItem) {
      const key = x.text.toLowerCase();
      const t = items.get(key) ?? { name: x.text, qty: 0 };
      t.qty += x.sign * (x.qty ?? 1);
      items.set(key, t);
    }
    return {
      id: x.id,
      kind: isItem ? ("item" as const) : ("coins" as const),
      holder:
        x.side.kind === "character"
          ? {
              kind: "character" as const,
              characterId: x.side.characterId,
              name: chars.get(x.side.characterId)?.name ?? "",
            }
          : { kind: "party" as const },
      text: x.text,
      coins: c,
      ...(isItem ? { qty: x.sign * (x.qty ?? 1) } : {}),
    };
  });
  return {
    rows: listed.slice(0, RECAP_LOOT_MAX),
    ...more(listed.length, RECAP_LOOT_MAX),
    totals: { coins, items: [...items.values()] },
  };
}

/** FR-RECAP-15: counted nat 20s / 1s by luck's rule (players: party characters only). */
function notableRolls(
  r: StatsRead,
  rolls: readonly RollFact[],
  chars: ReturnType<typeof characters>,
) {
  const notable = rolls.filter((x) => {
    if (x.natural !== 20 && x.natural !== 1) return false;
    const key = luckKeyOf(x, chars);
    return key !== null && (key !== DM_DICE_KEY || r.viewer.role === "dm");
  });
  const shown = notable.slice(0, RECAP_ROLLS_MAX);
  // Two reads for ≤ 12 lines: the listing entries' ids (by `n`) and the rolls' labels.
  const entryIds = new Map(
    shown.length === 0
      ? []
      : r.db
          .select({ n: gameLogEntry.n, id: gameLogEntry.id })
          .from(gameLogEntry)
          .where(
            and(
              eq(gameLogEntry.campaignId, r.campaignId),
              inArray(
                gameLogEntry.n,
                shown.map((x) => x.n),
              ),
            ),
          )
          .all()
          .map((e) => [e.n, e.id] as const),
  );
  const labels = new Map(
    shown.length === 0
      ? []
      : r.db
          .select({ id: roll.id, label: roll.label, expression: roll.expression })
          .from(roll)
          .where(
            inArray(
              roll.id,
              shown.map((x) => x.rollId),
            ),
          )
          .all()
          .map((x) => [x.id, x.label ?? x.expression] as const),
  );
  return {
    rows: shown.map((x) => {
      const ch = x.actorId !== null ? chars.get(x.actorId) : undefined;
      return {
        id: entryIds.get(x.n) ?? x.rollId,
        name: ch && x.actorKind === "entity" ? ch.name : x.actorName,
        natural: x.natural as 20 | 1,
        label: (labels.get(x.rollId) ?? "").slice(0, 120),
        ...(r.viewer.role === "dm" ? { hidden: !x.public } : {}),
      };
    }),
    ...more(notable.length, RECAP_ROLLS_MAX),
  };
}

/** FR-RECAP-12–16: the memoised part of one session's recap for one viewer class. */
export function recapBody(
  r: StatsRead,
  sessions: readonly SessionBounds[],
  s: SessionBounds,
): RecapBody {
  const chars = characters(r.db, r.campaignId);
  const facts = sessionFacts(r, s);
  // FR-RECAP-25: one `fightsFor` per query (labels, the session's fights, the awards' details).
  const fights = fightsFor(r);
  const inSession = sessionFights(r, s, facts, fights);
  const rolls = luckRolls(r, s.fromN, s.toN);
  const trophies = new Map<string, TrophyTally>();
  addTrophies(trophies, facts, chars, r.viewer.role);
  const luck = new Map<string, LuckTally>();
  addLuck(luck, rolls, chars, r.viewer.role);
  return {
    fights: inSession
      .slice(0, RECAP_FIGHTS_MAX)
      .map((f) => fightLine(r, f, fights.label.get(f.id) ?? "", chars)),
    ...(inSession.length > RECAP_FIGHTS_MAX
      ? { fightsMore: inSession.length - RECAP_FIGHTS_MAX }
      : {}),
    party: partyRows(trophies, luck, chars),
    loot: lootOf(r, sessions, s),
    rolls: notableRolls(r, rolls, chars),
    awards: sessionAwards({
      role: r.viewer.role,
      facts,
      rolls,
      characters: chars,
      fightLabel: (id) => fights.label.get(id) ?? "",
    }),
  };
}

/**
 * FR-RECAP-08, -22: the recap for the viewer's role, parsed with its strict schema (a field it
 * lacks is a bug, never sent). Players' acks leave the sections the newest share omits out.
 */
export function recapFor(
  role: "dm" | "player",
  header: ReturnType<typeof recapHeader>,
  body: RecapBody,
  shared: RecapShared | null,
): DmRecap | PlayerRecap {
  if (role === "dm") return DmRecap.parse({ ...header, ...body, shared });
  const omit = new Set(shared?.omit ?? []);
  const kept = Object.fromEntries(
    OMITTABLE_SECTIONS.filter((k) => !omit.has(k)).map((k) => [k, body[k]]),
  );
  return PlayerRecap.parse({
    ...header,
    fights: body.fights,
    ...(body.fightsMore ? { fightsMore: body.fightsMore } : {}),
    ...kept,
    shared,
  });
}
