// Stats integration in-process (STATS §13): `stats.query` / `stats.showAwards` over combat-
// tracker's ambush (Mira, Thorn; Goblin, Goblin 2 visible; Wolf, Elite hidden). FR-STATS-02–04,
// -06, -09, -13–16, -20, -23; FR-DICE-72, -73; FR-CBT-138; FR-NOTE-48.
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import {
  CBT_INTENTS,
  DamageCardPayload,
  type HpChangesResult,
  partRollIdsOf,
} from "@shared/combat-tracker/schemas";
import { GEM_ADJUST_INTENT, GEM_SPEND_INTENT } from "@shared/gems/schemas";
import {
  ACK_MAX_BYTES,
  type DmFightRow,
  SESSIONS_MAX,
  STATS_AWARDS_KIND,
  STATS_QUERY_INTENT,
  STATS_SHOW_AWARDS_INTENT,
  StatsAwardsPayload,
} from "@shared/stats/schemas";
import { eq } from "drizzle-orm";
import { CommandError } from "../../commands/errors";
import { eventLog, gameLogEntry, hpChange, notification, roll } from "../../db/schema";
import { SET_FEATURE_INTENT } from "../campaign-management/features";
import { combatFacts, fightsOf, publicFactEncounters } from "../combat-tracker/stats-read";
import { rollFacts } from "../dice-roll-log/stats-read";
import { awardOf, rowOf, statsSetup } from "./testing";

const HOUR = 60 * 60 * 1000;
const names = (rows: readonly { name: string }[]) => rows.map((r) => r.name).sort();

describe("FR-STATS-02 counted facts", () => {
  test("FR-STATS-02 undone excluded: an undone apply drops out of every scope", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const undone = t.hp("Goblin", "damage", 4, { from: "Thorn" });
    t.undo(undone);
    expect(rowOf(t.fight().fight?.rows ?? [], "Thorn")?.dealt).toBe(3);
    expect(rowOf(t.fight(t.p1).fight?.rows ?? [], "Thorn")?.dealt).toBe(3);
    expect(awardOf(t.session().session?.awards ?? [], "most-dealt").value).toBe(3);
  });

  test("FR-STATS-02 final roll only: a superseded entry's roll never counts; the reroll once", () => {
    const t = statsSetup();
    const first = t.roll("Thorn", 1, { actor: t.p2 });
    const reroll = t.roll("Thorn", 20, { actor: t.p2 });
    // GM1's `gameLog.supersede` (FR-DICE-63) marks the old entry; the row is the contract here.
    t.s.db
      .update(gameLogEntry)
      .set({ supersededBy: reroll.entryId })
      .where(eq(gameLogEntry.id, first.entryId))
      .run();
    t.memory().gate.bump(t.h.campaignId);
    const a = t.session(t.p1).session?.awards ?? [];
    expect(awardOf(a, "most-nat1").value).toBeNull();
    expect(awardOf(a, "most-nat20")).toMatchObject({ value: 1, winners: [{ name: "Thorn" }] });
  });
});

