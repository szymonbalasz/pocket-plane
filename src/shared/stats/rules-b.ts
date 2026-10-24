// Stats tier B formulas (STATS §6.1, FR-STATS-26–53): Highlights, Luck and Trophies as pure
// functions over facts the server has already filtered for one viewer (filter, then aggregate).
// Tallies are mergeable, so per-session partials (FR-STATS-46, ADR-0062) sum to the campaign's.
import { fellOf } from "./callout";
import {
  characterOf,
  isCallout,
  isCompanion,
  isDown,
  isKill,
  type StatsCharacter,
  type StatsFact,
  type StatsRole,
  type StatsRoll,
  type StatsSide,
} from "./rules";
import {
  DM_DICE_KEY,
  DM_DICE_NAME,
  type DmFellEvent,
  type DmHighlightStat,
  type DmHighlights,
  type DmLuckRow,
  FELL_LIST_MAX,
  LUCK_ROWS_MAX,
  TIED_MAX,
  type TrophyLifetime,
  type TrophyRecords,
} from "./schemas";

/** A counted fact with its line's `public` (the DM's hidden marks). */
export interface LineFact extends StatsFact {
  public: boolean;
}

/** A counted roll with its d20 faces (FR-DICE-89). */
export interface LuckRoll extends StatsRoll {
  /** Every d20 face with a value, kept and dropped. */
  d20: readonly number[];
  hasD20: boolean;
  /** An owned creature's roll (a pet, summon or companion, ADR-0056); set by the server. */
  owned?: boolean;
}

// ---------- credit ----------

interface Credit {
  key: string;
  name: string;
  playerId: string | null;
  hidden: boolean;
  /** A companion's name when its fact rolls into its owner. */
  companion?: string;
}

/**
 * FR-STATS-09, -31: a party side's credit goes to its character (companions to the current owner);
 * the DM also credits monsters by combatant. Null = not counted for this viewer.
 */
function creditOf(
  side: StatsSide | null,
  role: StatsRole,
  characters: ReadonlyMap<string, StatsCharacter>,
): Credit | null {
  if (!side) return null;
  const hidden = side.hidden || side.ownerHidden;
  const ch = characterOf(side);
  const c = ch ? characters.get(ch) : undefined;
  if (c) {
    return {
      key: c.id,
      name: c.name,
      playerId: c.playerId,
      hidden,
      ...(isCompanion(side) ? { companion: side.name } : {}),
    };
  }
  if (role === "dm" && side.kind === "monster" && !isCompanion(side)) {
    return { key: side.id, name: side.name, playerId: null, hidden };
  }
  return null;
}

interface Entry {
  credit: Credit;
  value: number;
  with: Set<string>;
  hidden: boolean;
  /** The deciding fact (max boards): the earliest at the max. */
  fact?: StatsFact;
  /** First `n` that scored (tie order). */
  n: number;
}

/** One highlight item: a sum or a max per credit; ties list all (≤ 8), zero = empty. */
class Board {
  private m = new Map<string, Entry>();

  private entry(c: Credit, n: number): Entry {
    let e = this.m.get(c.key);
    if (!e) {
      e = { credit: c, value: 0, with: new Set(), hidden: false, n };
      this.m.set(c.key, e);
    }
    return e;
  }

  sum(c: Credit | null, amount: number, n: number): void {
    if (!c || amount <= 0) return;
    const e = this.entry(c, n);
    e.value += amount;
    e.hidden ||= c.hidden;
    if (c.companion) e.with.add(c.companion);
  }

  max(c: Credit | null, amount: number, fact: StatsFact): void {
    if (!c || amount <= 0) return;
    const e = this.entry(c, fact.n);
    if (amount <= e.value) return;
    e.value = amount;
    e.hidden = c.hidden;
    e.with = new Set(c.companion ? [c.companion] : []);
    e.fact = fact;
    e.n = fact.n;
  }

  /** `nameable`: a player's detail never names a side hidden now (FR-STATS-35). */
  stat(role: StatsRole, nameable: (f: StatsFact) => boolean = () => true): DmHighlightStat {
    let best = 0;
    for (const e of this.m.values()) best = Math.max(best, e.value);
    if (best === 0) return { value: null, winners: [] };
    const tied = [...this.m.values()]
      .filter((e) => e.value === best)
      .sort((a, b) => a.n - b.n || a.credit.name.localeCompare(b.credit.name));
    const out: DmHighlightStat = {
      value: best,
      winners: tied.slice(0, TIED_MAX).map((e) => {
        const w = [...e.with].sort().slice(0, 8);
        return {
          key: e.credit.key,
          name: e.credit.name,
          playerId: e.credit.playerId,
          ...(w.length ? { with: w } : {}),
          ...(role === "dm" ? { hidden: e.hidden } : {}),
        } as DmHighlightStat["winners"][number];
      }),
    };
    if (tied.length > TIED_MAX) out.more = tied.length - TIED_MAX;
    const fact = tied[0]?.fact;
    if (fact && nameable(fact)) {
      out.detail = {
        from: fact.attackerName ?? fact.attacker?.name ?? "",
        to: fact.targetName,
        raw: fact.raw,
      };
    }
    return out;
  }
}

