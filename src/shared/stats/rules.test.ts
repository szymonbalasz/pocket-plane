// Stats formulas (STATS §13 unit): FR-STATS-06–13, -21, -25 on hand-built facts.
import { describe, expect, test } from "bun:test";
import { isOverkillCallout } from "./callout";
import {
  AWARD_UNSEEN,
  creditsParty,
  extendSessions,
  fightRows,
  rollsForParty,
  type SessionBounds,
  type StatsCharacter,
  type StatsFact,
  type StatsRoll,
  type StatsSide,
  sessionAwards,
  sessionOf,
  type UnseenKind,
  unseenKindsOf,
  visibleSpan,
} from "./rules";
import {
  AWARD_KEYS,
  AwardDetail,
  FIGHT_ROWS_MAX,
  SESSION_GAP_MS,
  SessionAwards,
  TIED_MAX,
} from "./schemas";

const side = (id: string, o: Partial<StatsSide> = {}): StatsSide => ({
  id,
  name: id,
  kind: "monster",
  entityId: `def-${id}`,
  ownerCharacterId: null,
  hidden: false,
  ownerHidden: false,
  active: true,
  ...o,
});
const pc = (name: string) => side(name, { kind: "pc", entityId: `ch-${name}` });
const MIRA = pc("Mira");
const THORN = pc("Thorn");
const OWLBEAR = side("Owlbear", { ownerCharacterId: "ch-Mira" });
const GOBLIN = side("Goblin");

let n = 0;
const fact = (
  attacker: StatsSide | null,
  target: StatsSide,
  raw: number,
  o: Partial<StatsFact> = {},
): StatsFact => {
  const hpBefore = o.hpBefore ?? 20;
  const absorbed = o.absorbed ?? 0;
  const kind = o.kind ?? "damage";
  const hpAfter =
    kind === "damage" ? Math.max(0, hpBefore - Math.max(0, raw - absorbed)) : hpBefore + raw;
  return {
    encounterId: "e1",
    n: ++n,
    kind,
    raw,
    applied: Math.abs(hpBefore - hpAfter),
    overkill: kind === "damage" ? Math.max(0, raw - absorbed - hpBefore) : 0,
    hpBefore,
    hpAfter,
    absorbed,
    attacker,
    attackerName: attacker?.name ?? null,
    target,
    targetName: target.name,
    ...o,
  };
};

const chars: Map<string, StatsCharacter> = new Map([
  ["ch-Mira", { id: "ch-Mira", name: "Mira", playerId: "p1" }],
  ["ch-Thorn", { id: "ch-Thorn", name: "Thorn", playerId: "p2" }],
]);
const awards = (
  facts: StatsFact[],
  rolls: StatsRoll[] = [],
  role: "dm" | "player" = "dm",
  characters = chars,
) => {
  const out = sessionAwards({ role, facts, rolls, characters, fightLabel: () => "Fight 1" });
  return Object.fromEntries(out.map((a) => [a.key, a]));
};
const rowsBy = <R extends { name: string }>(rows: R[]) =>
  Object.fromEntries(rows.map((r) => [r.name, r])) as Record<string, R>;