describe("FR-STATS-02 final roll on GM1's reroll", () => {
  test("FR-STATS-02 FR-DICE-67 final roll only on a real Inspiration reroll: the replaced roll never counts, the new one once", () => {
    const t = statsSetup();
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    t.run(GEM_ADJUST_INTENT, { characterId: t.thornId, gem: "inspiration", delta: 1 });
    const old = t.roll("Thorn", 1, { actor: t.p2 });
    t.run(
      GEM_SPEND_INTENT,
      {
        characterId: t.thornId,
        gem: "inspiration",
        entryId: old.entryId,
        manual: { diceTotal: 20 },
      },
      t.p2,
    );
    const oldLine = t.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.id, old.entryId))
      .get();
    expect(oldLine?.supersededBy).not.toBeNull();
    const fresh = t.s.db.select().from(roll).where(eq(roll.replacesRollId, old.rollId)).get();
    expect(fresh?.natural).toBe(20);
    for (const actor of [t.h.dm, t.p1]) {
      const a = t.session(actor).session?.awards ?? [];
      expect(awardOf(a, "most-nat1").value).toBeNull();
      expect(awardOf(a, "most-nat20")).toMatchObject({ value: 1, winners: [{ name: "Thorn" }] });
    }
    // Follow `replacesRollId`: even a line that is not superseded can't bring the old roll back.
    const spend = t.s.db.select().from(gameLogEntry).all().at(-1);
    t.s.db
      .update(gameLogEntry)
      .set({ rollIds: [...((spend?.rollIds as string[]) ?? []), old.rollId] })
      .where(eq(gameLogEntry.id, spend?.id as string))
      .run();
    const facts = rollFacts(
      t.s.db,
      { role: "dm", features: [GEMS_FEATURE] },
      t.h.campaignId,
      1,
      999,
    );
    expect(facts.map((f) => f.rollId)).not.toContain(old.rollId);
    expect(facts.filter((f) => f.rollId === fresh?.id)).toHaveLength(1);
  });
});

describe("FR-STATS-03 filter, then aggregate", () => {
  test("FR-STATS-03 public only, same for all players: a DM-only line counts for the DM only", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 5, { from: "Thorn" });
    t.hp("Goblin 2", "damage", 6, { from: "Thorn", public: false });
    expect(rowOf(t.fight().fight?.rows ?? [], "Thorn")?.dealt).toBe(11);
    const p1 = t.fight(t.p1);
    const p2 = t.fight(t.p2);
    expect(rowOf(p1.fight?.rows ?? [], "Thorn")?.dealt).toBe(5);
    expect(p2).toEqual(p1);
    expect(t.session(t.p1)).toEqual(t.session(t.p2));
  });

  test("FR-STATS-03 tagged kinds skipped while off: a gems-only session lists only while gems are on", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 5, { from: "Thorn" });
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    t.clock.advance(7 * HOUR);
    t.run(GEM_ADJUST_INTENT, { characterId: t.thornId, gem: "inspiration", delta: 1 });
    expect(t.sessions().sessions).toHaveLength(2);
    expect(t.sessions(t.p1).sessions).toHaveLength(2);
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: false });
    // Off: the gem line is skipped for every viewer, the DM too (ADR-0058).
    expect(t.sessions().sessions).toHaveLength(1);
    expect(t.sessions(t.p1).sessions).toHaveLength(1);
  });
});

describe("FR-STATS-04 hidden never leaks", () => {
  test("FR-STATS-04 hidden roll / monster never counted for players", () => {
    const t = statsSetup();
    t.roll("Thorn", 20, { public: false });
    t.hp("Thorn", "damage", 4, { from: "Elite Goblin Warrior" });
    t.hp("Thorn", "damage", 2, { from: "Goblin" });
    const dm = t.fight();
    expect(rowOf(dm.fight?.rows ?? [], "Thorn")?.taken).toBe(6);
    expect(rowOf(dm.fight?.rows ?? [], "Elite Goblin Warrior")).toMatchObject({ hidden: true });
    const player = t.fight(t.p1);
    expect(names(player.fight?.rows ?? [])).toEqual(["Mira", "Thorn"]);
    expect(rowOf(player.fight?.rows ?? [], "Thorn")?.taken).toBe(2);
    expect(awardOf(t.session().session?.awards ?? [], "most-nat20").value).toBe(1);
    expect(awardOf(t.session(t.p1).session?.awards ?? [], "most-nat20").value).toBeNull();
    // A reveal doesn't backfill (the line stays non-public).
    t.run("map.setTokenHidden", { tokenId: t.tokens.elite, hidden: false });
    expect(rowOf(t.fight(t.p1).fight?.rows ?? [], "Thorn")?.taken).toBe(2);
  });

  test("FR-STATS-04 ended summon still named: its token is gone, the row keeps the combatant's name", () => {
    const t = statsSetup();
    const { combatantIds } = t.run<{ combatantIds: string[] }>(CBT_INTENTS.summon, {
      encounterId: t.enc.id,
      definitionId: t.h.wolfId,
      count: 1,
      ownerCharacterId: t.thornId,
    });
    const summonId = combatantIds[0] as string;
    const summonName = t.combatants(t.enc.id).find((c) => c.id === summonId)?.name as string;
    t.run(CBT_INTENTS.applyHp, {
      combatantId: t.id("Goblin"),
      kind: "damage",
      amount: 4,
      public: true,
      sourceId: summonId,
    });
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    const dm = t.fight();
    expect(dm.fight?.status).toBe("ended");
    expect(rowOf(dm.fight?.rows ?? [], summonName)).toMatchObject({ kind: "companion", dealt: 4 });
    expect(rowOf(t.fight(t.p2).fight?.rows ?? [], summonName)).toMatchObject({ dealt: 4 });
  });
});