// ---------- highlights (FR-STATS-31, -32, -35) ----------

export interface HighlightsInput {
  role: StatsRole;
  /** The fight's counted facts the viewer sees, in log order. */
  facts: readonly LineFact[];
  /** The fight's counted rolls the viewer sees (FR-STATS-32). */
  rolls: readonly LuckRoll[];
  characters: ReadonlyMap<string, StatsCharacter>;
  round: number;
  /** Start → End (→ the newest entry while started); null = not started. */
  span: { from: string; to: string } | null;
  /** DM only: monsters still standing. */
  standing: readonly { id: string; name: string; hidden: boolean }[];
}

const hiddenSide = (s: StatsSide | null) => !!s && (s.hidden || s.ownerHidden);

/**
 * FR-STATS-31: MVP (most Dealt), Biggest hit, Biggest overkill (per role, FR-STATS-12), Most
 * healing, Kills / Downs in log order (FR-CBT-152's classification, as the feed), Nat 20s / 1s,
 * Rounds, Duration. Players: party only, and never a hidden side's name (FR-STATS-35); the DM adds
 * monsters, hidden marks and Still standing. The caller parses with the role's schema.
 */
export function fightHighlights(input: HighlightsInput): DmHighlights {
  const { role, characters } = input;
  const boards = {
    mvp: new Board(),
    hit: new Board(),
    overkill: new Board(),
    healing: new Board(),
    nat20: new Board(),
    nat1: new Board(),
  };
  const kills: DmFellEvent[] = [];
  const downs: DmFellEvent[] = [];
  for (const f of input.facts) {
    const by = creditOf(f.attacker, role, characters);
    if (f.kind === "heal") {
      boards.healing.sum(by, f.raw, f.n);
      continue;
    }
    boards.mvp.sum(by, f.raw, f.n);
    boards.hit.max(by, f.raw, f);
    if (role === "dm") boards.overkill.max(by, f.overkill, f);
    else if (isCallout(f)) boards.overkill.max(by, f.raw, f);
    const fell = fellOf(f.target, f);
    if (!fell) continue;
    // FR-STATS-35: a player's list never names a side that is hidden now.
    if (role !== "dm" && (hiddenSide(f.target) || hiddenSide(f.attacker))) continue;
    const callout = isCallout(f);
    const event: DmFellEvent = {
      fell,
      from: f.attacker ? (f.attackerName ?? f.attacker.name) : null,
      to: f.targetName,
      callout,
      ...(role === "dm" ? { hidden: !f.public, ...(callout ? { overkill: f.overkill } : {}) } : {}),
    } as DmFellEvent;
    (fell === "kill" ? kills : downs).push(event);
  }
  for (const r of input.rolls) {
    if (r.actorKind !== "entity" || r.actorId === null || r.category === "initiative") continue;
    const c = characters.get(r.actorId);
    if (!c) continue;
    const credit: Credit = { key: c.id, name: c.name, playerId: c.playerId, hidden: false };
    if (r.natural === 20) boards.nat20.sum(credit, 1, 0);
    else if (r.natural === 1) boards.nat1.sum(credit, 1, 0);
  }
  const list = (xs: DmFellEvent[]) => ({
    events: xs.slice(0, FELL_LIST_MAX),
    ...(xs.length > FELL_LIST_MAX ? { more: xs.length - FELL_LIST_MAX } : {}),
  });
  const nameable = (f: StatsFact) =>
    role === "dm" || !(hiddenSide(f.target) || hiddenSide(f.attacker));
  const out = {
    mvp: boards.mvp.stat(role),
    "biggest-hit": boards.hit.stat(role, nameable),
    "biggest-overkill": boards.overkill.stat(role, nameable),
    "most-healing": boards.healing.stat(role),
    kills: list(kills),
    downed: list(downs),
    nat20: boards.nat20.stat(role),
    nat1: boards.nat1.stat(role),
    rounds: input.round,
    duration: input.span ? Math.max(0, Date.parse(input.span.to) - Date.parse(input.span.from)) : 0,
  };
  if (role !== "dm") return out as DmHighlights;
  return {
    ...out,
    standing: input.standing.map((s) => ({ key: s.id, name: s.name, hidden: s.hidden })),
  };
}

// ---------- luck (FR-STATS-37–39) ----------

