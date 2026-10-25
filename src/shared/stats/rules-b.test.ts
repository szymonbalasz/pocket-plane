// Stats tier B formulas (STATS §13.1 unit): FR-STATS-26, -27, -31, -32, -38, -39, -42, -48 on
// hand-built facts and rolls.
import { describe, expect, test } from "bun:test";
import { fellOf } from "./callout";
import { feedText } from "./feed";
import type { StatsCharacter, StatsSide, UnseenKind } from "./rules";
import {
  addLuck,
  addTrophies,
  fightHighlights,
  type LineFact,
  type LuckRoll,
  type LuckTally,
  luckRows,
  mergeLuck,
  mergeTrophies,
  type TrophyTally,
  trophyCase,
} from "./rules-b";
import {
  DM_DICE_KEY,
  DmHighlights,
  DmLuckRow,
  FELL_LIST_MAX,
  PlayerHighlights,
  PlayerLuckRow,
  TrophiesResult,
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
const GOBLIN2 = side("Goblin 2");
const WOLF = side("Wolf", { hidden: true });

let n = 0;
const fact = (
  attacker: StatsSide | null,
  target: StatsSide,
  raw: number,
  o: Partial<LineFact> = {},
): LineFact => {
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
    public: true,
    ...o,
  };
};
const roll = (actorId: string | null, o: Partial<LuckRoll> = {}): LuckRoll => ({
  natural: null,
  category: "attack",
  actorKind: actorId === null ? "dm" : "entity",
  actorId,
  d20: [10],
  hasD20: true,
  ...o,
});

const chars: Map<string, StatsCharacter> = new Map([
  ["ch-Mira", { id: "ch-Mira", name: "Mira", playerId: "p1" }],
  ["ch-Thorn", { id: "ch-Thorn", name: "Thorn", playerId: "p2" }],
]);
const build = (
  role: "dm" | "player",
  facts: LineFact[],
  rolls: LuckRoll[],
  standing: { id: string; name: string; hidden: boolean }[],
) =>
  fightHighlights({
    role,
    facts,
    rolls,
    characters: chars,
    round: 3,
    span: { from: "2026-10-20T19:00:00.000Z", to: "2026-10-20T19:01:01.000Z" },
    standing,
  });
const dmHighlights = (
  facts: LineFact[],
  rolls: LuckRoll[] = [],
  standing: { id: string; name: string; hidden: boolean }[] = [],
) => DmHighlights.parse(build("dm", facts, rolls, standing));
const highlights = (_role: "player", facts: LineFact[], rolls: LuckRoll[] = []) =>
  PlayerHighlights.parse(build("player", facts, rolls, []));

describe("FR-STATS-26 kill / down", () => {
  test("FR-STATS-26 kill on a non-companion monster, down on a PC or companion, whoever the attacker", () => {
    expect(fellOf(GOBLIN, { hpBefore: 5, hpAfter: 0 })).toBe("kill");
    expect(fellOf(MIRA, { hpBefore: 5, hpAfter: 0 })).toBe("down");
    expect(fellOf(OWLBEAR, { hpBefore: 5, hpAfter: 0 })).toBe("down");
    expect(fellOf(GOBLIN, { hpBefore: 0, hpAfter: 0 })).toBeNull();
    expect(fellOf(GOBLIN, { hpBefore: 5, hpAfter: 1 })).toBeNull();
  });
});

describe("FR-STATS-27 feed text", () => {
  test("FR-STATS-27 feed text per role: names from the line; the DM adds the overkill and (hidden)", () => {
    expect(feedText({ fell: "kill", from: "Thorn", to: "Goblin 1", callout: false })).toBe(
      "Thorn finished Goblin 1",
    );
    expect(feedText({ fell: "kill", from: null, to: "Goblin 1", callout: false })).toBe(
      "Goblin 1 falls",
    );
    expect(feedText({ fell: "down", from: "Goblin 2", to: "Brakka", callout: false })).toBe(
      "Goblin 2 dropped Brakka",
    );
    expect(feedText({ fell: "down", from: null, to: "Brakka", callout: false })).toBe(
      "Brakka is down",
    );
    const player = { fell: "kill" as const, from: "Thorn", to: "Bandit 4", callout: true };
    expect(feedText(player)).toBe("Overkill! Thorn finished Bandit 4");
    expect(feedText({ ...player, overkill: 14 })).toBe(
      "Overkill! Thorn finished Bandit 4, overkill 14",
    );
    expect(feedText({ ...player, from: "Thorn", to: "Elite", callout: false, hidden: true })).toBe(
      "Thorn finished Elite (hidden)",
    );
    // A callout on a target already down keeps FR-STATS-22's text.
    expect(feedText({ from: "Thorn", to: "Goblin 1", callout: true, damage: 30 })).toBe(
      "Overkill! Thorn → Goblin 1: 30 damage",
    );
  });
});