describe("FR-STATS-06 raw from the facts", () => {
  test("FR-STATS-06 override: the DM's typed damage is the counted raw", () => {
    const t = statsSetup();
    const { cardId } = t.run<{ cardId: string }>(CBT_INTENTS.attack, {
      attackerId: t.id("Thorn"),
      manual: [{ diceTotal: 15 }, { diceTotal: 3 }],
    });
    const card = t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
    const p = DamageCardPayload.parse(card?.payload);
    t.run<HpChangesResult>(CBT_INTENTS.applyCard, {
      cardId,
      toHitTotal: p.toHit?.total,
      damageTotal: 12,
      damageRollId: p.damage?.rollId,
      partRollIds: partRollIdsOf(p),
      targets: [{ targetId: t.id("Wolf"), hit: true, multiplier: "normal" }],
      public: true,
    });
    expect(rowOf(t.fight().fight?.rows ?? [], "Thorn")).toMatchObject({ dealt: 12, kills: 1 });
    expect(awardOf(t.session().session?.awards ?? [], "biggest-hit").value).toBe(12);
  });
});

describe("FR-STATS-09 companions", () => {
  test("FR-STATS-09 companion roll-up: a companion's damage and kills roll into its owner", () => {
    const t = statsSetup();
    t.run(CBT_INTENTS.setCompanion, {
      combatantId: t.id("Goblin 2"),
      owner: { characterId: t.miraId },
    });
    t.hp("Goblin", "damage", 7, { from: "Goblin 2" });
    t.hp("Goblin", "damage", 2, { from: "Mira" });
    const rows = t.fight(t.p1).fight?.rows ?? [];
    expect(rows.map((r) => r.name)).toEqual(["Mira", "Goblin 2", "Thorn"]);
    expect(rowOf(rows, "Goblin 2")).toMatchObject({ kind: "companion", kills: 1 });
    const a = t.session(t.p1).session?.awards ?? [];
    expect(awardOf(a, "most-dealt")).toMatchObject({
      value: 9,
      winners: [{ name: "Mira", with: ["Goblin 2"] }],
    });
    expect(awardOf(a, "most-kills")).toMatchObject({ value: 1, winners: [{ name: "Mira" }] });
  });

  test("FR-STATS-09 charmed-away companion moves to monsters, past facts too (OQ-STATS-12 A)", () => {
    const t = statsSetup();
    t.run(CBT_INTENTS.setCompanion, {
      combatantId: t.id("Goblin 2"),
      owner: { characterId: t.miraId },
    });
    t.hp("Goblin", "damage", 7, { from: "Goblin 2" });
    t.run(CBT_INTENTS.setCompanion, { combatantId: t.id("Goblin 2"), owner: null });
    expect(names(t.fight(t.p1).fight?.rows ?? [])).toEqual(["Mira", "Thorn"]);
    expect(rowOf(t.fight().fight?.rows ?? [], "Goblin 2")).toMatchObject({ kind: "monster" });
    expect(awardOf(t.session(t.p1).session?.awards ?? [], "most-kills").value).toBeNull();
  });
});

