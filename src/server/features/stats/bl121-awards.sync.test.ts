// Sprint 12 X2 (BL-121, DM #353) over real sockets on `stats`: for players, every stats award a
// hidden fact could change is withheld (Session cards, recap Awards, fight Highlights, Campaign
// records and awards won, Trophies records), exactly as BL-111 did for Most damage dealt; the DM
// keeps all. sim-15's case: public kills Thorn 2 / Mira 2, then the DM's hidden kill by Thorn (the
// DM's Most kills Thorn 3; players would see a Mira / Thorn tie). Leak scan per player: every
// award a player gets has the DM's value and winners (Biggest overkill is per role by design and
// withheld with the damage cards here), nothing hints that a card was withheld, no frame or ack
// carries the hidden lines; reconnect and restart answer the same.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CBT_INTENTS, COMBATANT_TYPE, type CombatantRecord } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { RECAP_QUERY_INTENT } from "@shared/session-recap/schemas";
import {
  type Award,
  type CampaignStats,
  type DmHighlightStat,
  STATS_QUERY_INTENT,
  type TrophiesResult,
} from "@shared/stats/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { ROLL } from "../dice-roll-log/commands";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];

/**
 * One intent → its ack's result (rejects fail the test). Stats queries keep under the per-viewer
 * rate (FR-STATS-16: ≤ 4 / s; over it a memo answers, possibly an older one), and a `conflict`
 * asks again 1 s later (FR-STATS-69).
 */
async function ask<R>(c: TestClient, name: string, payload: unknown): Promise<R> {
  for (;;) {
    if (name === STATS_QUERY_INTENT) await Bun.sleep(260);
    const id = c.intent(name, payload);
    for (;;) {
      const f = await c.next(undefined, 3000);
      if (f.type === "ack" && f.intentId === id) return f.result as R;
      if (f.type === "reject" && f.intentId === id) {
        // FR-STATS-69: over the per-viewer rate → `conflict`; asked again 1 s later.
        if (f.code === "conflict" && name === STATS_QUERY_INTENT) break;
        throw new Error(JSON.stringify(f));
      }
    }
    await Bun.sleep(1100);
  }
}

type Stat = Pick<DmHighlightStat, "value" | "more"> & { winners: { name: string }[] };
type Highlights = Record<"mvp" | "biggest-hit" | "most-healing" | "nat20" | "nat1", Stat> & {
  "biggest-overkill": Stat;
};
type Answers = {
  session: { session: { awards: Award[] } };
  fight: { fight: { key: string; highlights: Highlights } };
  recap: { recap: { awards?: Award[]; fights: { key: string; mvp: Stat }[] } };
  campaign: { campaign: CampaignStats };
  trophies: TrophiesResult[];
};

/** An award's comparable part: the number and who (FR-STATS-12). */
const said = (x: Stat | Award | undefined) =>
  x && { value: x.value, winners: x.winners.map((w) => w.name), more: x.more };