describe("FR-STATS-31 highlights", () => {
  const facts = () => [
    fact(THORN, GOBLIN, 30, { hpBefore: 7 }), // callout, overkill 23, kill
    fact(OWLBEAR, GOBLIN2, 9, { hpBefore: 9 }), // kill, rolls into Mira
    fact(MIRA, GOBLIN2, 4, { hpBefore: 0 }), // no second kill
    fact(GOBLIN, MIRA, 15, { hpBefore: 12 }), // down
    fact(WOLF, THORN, 6, { public: false }), // hidden attacker: DM only (filtered for players)
    fact(null, WOLF, 30, { hpBefore: 11, public: false }), // DM direct kill on the hidden Wolf
    fact(MIRA, MIRA, 5, { kind: "heal", hpBefore: 0 }),
  ];
  const playerFacts = () => facts().filter((f) => f.public);

  test("FR-STATS-31 per role: the DM's include monsters, hidden marks, overkill amount and Still standing", () => {
    const dm = dmHighlights(facts(), [], [{ id: "c-x", name: "Goblin 3", hidden: false }]);
    expect(dm.mvp).toMatchObject({ value: 30, winners: [{ key: "ch-Thorn", hidden: false }] });
    expect(dm["biggest-hit"]).toMatchObject({ value: 30, detail: { from: "Thorn", raw: 30 } });
    expect(dm["biggest-overkill"]).toMatchObject({ value: 23, winners: [{ name: "Thorn" }] });
    expect(dm["most-healing"]).toMatchObject({ value: 5, winners: [{ name: "Mira" }] });
    expect(dm.kills.events.map((e) => [e.from, e.to, e.callout, e.hidden])).toEqual([
      ["Thorn", "Goblin", true, false],
      ["Owlbear", "Goblin 2", false, false],
      [null, "Wolf", true, true],
    ]);
    expect(dm.kills.events[0]).toMatchObject({ overkill: 23 });
    expect(dm.downed.events).toEqual([
      { fell: "down", from: "Goblin", to: "Mira", callout: false, hidden: false },
    ]);
    expect(dm.standing).toEqual([{ key: "c-x", name: "Goblin 3", hidden: false }]);
    expect(dm.rounds).toBe(3);
    expect(dm.duration).toBe(61_000);
  });

  test("FR-STATS-31 per role: players get party winners only, the callout raw as Biggest overkill, no amount", () => {
    const p = highlights("player", playerFacts());
    expect(p.mvp).toMatchObject({ value: 30, winners: [{ key: "ch-Thorn", name: "Thorn" }] });
    expect(p["biggest-overkill"]).toMatchObject({ value: 30, detail: { raw: 30 } });
    expect(p.kills.events).toEqual([
      { fell: "kill", from: "Thorn", to: "Goblin", callout: true },
      { fell: "kill", from: "Owlbear", to: "Goblin 2", callout: false },
    ]);
    const json = JSON.stringify(p);
    for (const leak of ['"hidden"', '"standing"', '"overkill"', "Wolf"]) {
      expect(json).not.toContain(leak);
    }
  });

  test("FR-STATS-12 BL-111 BL-121 unseen dealt: players' MVP, Biggest hit and Biggest overkill are empty (the items hide); the rest stays", () => {
    const run = (unseen: UnseenKind[]) =>
      PlayerHighlights.parse(
        fightHighlights({
          role: "player",
          facts: [...playerFacts(), fact(THORN, MIRA, 6, { kind: "heal" })],
          rolls: [roll("ch-Mira", { natural: 20 })],
          characters: chars,
          round: 3,
          span: null,
          standing: [],
          unseen: new Set(unseen),
        }),
      );
    const empty = { value: null, winners: [] };
    const p = run(["dealt"]);
    expect(p.mvp).toEqual(empty);
    expect(p["biggest-hit"]).toEqual(empty);
    expect(p["biggest-overkill"]).toEqual(empty);
    expect(p["most-healing"]).toMatchObject({ value: 6, winners: [{ name: "Thorn" }] });
    expect(p.nat20).toMatchObject({ value: 1, winners: [{ name: "Mira" }] });
    // Kills / downs are events the players saw, not awards: unchanged.
    expect(p.kills.events).toHaveLength(2);
    expect(run(["healed"])["most-healing"]).toEqual(empty);
    expect(run(["healed"])["biggest-hit"]).toMatchObject({ value: 30 });
    expect(run(["rolled"]).nat20).toEqual(empty);
    expect(run(["rolled"]).nat1).toEqual(empty);
    expect(run(["rolled"]).mvp.value).not.toBeNull();
    // `taken` is no Highlights item (Times downed is the downs list).
    expect(run(["taken"])).toEqual(run([]));
  });

  test("FR-STATS-31 ties ≤ 8, zero = empty, companions roll into the owner (with)", () => {
    const p = highlights("player", [
      fact(MIRA, GOBLIN, 5),
      fact(OWLBEAR, GOBLIN, 5),
      fact(THORN, GOBLIN, 10),
    ]);
    expect(p.mvp.winners.map((w) => [w.name, w.with])).toEqual([
      ["Mira", ["Owlbear"]],
      ["Thorn", undefined],
    ]);
    expect(p["most-healing"]).toEqual({ value: null, winners: [] });
  });

  test("FR-STATS-32 nats: character rolls only, initiative out; the given rolls are the fight's", () => {
    const p = highlights(
      "player",
      [],
      [
        roll("ch-Thorn", { natural: 20 }),
        roll("ch-Thorn", { natural: 20, category: "saving-throw" }),
        roll("ch-Mira", { natural: 20, category: "initiative" }),
        roll("ch-Mira", { natural: 1 }),
        roll(null, { natural: 20 }),
      ],
    );
    expect(p.nat20).toMatchObject({ value: 2, winners: [{ name: "Thorn" }] });
    expect(p.nat1).toMatchObject({ value: 1, winners: [{ name: "Mira" }] });
  });

  test("FR-STATS-48 limits: ≤ 20 kills listed, then more", () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      fact(THORN, side(`G${i}`), 9, { hpBefore: 5 }),
    );
    const p = highlights("player", many);
    expect(p.kills.events).toHaveLength(FELL_LIST_MAX);
    expect(p.kills.more).toBe(3);
  });

  test("FR-STATS-35 a player's list never names a side hidden now", () => {
    const hiddenNow = side("Goblin 4", { hidden: true });
    const p = highlights("player", [fact(THORN, hiddenNow, 9, { hpBefore: 5 })]);
    expect(p.kills.events).toEqual([]);
    expect(JSON.stringify(p)).not.toContain("Goblin 4");
  });
});