describe("FR-STATS-13 sessions", () => {
  test("FR-STATS-13 retroactive session (injected clock): a 6 h gap splits facts written long before", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.clock.advance(7 * HOUR);
    t.hp("Goblin", "damage", 2, { from: "Mira" });
    const list = t.sessions().sessions;
    expect(list).toHaveLength(2);
    // Newest first; the older session's awards still come from its own facts.
    const [today, earlier] = list;
    expect(
      awardOf(t.session(t.h.dm, earlier?.fromN).session?.awards ?? [], "most-dealt"),
    ).toMatchObject({
      value: 3,
      winners: [{ name: "Thorn" }],
    });
    expect(awardOf(t.session().session?.awards ?? [], "most-dealt")).toMatchObject({
      value: 2,
      winners: [{ name: "Mira" }],
    });
    expect(today?.fights).toBe(1);
  });

  test("FR-STATS-13 facts stamped after their line (1 ms later, the real clock) stay in its session", () => {
    const t = statsSetup();
    // Every stamp moves the clock 1 ms on, as the system clock does between a line and its row.
    const iso = t.clock.iso.bind(t.clock);
    t.clock.iso = () => {
      t.clock.advance(1);
      return iso();
    };
    t.clock.advance(7 * HOUR);
    const id = t.hp("Goblin 2", "damage", 40, { from: "Thorn" });
    const row = t.s.db.select().from(hpChange).where(eq(hpChange.id, id)).get();
    const line = t.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.id, row?.entryId as string))
      .get();
    expect((row?.at as string) > (line?.at as string)).toBe(true);
    for (const actor of [t.h.dm, t.p1]) {
      const s = t.session(actor, line?.n).session;
      expect(s?.fromN).toBe(line?.n);
      expect(awardOf(s?.awards ?? [], "biggest-hit")).toMatchObject({ value: 40 });
      expect(awardOf(s?.awards ?? [], "most-kills")).toMatchObject({ value: 1 });
      expect(s?.fights).toBe(1);
      // The list and the session ack count the same fights for the same viewer.
      expect(t.sessions(actor).sessions[0]).toMatchObject({ fromN: line?.n, fights: 1 });
    }
  });

  test("FR-STATS-13 any n resolves: an n inside a session answers its key; players get the DM's key", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.hp("Goblin", "damage", 2, { from: "Mira" });
    const { session } = t.session();
    const key = session?.fromN as number;
    const last = session?.toN as number;
    expect(t.session(t.h.dm, last).session?.fromN).toBe(key);
    expect(t.session(t.p1, key).session?.fromN).toBe(key);
    // The ambush's first lines are the DM-only initiative rolls: players' times are clipped.
    const p = t.sessions(t.p1).sessions[0];
    expect(p?.fromN).toBe(key);
    const err = t.err(() => t.session(t.p1, last + 50));
    expect(err.code).toBe("not_found");
  });

  test("FR-STATS-14 cache warmed and extended: the cache reads only entries past its last n", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.sessions();
    const n1 = t.memory().cache.lastN(t.h.campaignId) as number;
    t.hp("Goblin", "damage", 2, { from: "Mira" });
    t.sessions();
    expect(t.memory().cache.lastN(t.h.campaignId)).toBe(n1 + 1);
  });
});

