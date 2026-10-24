// Stats Campaign tab formulas (sprint 10 T3, FR-STATS-81–84): pure functions over the merged
// session partials of one viewer class (filter, then aggregate; ADR-0062). The party table uses
// Trophies' Lifetime definitions (FR-STATS-42), the records its Records rules plus a fight's
// healing, and the awards count each session's winners (FR-STATS-12; ties: every winner).
import type { StatsCharacter } from "./rules";
import type { FightTally, LuckTally, TrophyTally } from "./rules-b";
import {
  AWARD_KEYS,
  type Award,
  type AwardKey,
  CAMPAIGN_ROWS_MAX,
  type CampaignAwardsRow,
  type CampaignRecord,
  type CampaignRecords,
  type CampaignRow,
} from "./schemas";

/** Per character: session awards won per award key. */
export type AwardWins = Map<string, Map<AwardKey, number>>;

/** FR-STATS-84: one session's awards: each named winner wins once (a tie's `more` aren't named). */
export function addWins(into: AwardWins, awards: readonly Award[]): void {
  for (const a of awards) {
    for (const w of a.winners) {
      let m = into.get(w.characterId);
      if (!m) {
        m = new Map();
        into.set(w.characterId, m);
      }
      m.set(a.key, (m.get(a.key) ?? 0) + 1);
    }
  }
}

export function mergeWins(into: AwardWins, from: AwardWins): void {
  for (const [id, m] of from) {
    let x = into.get(id);
    if (!x) {
      x = new Map();
      into.set(id, x);
    }
    for (const [k, v] of m) x.set(k, (x.get(k) ?? 0) + v);
  }
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * FR-STATS-82: one row per party character with a non-zero number for this viewer, by Dealt
 * (then name). Companions are rolled into the owner (dealt, healed, kills); taken and downs stay
 * the PC's (OQ-STATS-12 A), as Trophies.
 */
export function campaignRows(
  trophies: ReadonlyMap<string, TrophyTally>,
  luck: ReadonlyMap<string, LuckTally>,
  characters: ReadonlyMap<string, StatsCharacter>,
): CampaignRow[] {
  const out: CampaignRow[] = [];
  for (const c of characters.values()) {
    const t = trophies.get(c.id);
    const l = luck.get(c.id);
    const row: CampaignRow = {
      key: c.id,
      name: c.name,
      playerId: c.playerId,
      dealt: t?.dealt ?? 0,
      taken: t?.taken ?? 0,
      healed: t?.healing ?? 0,
      kills: t?.kills ?? 0,
      downed: t?.downed ?? 0,
      nat20: l?.nat20 ?? 0,
      nat1: l?.nat1 ?? 0,
      fights: t?.fights.size ?? 0,
    };
    const { key: _k, name: _n, playerId: _p, ...numbers } = row;
    if (Object.values(numbers).some((v) => v > 0)) out.push(row);
  }
  out.sort((a, b) => b.dealt - a.dealt || byName(a, b));
  return out.slice(0, CAMPAIGN_ROWS_MAX);
}

interface Candidate {
  value: number;
  n: number;
  characterId: string;
  to?: string;
  encounterId: string;
}

/** The bigger value; on a tie the earlier fact (`n`), as Trophies' `better`. */
const pick = (a: Candidate | null, b: Candidate): Candidate =>
  !a || b.value > a.value || (b.value === a.value && b.n < a.n) ? b : a;

/**
 * FR-STATS-83: the party's records: biggest hit, biggest overkill (per role: the tallies already
 * hold the DM's amount or a player's callout `raw`), and the most damage / kills / healing by one
 * character in one fight; `fight(encounterId)` = the viewer's label with its day.
 */
export function campaignRecords(
  trophies: ReadonlyMap<string, TrophyTally>,
  characters: ReadonlyMap<string, StatsCharacter>,
  fight: (encounterId: string) => string,
): CampaignRecords {
  let hit: Candidate | null = null;
  let overkill: Candidate | null = null;
  const best: Record<keyof Omit<FightTally, "n">, Candidate | null> = {
    dealt: null,
    kills: null,
    healing: null,
  };
  for (const [id, t] of trophies) {
    if (!characters.has(id)) continue;
    if (t.biggestHit) hit = pick(hit, { ...t.biggestHit, characterId: id });
    if (t.biggestOverkill) overkill = pick(overkill, { ...t.biggestOverkill, characterId: id });
    for (const [encounterId, f] of t.perFight) {
      for (const field of ["dealt", "kills", "healing"] as const) {
        if (f[field] > 0) {
          best[field] = pick(best[field], {
            value: f[field],
            n: f.n,
            characterId: id,
            encounterId,
          });
        }
      }
    }
  }
  const record = (c: Candidate | null): CampaignRecord => {
    const ch = c ? characters.get(c.characterId) : undefined;
    if (!c || !ch) return null;
    return {
      value: c.value,
      characterId: ch.id,
      name: ch.name,
      playerId: ch.playerId,
      ...(c.to !== undefined ? { to: c.to } : {}),
      fight: fight(c.encounterId),
    };
  };
  return {
    "biggest-hit": record(hit),
    "biggest-overkill": record(overkill),
    "best-fight-damage": record(best.dealt),
    "best-fight-kills": record(best.kills),
    "best-fight-healing": record(best.healing),
  };
}

/** FR-STATS-84: per character, awards won in card order; by total (then name). */
export function campaignAwards(
  wins: AwardWins,
  characters: ReadonlyMap<string, StatsCharacter>,
): CampaignAwardsRow[] {
  const out: CampaignAwardsRow[] = [];
  for (const [id, m] of wins) {
    const c = characters.get(id);
    if (!c) continue;
    const won = AWARD_KEYS.flatMap((key) => {
      const count = m.get(key) ?? 0;
      return count > 0 ? [{ key, count }] : [];
    });
    if (won.length === 0) continue;
    const total = won.reduce((s, w) => s + w.count, 0);
    out.push({ key: c.id, name: c.name, playerId: c.playerId, total, won });
  }
  out.sort((a, b) => b.total - a.total || byName(a, b));
  return out.slice(0, CAMPAIGN_ROWS_MAX);
}