describe("STATS formulas", () => {
  test("FR-STATS-06 raw dealt / taken: the line's number incl. absorbed temp; no source → DM (direct)", () => {
    const facts = [
      fact(THORN, GOBLIN, 30, { hpBefore: 7 }),
      fact(GOBLIN, MIRA, 8, { hpBefore: 12, absorbed: 3 }),
      fact(null, GOBLIN, 5, { hpBefore: 0 }),
    ];
    const dm = rowsBy(fightRows("dm", facts, [MIRA, THORN, GOBLIN]));
    expect(dm.Thorn).toMatchObject({ dealt: 30, effective: { dealt: 7 } });
    expect(dm.Mira).toMatchObject({ taken: 8, effective: { taken: 8 } });
    expect(dm.Goblin).toMatchObject({ dealt: 8, taken: 35 });
    expect(dm["DM (direct)"]).toMatchObject({ kind: "special", dealt: 5 });
    const player = rowsBy(fightRows("player", facts, [MIRA, THORN, GOBLIN]));
    expect(Object.keys(player).sort()).toEqual(["Mira", "Thorn"]);
    expect(player.Thorn).toEqual({
      key: "Thorn",
      name: "Thorn",
      dealt: 30,
      taken: 0,
      healed: 0,
      kills: 1,
      kind: "pc",
    });
  });

  test("FR-STATS-07 heal raw to the source; overheal counts; no source → Unattributed (DM only)", () => {
    const facts = [
      fact(THORN, MIRA, 8, { kind: "heal", hpBefore: 9 }),
      fact(null, MIRA, 4, { kind: "heal", hpBefore: 12, applied: 0 }),
    ];
    facts[0] = { ...(facts[0] as StatsFact), applied: 3 };
    const dm = rowsBy(fightRows("dm", facts, [MIRA, THORN]));
    expect(dm.Thorn).toMatchObject({ healed: 8, effective: { healed: 3 } });
    expect(dm.Unattributed).toMatchObject({ kind: "special", healed: 4 });
    expect(rowsBy(fightRows("player", facts, [MIRA, THORN])).Unattributed).toBeUndefined();
    const a = awards(facts);
    expect(a["most-healing"]).toMatchObject({ value: 8, winners: [{ name: "Thorn" }] });
  });

  test("FR-STATS-08 kill, down, revive: again after a revive; companions at 0 are neither", () => {
    const facts = [
      fact(THORN, GOBLIN, 7, { hpBefore: 7 }),
      fact(THORN, GOBLIN, 3, { hpBefore: 0 }),
      fact(null, GOBLIN, 5, { kind: "heal", hpBefore: 0 }),
      fact(THORN, GOBLIN, 9, { hpBefore: 5 }),
      fact(GOBLIN, MIRA, 15, { hpBefore: 12 }),
      fact(GOBLIN, OWLBEAR, 40, { hpBefore: 30 }),
    ];
    const dm = rowsBy(fightRows("dm", facts, [MIRA, THORN, GOBLIN, OWLBEAR]));
    expect(dm.Thorn?.kills).toBe(2);
    expect(dm.Goblin?.kills).toBe(0);
    expect(dm.Mira?.downs).toBe(1);
    expect(dm.Owlbear?.downs).toBe(0);
    expect(awards(facts)["most-downed"]).toMatchObject({ value: 1, winners: [{ name: "Mira" }] });
  });

  test("FR-STATS-08 overkill with absorbed temp: raw − absorbed − hpBefore", () => {
    const f = fact(THORN, GOBLIN, 30, { hpBefore: 7, absorbed: 5 });
    expect(f.overkill).toBe(18);
    expect(rowsBy(fightRows("dm", [f], [THORN, GOBLIN])).Thorn?.dealt).toBe(30);
    expect(awards([f])["biggest-overkill"]?.value).toBe(18);
  });

  test("FR-STATS-10 nat rules: kept natural 20 / 1 per character; never initiative; death saves count", () => {
    const rolls: StatsRoll[] = [
      { natural: 20, category: "attack", actorKind: "entity", actorId: "ch-Thorn" },
      { natural: 20, category: "initiative", actorKind: "entity", actorId: "ch-Thorn" },
      { natural: 20, category: "saving-throw", actorKind: "entity", actorId: "ch-Mira" },
      { natural: 1, category: "saving-throw", actorKind: "entity", actorId: "ch-Mira" },
      { natural: 20, category: "attack", actorKind: "player", actorId: "p1" },
      { natural: 20, category: "attack", actorKind: "entity", actorId: "def-Goblin" },
      { natural: 19, category: "attack", actorKind: "entity", actorId: "ch-Thorn" },
    ];
    const a = awards([], rolls);
    expect(a["most-nat20"]).toMatchObject({ value: 1 });
    expect(a["most-nat20"]?.winners.map((w) => w.name).sort()).toEqual(["Mira", "Thorn"]);
    expect(a["most-nat1"]).toMatchObject({ value: 1, winners: [{ name: "Mira" }] });
  });

  test("FR-STATS-11 maxed die via raw: a maxed damage counts only through the applied number", () => {
    // A Combat-gem maxed card applies its maxed total as the line's `raw` (S2): no other stat.
    const a = awards([fact(THORN, GOBLIN, 24, { hpBefore: 7 })]);
    expect(a["biggest-hit"]).toMatchObject({ value: 24 });
    expect(a["most-dealt"]).toMatchObject({ value: 24 });
    expect(Object.keys(a)).toHaveLength(9);
  });

  test("FR-STATS-12 ties and zero: ties list all (≤ 8, `more`), zero is an empty line", () => {
    const many = new Map(chars);
    const facts: StatsFact[] = [];
    for (let i = 0; i < 10; i++) {
      const p = pc(`P${i}`);
      many.set(p.entityId, { id: p.entityId, name: p.name, playerId: null });
      facts.push(fact(p, GOBLIN, 5));
    }
    const a = awards(facts, [], "dm", many);
    expect(a["most-dealt"]?.winners).toHaveLength(TIED_MAX);
    expect(a["most-dealt"]?.more).toBe(2);
    expect(a["most-healing"]).toEqual({ key: "most-healing", value: null, winners: [] });
    // Companions roll into the current owner: "Mira + Owlbear".
    const b = awards([fact(OWLBEAR, GOBLIN, 9), fact(MIRA, GOBLIN, 2), fact(THORN, GOBLIN, 10)]);
    expect(b["most-dealt"]).toMatchObject({
      value: 11,
      winners: [{ name: "Mira", with: ["Owlbear"] }],
    });
    expect(b["biggest-hit"]).toMatchObject({ value: 10, winners: [{ name: "Thorn" }] });
  });

  test("FR-STATS-12 BL-111 creditsParty: a counted damage line by a PC or a companion's owner", () => {
    const has = (f: StatsFact) => creditsParty(f, chars);
    expect(has(fact(MIRA, GOBLIN, 11))).toBe(true);
    // A companion rolls into its current owner (FR-STATS-09): its hidden damage counts too.
    expect(has(fact(OWLBEAR, GOBLIN, 7))).toBe(true);
    expect(has(fact(GOBLIN, MIRA, 9))).toBe(false);
    expect(has(fact(null, GOBLIN, 3))).toBe(false);
    expect(has(fact(MIRA, GOBLIN, 8, { kind: "heal" }))).toBe(false);
    expect(has(fact(MIRA, GOBLIN, 0))).toBe(false);
    // A charmed-away companion (no owner) is a monster; a PC no longer in the campaign: none.
    expect(has(fact(side("Owlbear", { ownerCharacterId: null }), GOBLIN, 7))).toBe(false);
    expect(has(fact(pc("Gone"), GOBLIN, 7))).toBe(false);
  });

  test("FR-STATS-12 BL-121 unseenKindsOf: dealt (party damage), healed (party healing), taken (damage to a party PC); existence only", () => {
    const kinds = (f: StatsFact) => unseenKindsOf(f, chars);
    expect(kinds(fact(MIRA, GOBLIN, 11))).toEqual(["dealt"]);
    // Kill or not, big or small: the same answer (never the outcome or the amount).
    expect(kinds(fact(MIRA, GOBLIN, 30, { hpBefore: 4 }))).toEqual(["dealt"]);
    expect(kinds(fact(OWLBEAR, GOBLIN, 7))).toEqual(["dealt"]);
    expect(kinds(fact(GOBLIN, MIRA, 9))).toEqual(["taken"]);
    expect(kinds(fact(THORN, MIRA, 9))).toEqual(["dealt", "taken"]);
    expect(kinds(fact(null, THORN, 9))).toEqual(["taken"]);
    // Damage to a companion is no PC's taken (OQ-STATS-12 A).
    expect(kinds(fact(GOBLIN, OWLBEAR, 9))).toEqual([]);
    expect(kinds(fact(THORN, MIRA, 8, { kind: "heal" }))).toEqual(["healed"]);
    expect(kinds(fact(OWLBEAR, MIRA, 8, { kind: "heal" }))).toEqual(["healed"]);
    expect(kinds(fact(null, MIRA, 8, { kind: "heal" }))).toEqual([]);
    expect(kinds(fact(GOBLIN, side("Wolf"), 8))).toEqual([]);
    expect(kinds(fact(MIRA, GOBLIN, 0))).toEqual([]);
    expect(kinds(fact(pc("Gone"), GOBLIN, 7))).toEqual([]);
    // Rolls: a party character's kept d20 (any face), not initiative.
    const r = (o: Partial<StatsRoll>): StatsRoll => ({
      natural: 7,
      category: "check",
      actorKind: "entity",
      actorId: "ch-Mira",
      ...o,
    });
    expect(rollsForParty(r({}), chars)).toBe(true);
    expect(rollsForParty(r({ natural: 20 }), chars)).toBe(true);
    expect(rollsForParty(r({ natural: null }), chars)).toBe(false);
    expect(rollsForParty(r({ category: "initiative" }), chars)).toBe(false);
    expect(rollsForParty(r({ actorKind: "dm", actorId: null }), chars)).toBe(false);
    expect(rollsForParty(r({ actorId: "def-Goblin" }), chars)).toBe(false);
  });

  test("FR-STATS-12 BL-121 sim-15 Most kills: DM Thorn 3; players saw Mira 2 / Thorn 2 → withheld for players with every damage award", () => {
    const hidden = fact(THORN, side("Elite", { hidden: true }), 12, { hpBefore: 6 });
    const dmFacts = [
      fact(MIRA, side("G1"), 9, { hpBefore: 5 }),
      fact(THORN, side("G2"), 9, { hpBefore: 5 }),
      fact(MIRA, side("G3"), 9, { hpBefore: 5 }),
      hidden,
      fact(THORN, side("G4"), 9, { hpBefore: 5 }),
      fact(GOBLIN, MIRA, 4),
      fact(THORN, MIRA, 3, { kind: "heal" }),
    ];
    const seen = dmFacts.filter((f) => f !== hidden);
    const run = (role: "dm" | "player", facts: StatsFact[], unseen?: Set<UnseenKind>) =>
      Object.fromEntries(
        sessionAwards({
          role,
          facts,
          rolls: [],
          characters: chars,
          fightLabel: () => "F",
          unseen,
        }).map((a) => [a.key, a]),
      );
    expect(run("dm", dmFacts)["most-kills"]).toMatchObject({
      value: 3,
      winners: [{ name: "Thorn" }],
    });
    // The glitch: from the visible facts alone, players' winners differ from the DM's.
    expect(run("player", seen)["most-kills"]?.winners.map((w) => w.name)).toEqual([
      "Mira",
      "Thorn",
    ]);
    // The fix: the hidden line's kinds withhold every award it could change.
    const unseen = new Set(unseenKindsOf(hidden, chars));
    const player = run("player", seen, unseen);
    expect(Object.keys(player)).toEqual([
      "most-taken",
      "most-healing",
      "most-nat20",
      "most-nat1",
      "most-downed",
    ]);
    expect(player["most-taken"]).toMatchObject({ value: 4, winners: [{ name: "Mira" }] });
    expect(player["most-healing"]).toMatchObject({ value: 3, winners: [{ name: "Thorn" }] });
  });

  test("FR-STATS-12 BL-121 each kind withholds exactly its awards, in card order; the schema takes any such subset", () => {
    const facts = [fact(THORN, GOBLIN, 30), fact(MIRA, GOBLIN, 12)];
    const keys = (unseen: UnseenKind[]) =>
      sessionAwards({
        role: "player",
        facts,
        rolls: [],
        characters: chars,
        fightLabel: () => "Fight 1",
        unseen: new Set(unseen),
      }).map((a) => a.key);
    const summary = { fromN: 1, toN: 9, from: "a", to: "b", fights: 1 };
    for (const k of ["dealt", "healed", "taken", "rolled"] as const) {
      const out = keys([k]);
      expect(out).toEqual(AWARD_KEYS.filter((a) => AWARD_UNSEEN[a] !== k));
      const awards = sessionAwards({
        role: "player",
        facts,
        rolls: [],
        characters: chars,
        fightLabel: () => "Fight 1",
        unseen: new Set([k]),
      });
      expect(SessionAwards.safeParse({ ...summary, awards }).success).toBe(true);
    }
    expect(keys(["dealt"])).toEqual([
      "most-taken",
      "most-healing",
      "most-nat20",
      "most-nat1",
      "most-downed",
    ]);
    expect(keys(["rolled"])).not.toContain("most-nat20");
    expect(keys(["dealt", "healed", "taken", "rolled"])).toEqual([]);
    expect(keys([])).toEqual([...AWARD_KEYS]);
    // Out of card order or twice → not an ack.
    const all = sessionAwards({
      role: "dm",
      facts,
      rolls: [],
      characters: chars,
      fightLabel: () => "F",
    });
    expect(SessionAwards.safeParse({ ...summary, awards: [...all].reverse() }).success).toBe(false);
    expect(SessionAwards.safeParse({ ...summary, awards: [all[0], all[0]] }).success).toBe(false);
    expect(SessionAwards.safeParse({ ...summary, awards: [] }).success).toBe(true);
  });

  test("FR-STATS-12 overkill value per role: DM the amount; players the callout line's raw", () => {
    const facts = [
      fact(THORN, GOBLIN, 30, { hpBefore: 7 }), // callout, overkill 23
      fact(MIRA, side("Wolf"), 25, { hpBefore: 1 }), // overkill 24, callout too
      fact(MIRA, side("Ogre"), 9, { hpBefore: 6 }), // overkill 3, no callout
    ];
    const dm = awards(facts, [], "dm")["biggest-overkill"];
    expect(dm).toMatchObject({ value: 24, winners: [{ name: "Mira" }], detail: { raw: 25 } });
    const player = awards(facts, [], "player")["biggest-overkill"];
    expect(player).toMatchObject({ value: 30, winners: [{ name: "Thorn" }], detail: { raw: 30 } });
    // No `raw − value` for a player: the value is the raw itself.
    expect(player?.value).toBe(player?.detail?.raw);
    expect(Object.keys(AwardDetail.shape).sort()).toEqual(["fight", "from", "raw", "to"]);
  });

  test("FR-STATS-13 6 h gap: a gap of exactly 6 h starts a session, one minute less doesn't", () => {
    const t0 = Date.parse("2026-10-20T19:00:00Z");
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    const sessions: SessionBounds[] = [];
    extendSessions(sessions, [
      { n: 1, at: at(0), public: false, feature: null },
      { n: 2, at: at(60_000), public: true, feature: null },
      { n: 3, at: at(60_000 + SESSION_GAP_MS - 60_000), public: true, feature: null },
    ]);
    expect(sessions).toHaveLength(1);
    extendSessions(sessions, [
      { n: 4, at: at(SESSION_GAP_MS * 2), public: true, feature: "gems" },
      { n: 5, at: at(SESSION_GAP_MS * 2 + 1000), public: false, feature: null },
    ]);
    expect(sessions.map((s) => [s.fromN, s.toN])).toEqual([
      [1, 3],
      [4, 5],
    ]);
    // Players' times are clipped to public entries; the key stays the unclipped `fromN`.
    const first = sessions[0] as SessionBounds;
    expect(visibleSpan(first, "player", [])).toMatchObject({ fromN: 2, from: at(60_000) });
    expect(visibleSpan(first, "dm", [])).toMatchObject({ fromN: 1, from: at(0) });
    const second = sessions[1] as SessionBounds;
    expect(visibleSpan(second, "player", [])).toBeNull();
    expect(visibleSpan(second, "player", ["gems"])).toMatchObject({ fromN: 4 });
    expect(sessionOf(sessions, 2)).toBe(first);
    expect(sessionOf(sessions, 5)).toBe(second);
    expect(sessionOf(sessions, 9)).toBeUndefined();
  });

  test("FR-STATS-21 threshold: overkill ≥ max(10, needed) at 0 HP; one below → none", () => {
    expect(isOverkillCallout({ hpBefore: 7, hpAfter: 0, overkill: 10, absorbed: 0 })).toBe(true);
    expect(isOverkillCallout({ hpBefore: 7, hpAfter: 0, overkill: 9, absorbed: 0 })).toBe(false);
    expect(isOverkillCallout({ hpBefore: 15, hpAfter: 0, overkill: 15, absorbed: 0 })).toBe(true);
    expect(isOverkillCallout({ hpBefore: 15, hpAfter: 0, overkill: 14, absorbed: 0 })).toBe(false);
    // Temp HP absorbed counts in "needed": 7 HP + 5 temp → 12.
    expect(isOverkillCallout({ hpBefore: 7, hpAfter: 0, overkill: 11, absorbed: 5 })).toBe(false);
    expect(isOverkillCallout({ hpBefore: 7, hpAfter: 0, overkill: 12, absorbed: 5 })).toBe(true);
    expect(isOverkillCallout({ hpBefore: 7, hpAfter: 1, overkill: 30, absorbed: 0 })).toBe(false);
  });

  test("FR-STATS-25 limits: ≤ 70 fight rows", () => {
    const sides = Array.from({ length: 80 }, (_, i) => side(`m${i}`));
    const facts = sides.map((s) => fact(s, MIRA, 1));
    expect(fightRows("dm", facts, sides)).toHaveLength(FIGHT_ROWS_MAX);
  });

  test("FR-STATS-09 companion rows sit under the current owner; a charmed-away one is a monster", () => {
    const facts = [fact(OWLBEAR, GOBLIN, 9), fact(THORN, GOBLIN, 12)];
    const rows = fightRows("player", facts, [MIRA, THORN, OWLBEAR, GOBLIN]);
    expect(rows.map((r) => r.name)).toEqual(["Thorn", "Mira", "Owlbear"]);
    expect(rows[2]).toMatchObject({ kind: "companion", ownerKey: "Mira", dealt: 9 });
    const charmed = side("Owlbear", { ownerCharacterId: null });
    const after = [fact(charmed, GOBLIN, 9), fact(THORN, GOBLIN, 12)];
    expect(fightRows("player", after, [MIRA, THORN, charmed]).map((r) => r.name)).toEqual([
      "Thorn",
      "Mira",
    ]);
    expect(awards(after)["most-dealt"]).toMatchObject({ value: 12, winners: [{ name: "Thorn" }] });
  });
});