describe("FR-STATS-15 fights", () => {
  test("FR-STATS-15 default fight, player label, no planned / fact-less fight", () => {
    const t = statsSetup();
    const planned = t.createAmbush();
    // Players: the started fight lists under its label only once it has a public fact;
    // FR-STATS-52 (sprint 8): before that it is the default and the picker's one item, as "This
    // fight" with party rows at 0.
    const early = t.fight(t.p1);
    expect(early.fights).toEqual([{ key: t.enc.id, label: "This fight", status: "started" }]);
    expect(early.fight).toMatchObject({ key: t.enc.id, label: "This fight", status: "started" });
    expect(t.fight().fight).toMatchObject({ key: t.enc.id, label: "Ambush at the Ford" });
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const p = t.fight(t.p1);
    expect(p.fight).toMatchObject({ key: t.enc.id, status: "started" });
    expect(p.fight?.label).toMatch(/^Fight 1 · (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ [A-Z][a-z]{2}$/);
    expect(JSON.stringify(p)).not.toContain("Ambush");
    expect(t.err(() => t.fight(t.p1, planned.id)).code).toBe("not_found");
    expect(t.err(() => t.fight(t.h.dm, planned.id)).code).toBe("not_found");
    expect(t.err(() => t.fight(t.h.dm, "nope")).code).toBe("not_found");
    // Ended: the default is the newest ended one.
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    expect(t.fight(t.p1).fight).toMatchObject({ key: t.enc.id, status: "ended" });
  });
});

describe("FR-STATS-16 read path", () => {
  test("FR-STATS-16 read-only: no write, event, log row or seq", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const events = t.events.length;
    const logRows = t.s.db.select().from(eventLog).all().length;
    const digest = JSON.stringify(t.s.db.select().from(hpChange).all());
    t.fight();
    t.sessions(t.p1);
    t.session(t.p2);
    expect(t.events.length).toBe(events);
    expect(t.s.db.select().from(eventLog).all().length).toBe(logRows);
    expect(JSON.stringify(t.s.db.select().from(hpChange).all())).toBe(digest);
  });

  test("FR-STATS-16 rate limit coalesces, per viewer (FR-STATS-69: role + player, all their tabs): ≤ 4 computed answers a second; the excess gets the memo, else `conflict` (not coalesced)", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const gate = t.memory().gate;
    const q = () => t.query<{ fight: { rows: DmFightRow[] } }>({ scope: "fight" });
    const first = q();
    const before = gate.computed;
    // Same input and version: free (memo).
    for (let i = 0; i < 10; i++) q();
    expect(gate.computed).toBe(before);
    // Changes stale it: 4 more computations this second, then the excess is coalesced.
    for (let i = 0; i < 6; i++) {
      t.hp("Goblin 2", "damage", 1, { from: "Thorn" });
      q();
    }
    expect(gate.computed).toBe(before + 3);
    const coalesced = q();
    expect(rowOf(coalesced.fight.rows, "Thorn")?.dealt).toBe(6);
    expect(rowOf(first.fight.rows, "Thorn")?.dealt).toBe(3);
    // A new second: the next query computes the current numbers.
    t.clock.advance(1000);
    expect(rowOf(q().fight.rows, "Thorn")?.dealt).toBe(9);
    // An input with no answer yet while over the rate → conflict.
    for (let i = 0; i < 4; i++) t.query({ scope: "sessions" }, t.p1);
    t.hp("Goblin 2", "damage", 1, { from: "Thorn" });
    for (let i = 0; i < 4; i++) {
      t.hp("Goblin 2", "damage", 1, { from: "Mira" });
      t.query({ scope: "fight" }, t.p2);
    }
    const err = t.err(() => t.query({ scope: "session" }, t.p2));
    expect(err).toBeInstanceOf(CommandError);
    expect(err.code).toBe("conflict");
  });

  test("FR-STATS-25 limits: sessions ≤ 200 newest; the worst ack stays ≤ 64 KB", () => {
    const t = statsSetup();
    for (let i = 0; i < SESSIONS_MAX + 5; i++) {
      t.hp("Goblin", "damage", 1, { from: i % 2 ? "Thorn" : "Mira" });
      t.clock.advance(7 * HOUR);
    }
    const list = t.sessions().sessions;
    expect(list).toHaveLength(SESSIONS_MAX);
    // Newest first: the oldest five (the start's session included) are cut.
    expect((list[0]?.fromN as number) > (list[1]?.fromN as number)).toBe(true);
    expect(JSON.stringify(list).length).toBeLessThan(ACK_MAX_BYTES);
    expect(JSON.stringify(t.fight()).length).toBeLessThan(ACK_MAX_BYTES);
    expect(JSON.stringify(t.session()).length).toBeLessThan(ACK_MAX_BYTES);
  });
});