export interface LuckTally {
  rolls: number;
  d20s: number;
  d20Sum: number;
  nat20: number;
  nat1: number;
}
const luckTally = (): LuckTally => ({ rolls: 0, d20s: 0, d20Sum: 0, nat20: 0, nat1: 0 });

/**
 * FR-STATS-37, -39: the row a counted roll lands on: a party character (a character actor), else
 * the DM's `dm-dice` (the DM, unowned monsters, unowned tokens); a player's "Me" roll and an owned
 * creature's (pet, summon, companion) count nowhere. Null =
 * not counted (initiative, no d20).
 */
export function luckKeyOf(
  r: LuckRoll,
  characters: ReadonlyMap<string, StatsCharacter>,
): string | null {
  if (r.category === "initiative" || !r.hasD20) return null;
  if (r.actorKind === "player") return null;
  // Integrator ruling (SB0 gate pick 6): an owned creature's roll counts nowhere, not its owner's row nor DM dice.
  if (r.owned) return null;
  if (r.actorKind === "entity" && r.actorId !== null && characters.has(r.actorId)) {
    return r.actorId;
  }
  return DM_DICE_KEY;
}

/** Adds counted rolls to per-row tallies (players: no `dm-dice`). */
export function addLuck(
  into: Map<string, LuckTally>,
  rolls: readonly LuckRoll[],
  characters: ReadonlyMap<string, StatsCharacter>,
  role: StatsRole,
): void {
  for (const r of rolls) {
    const key = luckKeyOf(r, characters);
    if (key === null || (key === DM_DICE_KEY && role !== "dm")) continue;
    let t = into.get(key);
    if (!t) {
      t = luckTally();
      into.set(key, t);
    }
    t.rolls += 1;
    t.d20s += r.d20.length;
    for (const v of r.d20) t.d20Sum += v;
    // FR-DICE-20: `natural` is set only for one kept d20.
    if (r.natural === 20) t.nat20 += 1;
    else if (r.natural === 1) t.nat1 += 1;
  }
}

export function mergeLuck(into: Map<string, LuckTally>, from: ReadonlyMap<string, LuckTally>) {
  for (const [k, t] of from) {
    const x = into.get(k) ?? luckTally();
    x.rolls += t.rolls;
    x.d20s += t.d20s;
    x.d20Sum += t.d20Sum;
    x.nat20 += t.nat20;
    x.nat1 += t.nat1;
    into.set(k, x);
  }
}

/** Mean of d20 faces, 1 decimal; null with none (FR-STATS-38). */
export const avgOf = (t: Pick<LuckTally, "d20s" | "d20Sum">): number | null =>
  t.d20s ? Math.round((t.d20Sum / t.d20s) * 10) / 10 : null;