describe("BL-121 stats awards over WS (stats)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("stats", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    h = await startTestServer({ db, fake: false });
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-STATS-12 BL-121 players get no award a hidden fact could change; what they get is the DM's; no hint, no leak; reconnect and restart answer the same", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const named = (name: string) =>
      all<CombatantRecord>(dm, COMBATANT_TYPE).find(
        (c) => c.name === name && c.active && !c.removed,
      ) as CombatantRecord;
    const [thorn, mira, brakka, scout, scout2, elite] = [
      "Thorn",
      "Mira",
      "Brakka",
      "Goblin Scout",
      "Goblin Scout 2",
      "Elite Goblin Warrior",
    ].map(named) as CombatantRecord[];
    expect([scout2?.hidden, elite?.hidden]).toEqual([false, true]);
    const character = (name: string) =>
      all<{ id: string; name: string; kind: string }>(dm, ENTITY_TYPE).find(
        (e) => e.kind === "character" && e.name === name,
      )?.id as string;
    const hp = (
      target: CombatantRecord,
      kind: "damage" | "heal",
      amount: number,
      from?: CombatantRecord,
    ) =>
      ask(dm, CBT_INTENTS.applyHp, {
        combatantId: target.id,
        kind,
        amount,
        // A hidden side makes the line DM-only whatever this says (FR-CBT-24).
        public: true,
        ...(from ? { sourceId: from.id } : {}),
      });

    // Today's session (the fixture's is months back), all in sight: Goblin Scout hits Mira, kills
    // Thorn 2, Mira 2 (Goblin Scout 2 healed back between them), Brakka heals Mira, Mira's nat 20.
    await hp(mira as CombatantRecord, "damage", 3, scout);
    for (const by of [thorn, mira, mira, thorn] as CombatantRecord[]) {
      await hp(scout2 as CombatantRecord, "heal", 30);
      await hp(scout2 as CombatantRecord, "damage", 30, by);
    }
    await hp(mira as CombatantRecord, "heal", 4, brakka);
    await ask(p1, ROLL, {
      expression: "1d20+5",
      category: "attack",
      actor: { entityId: character("Mira") },
      manual: { diceTotal: 20 },
    });

    const answers = async (c: TestClient, own: string[]): Promise<Answers> => ({
      session: await ask(c, STATS_QUERY_INTENT, { scope: "session" }),
      fight: await ask(c, STATS_QUERY_INTENT, { scope: "fight" }),
      recap: await ask(c, RECAP_QUERY_INTENT, {}),
      campaign: await ask(c, STATS_QUERY_INTENT, { scope: "campaign" }),
      trophies: await own.reduce<Promise<TrophiesResult[]>>(
        async (acc, name) => [
          ...(await acc),
          await ask<TrophiesResult>(c, STATS_QUERY_INTENT, {
            scope: "trophies",
            characterId: character(name),
          }),
        ],
        Promise.resolve([]),
      ),
    });
    const OWN: Record<string, string[]> = { "Player 1": ["Mira", "Brakka"], "Player 2": ["Thorn"] };

    /**
     * Each player's answers against the DM's: Session cards and recap Awards = `kept` (card
     * order), each with the DM's value and winners; Highlights items players get = the DM's;
     * Campaign records players get = the DM's, awards won never above the DM's; Trophies records
     * withheld (the campaign holds party damage players don't see: the fixture's Mira late 11).
     */
    const check = async (kept: string[], clients: [TestClient, string][], dmc = dm) => {
      const d = await answers(dmc, ["Mira", "Brakka", "Thorn"]);
      expect(d.session.session.awards).toHaveLength(9);
      const out: Answers[] = [];
      for (const [c, name] of clients) {
        const a = await answers(c, OWN[name] as string[]);
        const cards = a.session.session.awards;
        expect(cards.map((x): string => x.key)).toEqual(kept);
        expect(a.recap.recap.awards?.map((x): string => x.key)).toEqual(kept);
        for (const x of cards) {
          if (x.key === "biggest-overkill") continue; // per role by design (FR-STATS-12)
          expect(said(x)).toEqual(said(d.session.session.awards.find((y) => y.key === x.key)));
        }
        const hl = a.fight.fight.highlights;
        for (const k of ["mvp", "biggest-hit", "most-healing", "nat20", "nat1"] as const) {
          if (hl[k].value !== null) expect(said(hl[k])).toEqual(said(d.fight.fight.highlights[k]));
        }
        const who = (r: { name: string; value: number } | null | undefined) =>
          r ? [r.name, r.value] : null;
        const dmRecords: Record<string, { name: string; value: number } | null | undefined> =
          d.campaign.campaign.records;
        for (const [k, r] of Object.entries(a.campaign.campaign.records)) {
          if (k === "biggest-overkill") continue;
          expect(who(r)).toEqual(who(dmRecords[k]));
        }
        expect(Object.keys(a.campaign.campaign.records)).toEqual(["best-fight-healing"]);
        const dmWon = new Map(
          d.campaign.campaign.awards.flatMap((r) =>
            r.won.map((w) => [`${r.name}|${w.key}`, w.count]),
          ),
        );
        for (const r of a.campaign.campaign.awards) {
          for (const w of r.won)
            expect(w.count).toBeLessThanOrEqual(dmWon.get(`${r.name}|${w.key}`) ?? 0);
        }
        for (const t of a.trophies) {
          expect(t.trophies.records).toEqual({});
          expect(t.trophies.lifetime).toBeDefined();
        }
        // No hint beyond fewer cards (BL-111's wording), and nothing of the hidden lines.
        const json = JSON.stringify(a);
        for (const leak of ["withh", "unseen", "hidden", "Elite", elite?.id as string]) {
          expect(json).not.toContain(leak);
        }
        out.push(a);
      }
      return { d, out };
    };

    // Nothing hidden today: all nine cards, the DM's (the overkill aside).
    const AWARDS = [
      "biggest-hit",
      "biggest-overkill",
      "most-dealt",
      "most-taken",
      "most-healing",
      "most-kills",
      "most-nat20",
      "most-nat1",
      "most-downed",
    ];
    const open = await check(AWARDS, [
      [p1, "Player 1"],
      [p2, "Player 2"],
    ]);
    // In sight so far: a Thorn / Mira tie at 2 kills, on every screen.
    expect(said(open.out[0]?.session.session.awards.find((x) => x.key === "most-kills"))).toEqual({
      value: 2,
      winners: ["Thorn", "Mira"],
      more: undefined,
    });
    const marks = [p1.raw().length, p2.raw().length];

    // sim-15: the DM's hidden kill by Thorn (the hidden Elite) → the DM's Most kills Thorn 3.
    await hp(elite as CombatantRecord, "damage", 99, thorn);
    const killed = await check(
      ["most-taken", "most-healing", "most-nat20", "most-nat1", "most-downed"],
      [
        [p1, "Player 1"],
        [p2, "Player 2"],
      ],
    );
    expect(said(killed.d.session.session.awards.find((x) => x.key === "most-kills"))).toEqual({
      value: 3,
      winners: ["Thorn"],
      more: undefined,
    });
    // The hidden Elite's hit on Mira (taken) and the DM's hidden roll as Thorn (rolled).
    await ask(dm, CBT_INTENTS.applyHp, {
      combatantId: mira?.id,
      kind: "damage",
      amount: 2,
      sourceId: elite?.id,
    });
    await ask(dm, ROLL, {
      expression: "1d20",
      category: "skill-check",
      actor: { entityId: character("Thorn") },
      manual: { diceTotal: 20 },
      public: false,
    });
    const final = await check(
      ["most-healing"],
      [
        [p1, "Player 1"],
        [p2, "Player 2"],
      ],
    );
    // Every player gets the same answer (one memo per viewer class), Trophies aside (own).
    expect({ ...final.out[0], trophies: [] }).toEqual({ ...final.out[1], trophies: [] } as never);
    // The hidden lines never reached a player.
    for (const [i, c] of [p1, p2].entries()) {
      await barrier(c);
      const since = c.raw().slice(marks[i]);
      for (const leak of ["Elite", elite?.id as string, '"amount":99', '"raw":99']) {
        expect(since).not.toContain(leak);
      }
    }
    for (const c of [dm, p1, p2]) c.close();

    const again = async () => {
      const d = await h.live(DM);
      const c1 = await h.live(p("Player 1"));
      const c2 = await h.live(p("Player 2"));
      const { out } = await check(
        ["most-healing"],
        [
          [c1, "Player 1"],
          [c2, "Player 2"],
        ],
        d,
      );
      d.close();
      for (const c of [c1, c2]) {
        expect(c.raw()).not.toContain(elite?.id as string);
        c.close();
      }
      return out;
    };
    expect(await again()).toEqual(final.out);
    await h.restart();
    expect(await again()).toEqual(final.out);
  }, 90_000);
});