describe("FR-STATS-20 show awards", () => {
  test("FR-STATS-20 show awards notifies all: one stats-awards info row, player-safe payload; players may not", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 30, { from: "Thorn" });
    const key = t.session().session?.fromN as number;
    const r = t.run<{ notificationId: string }>(STATS_SHOW_AWARDS_INTENT, { fromN: key });
    const row = t.s.db
      .select()
      .from(notification)
      .where(eq(notification.id, r.notificationId))
      .get();
    expect(row).toMatchObject({ kind: STATS_AWARDS_KIND, audience: "all", state: "info" });
    expect(row?.text).toMatch(/^Session awards: /);
    const payload = StatsAwardsPayload.parse(row?.payload);
    expect(payload.fromN).toBe(key);
    expect(Object.keys(payload).sort()).toEqual(["from", "fromN", "label", "to", "toN"]);
    expect(t.err(() => t.run(STATS_SHOW_AWARDS_INTENT, { fromN: key }, t.p1)).code).toBe(
      "forbidden",
    );
    expect(t.err(() => t.run(STATS_SHOW_AWARDS_INTENT, { fromN: key + 1 })).code).toBe("not_found");
  });

  test("FR-STATS-20 awards open for a player when the session starts hidden", () => {
    const t = statsSetup();
    // The session's first entries are the DM-only initiative rolls of the start.
    t.hp("Goblin", "damage", 9, { from: "Thorn" });
    const dmKey = t.session().session?.fromN as number;
    const first = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.n, dmKey)).get();
    expect(first?.public).toBe(false);
    t.run(STATS_SHOW_AWARDS_INTENT, { fromN: dmKey });
    const p = t.session(t.p1, dmKey).session;
    expect(p?.fromN).toBe(dmKey);
    expect(awardOf(p?.awards ?? [], "biggest-hit")).toMatchObject({ value: 9 });
  });
});

describe("FR-STATS-23 retroactive, stateless", () => {
  test("FR-STATS-23 old rows parse: lines without callout / sourced still count", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 30, { from: "Thorn" });
    // A pre-sprint-7 line: no `callout` in the payload; the facts still give the callout.
    const entryId = t.s.db.select().from(hpChange).get()?.entryId as string;
    t.s.db
      .update(gameLogEntry)
      .set({ payload: { targetName: "Goblin", kind: "damage", amount: 30 }, dmPayload: null })
      .where(eq(gameLogEntry.id, entryId))
      .run();
    t.memory().gate.bump(t.h.campaignId);
    expect(awardOf(t.session(t.p1).session?.awards ?? [], "biggest-overkill")).toMatchObject({
      value: 30,
    });
  });
});