/** FR-STATS-39, -41: party characters with ≥ 1 counted roll by name, then the DM's `dm-dice`. */
export function luckRows(
  tallies: ReadonlyMap<string, LuckTally>,
  characters: ReadonlyMap<string, StatsCharacter>,
  role: StatsRole,
): DmLuckRow[] {
  const row = (key: string, name: string, playerId: string | null, t: LuckTally): DmLuckRow => ({
    key,
    name,
    playerId,
    rolls: t.rolls,
    d20s: t.d20s,
    avg: avgOf(t),
    nat20: t.nat20,
    nat1: t.nat1,
  });
  const out: DmLuckRow[] = [];
  for (const [key, t] of tallies) {
    const c = characters.get(key);
    if (c && t.rolls > 0) out.push(row(c.id, c.name, c.playerId, t));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const dm = tallies.get(DM_DICE_KEY);
  if (role === "dm" && dm && dm.rolls > 0) out.push(row(DM_DICE_KEY, DM_DICE_NAME, null, dm));
  return out.slice(0, LUCK_ROWS_MAX);
}

// ---------- trophies (FR-STATS-42) ----------

interface Best {
  value: number;
  to: string;
  encounterId: string;
  n: number;
}

/** One character's numbers in one fight (sprint 10 T3: + `healing`, FR-STATS-83). */
export interface FightTally {
  dealt: number;
  kills: number;
  healing: number;
  n: number;
}

export interface TrophyTally {
  dealt: number;
  taken: number;
  healing: number;
  kills: number;
  downed: number;
  fights: Set<string>;
  /** Per encounter (`n` = its first fact's, the tie order): the Best fight records. */
  perFight: Map<string, FightTally>;
  biggestHit: Best | null;
  biggestOverkill: Best | null;
}
const trophyTally = (): TrophyTally => ({
  dealt: 0,
  taken: 0,
  healing: 0,
  kills: 0,
  downed: 0,
  fights: new Set(),
  perFight: new Map(),
  biggestHit: null,
  biggestOverkill: null,
});

const better = (a: Best | null, b: Best | null): Best | null => {
  if (!a) return b;
  if (!b) return a;
  return b.value > a.value || (b.value === a.value && b.n < a.n) ? b : a;
};

/**
 * Adds facts to per-character tallies (FR-STATS-06–09, -12): dealt, healing, kills and hits roll
 * into a companion's current owner; taken and downs stay the PC's (OQ-STATS-12 A). Biggest
 * overkill per role: the DM's the overkill amount, a player's the callout line's `raw`.
 */
export function addTrophies(
  into: Map<string, TrophyTally>,
  facts: readonly StatsFact[],
  characters: ReadonlyMap<string, StatsCharacter>,
  role: StatsRole,
): void {
  const of = (side: StatsSide | null): TrophyTally | null => {
    const ch = side ? characterOf(side) : null;
    if (!ch || !characters.has(ch)) return null;
    let t = into.get(ch);
    if (!t) {
      t = trophyTally();
      into.set(ch, t);
    }
    return t;
  };
  for (const f of facts) {
    const a = of(f.attacker);
    const d = of(f.target);
    if (a) a.fights.add(f.encounterId);
    if (d) d.fights.add(f.encounterId);
    if (f.kind === "heal") {
      if (a) {
        a.healing += f.raw;
        const fight = a.perFight.get(f.encounterId) ?? { dealt: 0, kills: 0, healing: 0, n: f.n };
        fight.healing += f.raw;
        a.perFight.set(f.encounterId, fight);
      }
      continue;
    }
    if (a) {
      a.dealt += f.raw;
      const fight = a.perFight.get(f.encounterId) ?? { dealt: 0, kills: 0, healing: 0, n: f.n };
      fight.dealt += f.raw;
      if (isKill(f)) {
        a.kills += 1;
        fight.kills += 1;
      }
      a.perFight.set(f.encounterId, fight);
      const at = { to: f.targetName, encounterId: f.encounterId, n: f.n };
      if (f.raw > 0) a.biggestHit = better(a.biggestHit, { value: f.raw, ...at });
      const over = role === "dm" ? f.overkill : isCallout(f) ? f.raw : 0;
      if (over > 0) a.biggestOverkill = better(a.biggestOverkill, { value: over, ...at });
    }
    if (d && f.target.kind === "pc") {
      d.taken += f.raw;
      if (isDown(f)) d.downed += 1;
    }
  }
}

export function mergeTrophies(
  into: Map<string, TrophyTally>,
  from: ReadonlyMap<string, TrophyTally>,
): void {
  for (const [k, t] of from) {
    const x = into.get(k) ?? trophyTally();
    x.dealt += t.dealt;
    x.taken += t.taken;
    x.healing += t.healing;
    x.kills += t.kills;
    x.downed += t.downed;
    for (const e of t.fights) x.fights.add(e);
    for (const [e, f] of t.perFight) {
      const y = x.perFight.get(e) ?? { dealt: 0, kills: 0, healing: 0, n: f.n };
      y.dealt += f.dealt;
      y.kills += f.kills;
      y.healing += f.healing;
      y.n = Math.min(y.n, f.n);
      x.perFight.set(e, y);
    }
    x.biggestHit = better(x.biggestHit, t.biggestHit);
    x.biggestOverkill = better(x.biggestOverkill, t.biggestOverkill);
    into.set(k, x);
  }
}

/** FR-STATS-42: Lifetime + Records for one character (`fightLabel`: the viewer's label). */
export function trophyCase(
  t: TrophyTally | undefined,
  luck: LuckTally | undefined,
  fightLabel: (encounterId: string) => string,
): { lifetime: TrophyLifetime; records: TrophyRecords } {
  const x = t ?? trophyTally();
  const l = luck ?? luckTally();
  const bestFight = (field: "dealt" | "kills") => {
    let best: { value: number; encounterId: string; n: number } | null = null;
    for (const [encounterId, f] of x.perFight) {
      const v = f[field];
      if (v > 0 && (!best || v > best.value || (v === best.value && f.n < best.n))) {
        best = { value: v, encounterId, n: f.n };
      }
    }
    return best ? { value: best.value, fight: fightLabel(best.encounterId) } : null;
  };
  const record = (b: Best | null) =>
    b ? { value: b.value, to: b.to, fight: fightLabel(b.encounterId) } : null;
  return {
    lifetime: {
      avgD20: avgOf(l),
      nat20: l.nat20,
      nat1: l.nat1,
      fights: x.fights.size,
      dealt: x.dealt,
      taken: x.taken,
      healing: x.healing,
      kills: x.kills,
      downed: x.downed,
    },
    records: {
      "biggest-hit": record(x.biggestHit),
      "biggest-overkill": record(x.biggestOverkill),
      "best-fight-damage": bestFight("dealt"),
      "best-fight-kills": bestFight("kills"),
    },
  };
}