describe("FR-STATS-38 luck formulas", () => {
  test("FR-STATS-38 every formula row: rolls, d20s (dropped too), avg 1 decimal, nats only from natural", () => {
    const t = new Map<string, LuckTally>();
    addLuck(
      t,
      [
        // Advantage 18 / 3: both faces, the kept 18 is no nat.
        roll("ch-Mira", { d20: [18, 3], natural: 18 }),
        roll("ch-Mira", { d20: [20], natural: 20 }),
        // `1d20+1d20`: two faces, no natural (FR-DICE-20).
        roll("ch-Mira", { d20: [1, 20], natural: null }),
        // Physical several-dice total: a roll, no faces.
        roll("ch-Mira", { d20: [], hasD20: true }),
        // Initiative and d20-less rolls don't count.
        roll("ch-Mira", { d20: [20], natural: 20, category: "initiative" }),
        roll("ch-Mira", { d20: [], hasD20: false, category: "damage" }),
      ],
      chars,
      "player",
    );
    const [mira] = luckRows(t, chars, "player");
    expect(mira).toEqual({
      key: "ch-Mira",
      name: "Mira",
      playerId: "p1",
      rolls: 4,
      d20s: 5,
      avg: 12.4,
      nat20: 1,
      nat1: 0,
    });
    expect(
      luckRows(new Map([["ch-Thorn", { ...mira, d20Sum: 0, d20s: 0 } as never]]), chars, "dm")[0]
        ?.avg,
    ).toBeNull();
  });

  test("FR-STATS-39 rows: party by name; DM dice for the DM only (DM, monster, token); a player's Me roll nowhere", () => {
    const rolls = [
      roll("ch-Thorn", { natural: 20 }),
      roll("ch-Mira"),
      roll(null, { natural: 20 }),
      roll("def-goblin", { natural: 1 }),
      roll("tok-1", { actorKind: "token" }),
      roll(null, { actorKind: "player", natural: 20 }),
    ];
    const dm = new Map<string, LuckTally>();
    addLuck(dm, rolls, chars, "dm");
    const rows = luckRows(dm, chars, "dm").map((r) => DmLuckRow.parse(r));
    expect(rows.map((r) => [r.key, r.rolls, r.nat20, r.nat1])).toEqual([
      ["ch-Mira", 1, 0, 0],
      ["ch-Thorn", 1, 1, 0],
      [DM_DICE_KEY, 3, 1, 1],
    ]);
    const p = new Map<string, LuckTally>();
    addLuck(p, rolls, chars, "player");
    const prow = luckRows(p, chars, "player");
    expect(prow.map((r) => r.key)).toEqual(["ch-Mira", "ch-Thorn"]);
    expect(() => PlayerLuckRow.parse({ ...rows[2] })).toThrow();
  });

  test("FR-STATS-46 tallies merge: two halves sum to the whole", () => {
    const rolls = [
      roll("ch-Mira", { d20: [4, 17], natural: 17 }),
      roll("ch-Mira", { natural: 1, d20: [1] }),
    ];
    const whole = new Map<string, LuckTally>();
    addLuck(whole, rolls, chars, "dm");
    const a = new Map<string, LuckTally>();
    const b = new Map<string, LuckTally>();
    addLuck(a, rolls.slice(0, 1), chars, "dm");
    addLuck(b, rolls.slice(1), chars, "dm");
    const merged = new Map<string, LuckTally>();
    mergeLuck(merged, a);
    mergeLuck(merged, b);
    expect(merged).toEqual(whole);
  });
});

