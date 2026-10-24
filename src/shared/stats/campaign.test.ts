// Stats Campaign tab formulas (STATS §13.4 unit, sprint 10 T3): FR-STATS-82–84 and -87's ack
// limit on hand-built facts, rolls and awards.
import { describe, expect, test } from "bun:test";
import {
  type AwardWins,
  addWins,
  campaignAwards,
  campaignRecords,
  campaignRows,
  mergeWins,
} from "./campaign";
import { type StatsCharacter, type StatsFact, type StatsSide, sessionAwards } from "./rules";
import {
  addLuck,
  addTrophies,
  type LuckRoll,
  type LuckTally,
  mergeLuck,
  mergeTrophies,
  type TrophyTally,
} from "./rules-b";
import {
  ACK_MAX_BYTES,
  AWARD_KEYS,
  CAMPAIGN_ROWS_MAX,
  CampaignResult,
  type CampaignStats,
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
const OGRE = side("Ogre");

const CHARS: ReadonlyMap<string, StatsCharacter> = new Map([
  ["ch-Mira", { id: "ch-Mira", name: "Mira", playerId: "p1" }],
  ["ch-Thorn", { id: "ch-Thorn", name: "Thorn", playerId: "p2" }],
  ["ch-Brakka", { id: "ch-Brakka", name: "Brakka", playerId: "p1" }],
]);

let n = 0;
const fact = (
  encounterId: string,
  attacker: StatsSide | null,
  target: StatsSide,
  raw: number,
  o: Partial<StatsFact> = {},
): StatsFact => {
  const hpBefore = o.hpBefore ?? 20;
  const kind = o.kind ?? "damage";
  const hpAfter = kind === "damage" ? Math.max(0, hpBefore - raw) : hpBefore + raw;
  return {
    encounterId,
    n: ++n,
    kind,
    raw,
    applied: Math.abs(hpBefore - hpAfter),
    overkill: kind === "damage" ? Math.max(0, raw - hpBefore) : 0,
    hpBefore,
    hpAfter,
    absorbed: 0,
    attacker,
    attackerName: attacker?.name ?? null,
    target,
    targetName: target.name,
    ...o,
  };
};
const nat = (actorId: string, natural: number): LuckRoll => ({
  natural,
  category: "attack",
  actorKind: "entity",
  actorId,
  d20: [natural],
  hasD20: true,
});

/** Two sessions as the partials hold them, merged (the order the server merges in). */
function campaign(role: "dm" | "player", sessions: { facts: StatsFact[]; rolls: LuckRoll[] }[]) {
  const trophies = new Map<string, TrophyTally>();
  const luck = new Map<string, LuckTally>();
  const wins: AwardWins = new Map();
  for (const s of sessions) {
    const t = new Map<string, TrophyTally>();
    const l = new Map<string, LuckTally>();
    const w: AwardWins = new Map();
    addTrophies(t, s.facts, CHARS, role);
    addLuck(l, s.rolls, CHARS, role);
    addWins(
      w,
      sessionAwards({
        role,
        facts: s.facts,
        rolls: s.rolls,
        characters: CHARS,
        fightLabel: () => "",
      }),
    );
    mergeTrophies(trophies, t);
    mergeLuck(luck, l);
    mergeWins(wins, w);
  }
  return { trophies, luck, wins };
}

// Session 1, fight A: Thorn 30 → Goblin at 7 HP (callout, overkill 23); Mira 12 → Ogre; the
// Owlbear (Mira's) 9 → Ogre; Ogre 25 → Mira at 20 (down); Thorn heals Mira 6; nat 20 Thorn.
// Session 2, fight B: Mira 14 → Ogre at 14 (kill); Mira heals Thorn 10 and 5; nat 1 Mira, Thorn.
const S1 = () => ({
  facts: [
    fact("A", THORN, GOBLIN, 30, { hpBefore: 7 }),
    fact("A", MIRA, OGRE, 12, { hpBefore: 59 }),
    fact("A", OWLBEAR, OGRE, 9, { hpBefore: 47 }),
    fact("A", OGRE, MIRA, 25, { hpBefore: 20 }),
    fact("A", THORN, MIRA, 6, { kind: "heal", hpBefore: 0 }),
  ],
  rolls: [nat("ch-Thorn", 20)],
});
const S2 = () => ({
  facts: [
    fact("B", MIRA, OGRE, 14, { hpBefore: 14 }),
    fact("B", MIRA, THORN, 10, { kind: "heal" }),
    fact("B", MIRA, THORN, 5, { kind: "heal" }),
  ],
  rolls: [nat("ch-Mira", 1), nat("ch-Thorn", 1)],
});

describe("FR-STATS-82 party table", () => {
  test("FR-STATS-82 lifetime totals per character (Trophies' definitions): companions roll into the owner, taken / downs stay the PC's, zero rows dropped", () => {
    const c = campaign("dm", [S1(), S2()]);
    const rows = campaignRows(c.trophies, c.luck, CHARS);
    expect(
      rows.map((r) => [
        r.name,
        r.dealt,
        r.taken,
        r.healed,
        r.kills,
        r.downed,
        r.nat20,
        r.nat1,
        r.fights,
      ]),
    ).toEqual([
      // By Dealt: Mira 12 + 9 (Owlbear) + 14 = 35; Thorn 30.
      ["Mira", 35, 25, 15, 1, 1, 0, 1, 2],
      ["Thorn", 30, 0, 6, 1, 0, 1, 1, 2],
    ]);
    // Brakka has no fact and no roll: no row.
    expect(rows.some((r) => r.name === "Brakka")).toBe(false);
  });

  test("FR-STATS-82 ties on Dealt by name; ≤ 70 rows", () => {
    const many = new Map<string, StatsCharacter>();
    const facts: StatsFact[] = [];
    for (let i = 0; i < CAMPAIGN_ROWS_MAX + 5; i++) {
      const id = `ch-${String(i).padStart(3, "0")}`;
      many.set(id, { id, name: `Hero ${String(i).padStart(3, "0")}`, playerId: null });
      facts.push(fact("A", side(id, { kind: "pc", entityId: id }), GOBLIN, 5));
    }
    const t = new Map<string, TrophyTally>();
    addTrophies(t, facts, many, "dm");
    const rows = campaignRows(t, new Map(), many);
    expect(rows).toHaveLength(CAMPAIGN_ROWS_MAX);
    expect(rows[0]?.name).toBe("Hero 000");
  });
});

describe("FR-STATS-83 records", () => {
  test("FR-STATS-83 biggest hit, biggest overkill per role, most damage / kills / healing in one fight", () => {
    const fight = (e: string) => `Fight ${e}`;
    const dm = campaignRecords(campaign("dm", [S1(), S2()]).trophies, CHARS, fight);
    const at = (r: (typeof dm)["biggest-hit"]) => r && [r.name, r.value, r.to, r.fight];
    expect(Object.fromEntries(Object.entries(dm).map(([k, r]) => [k, at(r)]))).toEqual({
      "biggest-hit": ["Thorn", 30, "Goblin", "Fight A"],
      "biggest-overkill": ["Thorn", 23, "Goblin", "Fight A"],
      // Thorn's 30 in A beats Mira's 21 (12 + Owlbear 9) in A and 14 in B.
      "best-fight-damage": ["Thorn", 30, undefined, "Fight A"],
      // A tie at 1 kill: the earlier fact (Thorn's Goblin in A).
      "best-fight-kills": ["Thorn", 1, undefined, "Fight A"],
      "best-fight-healing": ["Mira", 15, undefined, "Fight B"],
    });
    // FR-STATS-12: a player's Biggest overkill is the callout line's raw (no amount).
    const player = campaignRecords(campaign("player", [S1(), S2()]).trophies, CHARS, fight);
    expect(player["biggest-overkill"]).toMatchObject({ name: "Thorn", value: 30, to: "Goblin" });
    expect(campaignRecords(new Map(), CHARS, fight)["biggest-hit"]).toBeNull();
  });
});

describe("FR-STATS-84 awards won", () => {
  test("FR-STATS-84 each session's winners count once per award; ties count for every winner; by total", () => {
    const c = campaign("dm", [S1(), S2()]);
    const rows = campaignAwards(c.wins, CHARS);
    expect(rows.map((r) => [r.name, r.total, r.won.map((w) => `${w.key}×${w.count}`)])).toEqual([
      [
        "Mira",
        7,
        // S1: taken, downed; S2: hit, dealt, healing, kills, nat 1 (tied with Thorn).
        [
          "biggest-hit×1",
          "most-dealt×1",
          "most-taken×1",
          "most-healing×1",
          "most-kills×1",
          "most-nat1×1",
          "most-downed×1",
        ],
      ],
      [
        "Thorn",
        7,
        // S1: hit, overkill, dealt, healing, kills, nat 20; S2: nat 1 (tie).
        [
          "biggest-hit×1",
          "biggest-overkill×1",
          "most-dealt×1",
          "most-healing×1",
          "most-kills×1",
          "most-nat20×1",
          "most-nat1×1",
        ],
      ],
    ]);
    // Card order (AWARD_KEYS) inside a row.
    for (const r of rows) {
      const order = r.won.map((w) => AWARD_KEYS.indexOf(w.key));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });
});

describe("FR-STATS-87 limits", () => {
  test("FR-STATS-87 a full campaign ack (70 rows, 70 award rows, 5 records, longest names) ≤ 64 KB", () => {
    const name = "N".repeat(120);
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const big: CampaignStats = {
      sessions: 200,
      fights: 800,
      slain: 99_999,
      rows: Array.from({ length: CAMPAIGN_ROWS_MAX }, (_, i) => ({
        key: id(i),
        name,
        playerId: id(i + 1000),
        dealt: 999_999,
        taken: 999_999,
        healed: 999_999,
        kills: 99_999,
        downed: 9_999,
        nat20: 9_999,
        nat1: 9_999,
        fights: 9_999,
      })),
      records: Object.fromEntries(
        [
          "biggest-hit",
          "biggest-overkill",
          "best-fight-damage",
          "best-fight-kills",
          "best-fight-healing",
        ].map((k) => [
          k,
          {
            value: 999_999,
            characterId: id(1),
            name,
            playerId: id(2),
            to: name,
            fight: "F".repeat(80),
          },
        ]),
      ) as CampaignStats["records"],
      awards: Array.from({ length: CAMPAIGN_ROWS_MAX }, (_, i) => ({
        key: id(i),
        name,
        playerId: id(i + 1000),
        total: 1800,
        won: AWARD_KEYS.map((key) => ({ key, count: 200 })),
      })),
    };
    const ack = CampaignResult.parse({ campaign: big });
    expect(JSON.stringify(ack).length).toBeLessThanOrEqual(ACK_MAX_BYTES);
  });
});