describe("STATS read helpers", () => {
  test("FR-CBT-138 facts contract: combatFacts joins public, kinds, owner; undone excluded; End keeps rows", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.undo(t.hp("Goblin", "damage", 4, { from: "Thorn" }));
    t.hp("Mira", "damage", 2, { from: "Elite Goblin Warrior" });
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    const facts = combatFacts(t.s.db, { encounterId: t.enc.id });
    expect(facts.map((f) => [f.raw, f.public, f.attacker?.kind, f.target.kind])).toEqual([
      [3, true, "pc", "monster"],
      [2, false, "monster", "pc"],
    ]);
    expect(facts[0]?.encounterName).toBe("Ambush at the Ford");
    expect(facts[1]?.attacker?.hidden).toBe(true);
    expect(fightsOf(t.s.db, t.h.campaignId).map((f) => f.status)).toEqual(["ended"]);
    expect([...publicFactEncounters(t.s.db, t.h.campaignId)]).toEqual([t.enc.id]);
    const bySpan = combatFacts(t.s.db, { campaignId: t.h.campaignId, fromN: 1, toN: 999 });
    expect(bySpan).toHaveLength(2);
  });

  test("FR-DICE-72 stats count the final roll: the superseded entry's roll is gone, nat counted once", () => {
    const t = statsSetup();
    const old = t.roll("Mira", 20, { actor: t.p1 });
    const now = t.roll("Mira", 20, { actor: t.p1 });
    t.s.db
      .update(gameLogEntry)
      .set({ supersededBy: now.entryId })
      .where(eq(gameLogEntry.id, old.entryId))
      .run();
    const facts = rollFacts(t.s.db, { role: "player", features: [] }, t.h.campaignId, 1, 999);
    expect(facts.map((f) => f.rollId)).toEqual([now.rollId]);
  });

  test("FR-DICE-72 feature-tagged kinds skipped while off", () => {
    const t = statsSetup();
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    t.run(GEM_ADJUST_INTENT, { characterId: t.miraId, gem: "inspiration", delta: 1 });
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: false });
    const listed = t.sessions().sessions[0];
    const lastGem = t.s.db.select().from(gameLogEntry).all().at(-1);
    expect(lastGem?.kind).toBe("gem.award");
    // The gem line is skipped: the DM's span ends before it.
    expect(listed?.to).toBe(listed?.from);
    expect(listed?.toN).toBe(lastGem?.n);
  });

  test("FR-DICE-73 rollFacts: a roll in two entries returns once; public if any listing entry is; unreferenced absent", () => {
    const t = statsSetup();
    // Player 2's attack: a public roll line; the outcome on the hidden Elite is DM-only.
    const { cardId } = t.run<{ cardId: string }>(
      CBT_INTENTS.attack,
      { attackerId: t.id("Thorn"), manual: [{ diceTotal: 20 }, { diceTotal: 3 }] },
      t.p2,
    );
    const p = DamageCardPayload.parse(
      t.s.db.select().from(notification).where(eq(notification.id, cardId)).get()?.payload,
    );
    t.run(CBT_INTENTS.applyCard, {
      cardId,
      toHitTotal: p.toHit?.total,
      damageTotal: p.damage?.total,
      damageRollId: p.damage?.rollId,
      partRollIds: partRollIdsOf(p),
      targets: [{ targetId: t.id("Elite Goblin Warrior"), hit: true, multiplier: "normal" }],
    });
    const dm = rollFacts(t.s.db, { role: "dm", features: [] }, t.h.campaignId, 1, 999);
    const toHit = dm.filter((f) => f.rollId === p.toHit?.rollId);
    // Listed by the public roll line and the DM-only outcome line: once, public.
    expect(toHit).toHaveLength(1);
    expect(toHit[0]).toMatchObject({ natural: 20, public: true });
    const player = rollFacts(t.s.db, { role: "player", features: [] }, t.h.campaignId, 1, 999);
    expect(player.some((f) => f.rollId === p.toHit?.rollId)).toBe(true);
    // The monsters' DM-only initiative rolls: the DM's only.
    expect(dm.length).toBeGreaterThan(player.length);
  });

  test("FR-NOTE-48 awards notification: the kind's payload schema has no DM data", () => {
    expect(Object.keys(StatsAwardsPayload.shape).sort()).toEqual([
      "from",
      "fromN",
      "label",
      "to",
      "toN",
    ]);
    expect(STATS_QUERY_INTENT).toBe("stats.query");
  });
});