describe("FR-STATS-42 trophies", () => {
  const label = (id: string) => `Fight ${id}`;

  test("FR-STATS-42 companion roll-up: dealt, kills and hits into the owner; taken and downs the PC's", () => {
    const t = new Map<string, TrophyTally>();
    addTrophies(
      t,
      [
        fact(MIRA, GOBLIN, 6, { encounterId: "a" }),
        fact(OWLBEAR, GOBLIN, 25, { hpBefore: 14, encounterId: "a" }), // kill, overkill 11 (callout)
        fact(GOBLIN, OWLBEAR, 8, { encounterId: "a" }), // taken by the companion: not Mira's
        fact(GOBLIN2, MIRA, 30, { hpBefore: 12, encounterId: "b" }), // Mira down
        fact(THORN, MIRA, 4, { kind: "heal", encounterId: "b", hpBefore: 0 }),
        fact(MIRA, GOBLIN2, 9, { hpBefore: 5, encounterId: "b" }), // kill, overkill 4
      ],
      chars,
      "dm",
    );
    const mira = trophyCase(t.get("ch-Mira"), undefined, label);
    expect(mira.lifetime).toEqual({
      avgD20: null,
      nat20: 0,
      nat1: 0,
      fights: 2,
      dealt: 40,
      taken: 30,
      healing: 0,
      kills: 2,
      downed: 1,
    });
    expect(mira.records).toEqual({
      "biggest-hit": { value: 25, to: "Goblin", fight: "Fight a" },
      "biggest-overkill": { value: 11, to: "Goblin", fight: "Fight a" },
      "best-fight-damage": { value: 31, fight: "Fight a" },
      "best-fight-kills": { value: 1, fight: "Fight a" },
    });
    const thorn = trophyCase(t.get("ch-Thorn"), undefined, label);
    expect(thorn.lifetime.healing).toBe(4);
    expect(thorn.records["biggest-hit"]).toBeNull();
    // BL-121: unseen party damage in the campaign withholds every record (no key, no row); the
    // Lifetime numbers stay. Other kinds withhold none.
    const withheld = trophyCase(t.get("ch-Mira"), undefined, label, new Set(["dealt"]));
    expect(withheld.records).toEqual({});
    expect(
      TrophiesResult.parse({ trophies: { characterId: "ch-Mira", ...withheld } }).trophies.records,
    ).toEqual({});
    expect(withheld.lifetime).toEqual(mira.lifetime);
    expect(
      trophyCase(t.get("ch-Mira"), undefined, label, new Set(["healed", "taken", "rolled"])),
    ).toEqual(mira);
  });

  test("FR-STATS-42 Biggest overkill per role: players the callout line's raw; merge keeps the best", () => {
    const facts = [
      fact(MIRA, GOBLIN, 25, { hpBefore: 11, encounterId: "a" }), // callout: overkill 14
      fact(MIRA, GOBLIN2, 9, { hpBefore: 5, encounterId: "b" }), // overkill 4, no callout
    ];
    const p = new Map<string, TrophyTally>();
    addTrophies(p, facts, chars, "player");
    expect(trophyCase(p.get("ch-Mira"), undefined, label).records["biggest-overkill"]).toEqual({
      value: 25,
      to: "Goblin",
      fight: "Fight a",
    });
    const a = new Map<string, TrophyTally>();
    const b = new Map<string, TrophyTally>();
    addTrophies(a, facts.slice(0, 1), chars, "dm");
    addTrophies(b, facts.slice(1), chars, "dm");
    const merged = new Map<string, TrophyTally>();
    mergeTrophies(merged, b);
    mergeTrophies(merged, a);
    const whole = new Map<string, TrophyTally>();
    addTrophies(whole, facts, chars, "dm");
    expect(trophyCase(merged.get("ch-Mira"), undefined, label)).toEqual(
      trophyCase(whole.get("ch-Mira"), undefined, label),
    );
  });
});
