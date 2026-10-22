// Stats tier B reads in-process (STATS §13.1, sprint 8): Highlights in the fight ack (FR-STATS-31,
// -32, -35, -52), luck (FR-STATS-37–40, FR-DICE-89, -90), trophies (FR-STATS-42, -43), session
// partials (FR-STATS-46) and the retroactive sittings (FR-STATS-49), over combat-tracker's ambush
// (Mira = Player 1, Thorn = Player 2; Goblin, Goblin 2 visible; Wolf, Elite hidden).
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { GEM_ADJUST_INTENT, GEM_SPEND_INTENT } from "@shared/gems/schemas";
import {
  type LuckTally,
  luckRows,
  mergeLuck,
  mergeTrophies,
  type TrophyTally,
  trophyCase,
} from "@shared/stats/rules-b";
import {
  DM_DICE_KEY,
  DmHighlights,
  PlayerHighlights,
  STATS_SHOW_AWARDS_INTENT,
} from "@shared/stats/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry } from "../../db/schema";
import { campaignFeatures, SET_FEATURE_INTENT } from "../campaign-management/features";
import { ROLL } from "../dice-roll-log/commands";
import { rollFacts } from "../dice-roll-log/stats-read";
import { characters, fightsFor, type StatsRead } from "./compute";
import { computePartials, Partials } from "./partials";
import { statsSetup } from "./testing";

type T = ReturnType<typeof statsSetup>;
const HOUR = 60 * 60 * 1000;

/** The cold recompute (no memo): every session's partial in one pass, merged. */
function cold(t: T, role: "dm" | "player") {
  const cid = t.h.campaignId;
  const r: StatsRead = {
    db: t.s.db,
    viewer: { role, features: campaignFeatures(t.s.db, cid) },
    campaignId: cid,
  };
  const chars = characters(t.s.db, cid);
  const sessions = t.memory().cache.sessions(t.s.db, cid);
  const luck = new Map<string, LuckTally>();
  const trophies = new Map<string, TrophyTally>();
  for (const p of computePartials(r, sessions, chars).values()) {
    mergeLuck(luck, p.luck);
    mergeTrophies(trophies, p.trophies);
  }
  const labels = fightsFor(r).label;
  return {
    luck: luckRows(luck, chars, role),
    trophies: (id: string) =>
      trophyCase(trophies.get(id), luck.get(id), (e) => labels.get(e) ?? ""),
  };
}

/** `k` more sittings (a 7 h gap each) with one public Thorn roll in each. */
function sittings(t: T, k: number) {
  for (let i = 0; i < k; i++) {
    t.clock.advance(7 * HOUR);
    t.roll("Thorn", 1 + (i % 20), { actor: t.p2 });
  }
}

/** A campaign answer once the partials are built (a pending one waits for the build). */
async function campaignLuck(t: T, actor = t.h.dm) {
  let l = t.luck(actor, { campaign: true });
  if (l.pending) {
    await t.memory().partials.build(t.h.campaignId);
    l = t.luck(actor, { campaign: true });
  }
  return l;
}
async function campaignTrophies(t: T, id: string, actor = t.h.dm) {
  let x = t.trophies(id, actor);
  if (x.pending) {
    await t.memory().partials.build(t.h.campaignId);
    x = t.trophies(id, actor);
  }
  return x;
}
const caseOf = (x: { lifetime?: unknown; records?: unknown }) => ({
  lifetime: x.lifetime,
  records: x.records,
});

describe("FR-STATS-31 highlights in the fight ack", () => {
  test("FR-STATS-31 FR-STATS-35 players' highlights never name the Wolf; the DM sees it, hidden marks and Still standing", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 30, { from: "Thorn" }); // callout kill
    t.hp("Thorn", "damage", 4, { from: "Elite Goblin Warrior" }); // hidden attacker: DM line
    t.hp("Wolf", "damage", 30, { from: "Mira", public: false }); // hidden kill
    t.hp("Mira", "damage", 40, { from: "Goblin 2" }); // down
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    const dm = DmHighlights.parse(t.fight().fight?.highlights);
    expect(dm.kills.events.map((e) => [e.from, e.to, e.hidden])).toEqual([
      ["Thorn", "Goblin", false],
      ["Mira", "Wolf", true],
    ]);
    expect(dm.standing.map((s) => [s.name, s.hidden])).toEqual([
      ["Goblin 2", false],
      ["Elite Goblin Warrior", true],
    ]);
    for (const p of [t.p1, t.p2]) {
      const h = PlayerHighlights.parse(t.fight(p).fight?.highlights);
      expect(h.kills.events).toEqual([
        { fell: "kill", from: "Thorn", to: "Goblin", callout: true },
      ]);
      expect(h.downed.events).toEqual([
        { fell: "down", from: "Goblin 2", to: "Mira", callout: true },
      ]);
      expect(h["biggest-overkill"]).toMatchObject({ value: 30, winners: [{ name: "Thorn" }] });
      const json = JSON.stringify(h);
      for (const leak of ["Wolf", "Elite", '"standing"', '"hidden"', '"overkill"']) {
        expect(json).not.toContain(leak);
      }
    }
  });

  test("FR-STATS-32 a fight's rolls: its entries plus attack / save rolls by its combatants in its span", () => {
    const t = statsSetup();
    t.clock.advance(1000);
    t.roll("Thorn", 20, { actor: t.p2 }); // attack, no encounter: counts
    t.roll("Mira", 1, { actor: t.p1, category: "skill-check" }); // a check: never
    t.roll("Mira", 1, { actor: t.p1, category: "saving-throw" }); // a save: counts
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    t.clock.advance(1000);
    t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
    t.clock.advance(1000);
    t.roll("Thorn", 20, { actor: t.p2 }); // after End: not this fight's
    const fight = t.fight(t.p1).fight;
    const h = PlayerHighlights.parse(fight?.highlights);
    expect(h.nat20).toMatchObject({ value: 1, winners: [{ name: "Thorn" }] });
    expect(h.nat1).toMatchObject({ value: 1, winners: [{ name: "Mira" }] });
    expect(h.rounds).toBe(fight?.round as number);
    expect(h.duration).toBe(2000);
  });

  test("FR-STATS-52 default fight: a player's default is the started fight before a public fact", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Elite Goblin Warrior" }); // DM-only so far
    const p = t.fight(t.p1);
    expect(p.fights).toEqual([]);
    expect(p.fight).toMatchObject({ key: t.enc.id, label: "This fight", status: "started" });
    expect(p.fight?.rows.map((r) => [r.name, r.dealt, r.taken])).toEqual([
      ["Mira", 0, 0],
      ["Thorn", 0, 0],
    ]);
    // By id too (the client's refresh names it).
    expect(t.fight(t.p1, t.enc.id).fight?.label).toBe("This fight");
    expect(JSON.stringify(p)).not.toContain("Ambush");
  });
});

describe("FR-STATS-37 which rolls count", () => {
  test("FR-STATS-37 initiative out; a reroll counts its final roll only", () => {
    const t = statsSetup();
    t.roll("Thorn", 20, { actor: t.p2, category: "initiative" });
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    t.run(GEM_ADJUST_INTENT, { characterId: t.miraId, gem: "inspiration", delta: 1 });
    const old = t.roll("Mira", 4, { actor: t.p1, category: "skill-check" });
    t.run(
      GEM_SPEND_INTENT,
      {
        characterId: t.miraId,
        gem: "inspiration",
        entryId: old.entryId,
        manual: { diceTotal: 17 },
      },
      t.p1,
    );
    for (const actor of [t.h.dm, t.p1]) {
      const rows = t.luck(actor).rows;
      expect(rows.find((r) => r.name === "Thorn")).toBeUndefined();
      expect(rows.find((r) => r.name === "Mira")).toMatchObject({ rolls: 1, d20s: 1, avg: 17 });
    }
  });

  test("FR-STATS-37 FR-DICE-90 hidden request answer is DM-only: counts for the DM, not for its roller", () => {
    const t = statsSetup();
    const answer = t.roll("Mira", 20, { public: false });
    t.s.db
      .update(gameLogEntry)
      .set({ audiencePlayerId: t.h.p1.id })
      .where(eq(gameLogEntry.id, answer.entryId))
      .run();
    t.memory().gate.bump(t.h.campaignId);
    expect(t.luck().rows.find((r) => r.name === "Mira")).toMatchObject({ nat20: 1 });
    for (const p of [t.p1, t.p2]) {
      expect(t.luck(p).rows).toEqual([]);
      const nat20 = t.session(p).session?.awards.find((a) => a.key === "most-nat20");
      expect(nat20?.value ?? null).toBeNull();
    }
    expect(t.trophies(t.miraId, t.p1).lifetime?.nat20).toBe(0);
    expect(t.trophies(t.miraId).lifetime?.nat20).toBe(1);
  });

  test("FR-DICE-90 new roll paths count: a roll written through dice.evaluate with a hidden entry counts for the DM only", () => {
    const t = statsSetup();
    t.roll("Thorn", 20, { public: false });
    expect(t.luck().rows).toEqual([expect.objectContaining({ name: "Thorn", rolls: 1, nat20: 1 })]);
    expect(t.luck(t.p2).rows).toEqual([]);
  });

  test("FR-STATS-39 rows: DM dice for the DM only; a player's Me roll counts nowhere", () => {
    const t = statsSetup();
    // The DM, no actor; then Player 1's "Me" roll.
    t.run(ROLL, { expression: "1d20", category: "attack", manual: { diceTotal: 20 } });
    t.run(ROLL, { expression: "1d20", category: "attack", manual: { diceTotal: 20 } }, t.p1);
    t.roll("Thorn", 12, { actor: t.p2 });
    expect(t.luck().rows.map((r) => [r.key, r.rolls, r.nat20])).toEqual([
      [t.thornId, 1, 0],
      [DM_DICE_KEY, 1, 1],
    ]);
    expect(t.luck(t.p1).rows.map((r) => r.key)).toEqual([t.thornId]);
  });
});

describe("FR-STATS-39 owned creatures (gate pick 6)", () => {
  test("FR-STATS-39 owned creatures' rolls count nowhere: not the owner's row, not DM dice; an unowned monster's are DM dice", async () => {
    const t = statsSetup();
    t.run(CBT_INTENTS.setCompanion, {
      combatantId: t.id("Goblin 2"),
      owner: { characterId: t.miraId },
    });
    const { combatantIds } = t.run<{ combatantIds: string[] }>(CBT_INTENTS.summon, {
      encounterId: t.enc.id,
      definitionId: t.h.wolfId,
      count: 1,
      ownerCharacterId: t.thornId,
    });
    const asCombatant = (combatantId: string) =>
      t.run(ROLL, {
        expression: "1d20",
        category: "attack",
        actor: { combatantId },
        manual: { diceTotal: 20 },
      });
    asCombatant(t.id("Goblin 2")); // Mira's companion
    asCombatant(combatantIds[0] as string); // Thorn's summon
    asCombatant(t.id("Goblin")); // unowned: DM dice
    expect(t.luck().rows.map((r) => [r.key, r.rolls, r.nat20])).toEqual([[DM_DICE_KEY, 1, 1]]);
    expect((await campaignLuck(t)).rows).toEqual(cold(t, "dm").luck);
    // Current owner: released, Goblin 2's past roll is an unowned monster's (DM dice).
    t.run(CBT_INTENTS.setCompanion, { combatantId: t.id("Goblin 2"), owner: null });
    expect(t.luck().rows.map((r) => [r.key, r.rolls])).toEqual([[DM_DICE_KEY, 2]]);
  });
});

describe("FR-DICE-89 luck fields", () => {
  test("FR-DICE-89 luck fields: advantage gives both faces; a physical several-dice total none; campaign = union of sessions", () => {
    const t = statsSetup();
    t.run(
      ROLL,
      {
        expression: "1d20+5",
        mode: "advantage",
        category: "attack",
        actor: { entityId: t.miraId },
        manual: { diceTotal: 18, dice: [18, 3] },
      },
      t.p1,
    );
    t.clock.advance(7 * HOUR);
    t.run(
      ROLL,
      {
        expression: "2d20",
        category: "attack",
        actor: { entityId: t.miraId },
        manual: { diceTotal: 30 },
      },
      t.p1,
    );
    const v = { role: "dm" as const, features: [] };
    const all = rollFacts(t.s.db, v, t.h.campaignId);
    const mira = all.filter((r) => r.actorId === t.miraId);
    expect(mira.map((r) => [r.d20, r.manual, r.hasD20])).toEqual([
      [[18, 3], true, true],
      [[], true, true],
    ]);
    const sessions = t.memory().cache.sessions(t.s.db, t.h.campaignId);
    const union = sessions.flatMap((s) => rollFacts(t.s.db, v, t.h.campaignId, s.fromN, s.toN));
    expect(union.map((r) => r.rollId).sort()).toEqual(all.map((r) => r.rollId).sort());
    expect(t.luck(t.p2, { n: sessions[0]?.fromN }).rows[0]).toMatchObject({
      rolls: 1,
      d20s: 2,
      avg: 10.5,
    });
  });
});

describe("FR-STATS-40 scopes", () => {
  test("FR-STATS-40 FR-STATS-45 scopes: one session (default the newest; any n resolves) or the campaign", async () => {
    const t = statsSetup();
    t.roll("Thorn", 20, { actor: t.p2 });
    const first = t.luck().fromN as number;
    t.clock.advance(7 * HOUR);
    t.roll("Thorn", 1, { actor: t.p2 });
    const newest = t.luck();
    expect(newest.fromN).not.toBe(first);
    expect(newest.rows[0]).toMatchObject({ nat1: 1, nat20: 0 });
    expect(t.luck(t.h.dm, { n: first }).rows[0]).toMatchObject({ nat20: 1, nat1: 0 });
    expect((await campaignLuck(t)).rows[0]).toMatchObject({ nat20: 1, nat1: 1, rolls: 2 });
    expect(t.err(() => t.luck(t.h.dm, { n: 99_999 })).code).toBe("not_found");
  });
});

describe("FR-STATS-43 trophies: who", () => {
  test("FR-STATS-43 another's trophies → forbidden; own and the DM's any; unknown → not_found", async () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 30, { from: "Mira" });
    const own = await campaignTrophies(t, t.miraId, t.p1);
    expect(own.lifetime).toMatchObject({ dealt: 30, kills: 1, fights: 1 });
    expect(own.records?.["biggest-overkill"]).toMatchObject({ value: 30, to: "Goblin" });
    expect(own.records?.["biggest-hit"]?.fight).toMatch(/^Fight 1 · /);
    expect(t.err(() => t.trophies(t.miraId, t.p2)).code).toBe("forbidden");
    const dm = await campaignTrophies(t, t.miraId);
    expect(dm.records?.["biggest-overkill"]).toMatchObject({ value: 23 });
    expect(dm.records?.["biggest-hit"]?.fight).toBe("Ambush at the Ford");
    expect(t.err(() => t.trophies("nope")).code).toBe("not_found");
  });
});

describe("FR-STATS-46 session partials", () => {
  test("FR-STATS-46 chunked start build: pending while > 5 sessions are unbuilt, then the cold numbers", async () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 9, { from: "Thorn" });
    sittings(t, 8);
    const p = t.memory().partials;
    expect(t.luck(t.h.dm, { campaign: true })).toMatchObject({ pending: true, rows: [] });
    expect(t.trophies(t.thornId)).toEqual({ characterId: t.thornId, pending: true });
    await p.build(t.h.campaignId);
    expect(p.built(t.h.campaignId, "dm|")).toBe(8);
    expect(p.built(t.h.campaignId, "player|")).toBe(8);
    expect(p.longestBlockMs).toBeGreaterThan(0);
    for (const role of ["dm", "player"] as const) {
      const actor = role === "dm" ? t.h.dm : t.p2;
      const want = cold(t, role);
      expect(t.luck(actor, { campaign: true }).rows).toEqual(want.luck);
      expect(caseOf(t.trophies(t.thornId, actor))).toEqual(want.trophies(t.thornId));
    }
  });

  test("FR-STATS-46 queries before ready: ≤ 5 unbuilt sessions are read now (and kept)", () => {
    const t = statsSetup();
    sittings(t, 3);
    const l = t.luck(t.h.dm, { campaign: true });
    expect(l.pending).toBeUndefined();
    expect(l.rows).toEqual(cold(t, "dm").luck);
    expect(t.memory().partials.built(t.h.campaignId, "dm|")).toBe(3);
  });

  test("FR-STATS-46 an old undo matches a cold recompute (its session dropped, re-read)", async () => {
    const t = statsSetup();
    const old = t.hp("Goblin", "damage", 9, { from: "Thorn" });
    sittings(t, 7);
    await campaignTrophies(t, t.thornId);
    expect(t.memory().partials.built(t.h.campaignId, "dm|")).toBe(7);
    t.undo(old);
    expect(t.memory().partials.built(t.h.campaignId, "dm|")).toBe(6);
    const x = await campaignTrophies(t, t.thornId);
    expect(x.lifetime).toMatchObject({ dealt: 0, kills: 0 });
    expect(caseOf(x)).toEqual(cold(t, "dm").trophies(t.thornId));
  });

  test("FR-STATS-46 a charm-away drops all and matches a cold recompute", async () => {
    const t = statsSetup();
    t.run(CBT_INTENTS.setCompanion, {
      combatantId: t.id("Goblin 2"),
      owner: { characterId: t.miraId },
    });
    t.hp("Goblin", "damage", 9, { from: "Goblin 2" });
    sittings(t, 7);
    expect((await campaignTrophies(t, t.miraId)).lifetime).toMatchObject({ dealt: 9, kills: 1 });
    t.run(CBT_INTENTS.setCompanion, { combatantId: t.id("Goblin 2"), owner: null });
    expect(t.memory().partials.built(t.h.campaignId, "dm|")).toBe(0);
    const x = await campaignTrophies(t, t.miraId);
    expect(x.lifetime).toMatchObject({ dealt: 0, kills: 0 });
    expect(caseOf(x)).toEqual(cold(t, "dm").trophies(t.miraId));
  });

  test("FR-STATS-46 a feature switch drops all and matches a cold recompute", async () => {
    const t = statsSetup();
    t.roll("Thorn", 20, { actor: t.p2 });
    sittings(t, 7);
    await campaignLuck(t);
    t.run(SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: true });
    expect(t.memory().partials.built(t.h.campaignId, "dm|")).toBe(0);
    const l = await campaignLuck(t);
    expect(t.memory().partials.built(t.h.campaignId, `dm|${GEMS_FEATURE}`)).toBe(7);
    expect(l.rows).toEqual(cold(t, "dm").luck);
  });

  test("FR-STATS-46 a live fact keeps the closed sessions' partials (newest recomputed)", async () => {
    const t = statsSetup();
    sittings(t, 7);
    await campaignLuck(t);
    const before = t.memory().partials.computed;
    t.roll("Thorn", 20, { actor: t.p2 });
    const l = await campaignLuck(t);
    expect(t.memory().partials.computed).toBe(before);
    expect(l.rows).toEqual(cold(t, "dm").luck);
  });
});

describe("FR-STATS-46 background build failures", () => {
  test("FR-STATS-46 a build whose DB closed mid-way stops quietly (no unhandled rejection)", async () => {
    const t = statsSetup();
    const errors: unknown[] = [];
    const p = new Partials({
      db: t.s.db,
      sessions: () => {
        throw new RangeError("Cannot use a closed database");
      },
      reads: () => [
        { db: t.s.db, viewer: { role: "dm", features: [] }, campaignId: t.h.campaignId },
      ],
      characters: () => new Map(),
      onError: (err) => errors.push(err),
    });
    await p.build(t.h.campaignId);
    expect(errors).toHaveLength(1);
    expect(p.isBuilding(t.h.campaignId)).toBe(false);
  });
});

describe("FR-STATS-49 retroactive", () => {
  test("FR-STATS-49 three sittings (injected clock): per-session luck and the campaign sum", async () => {
    const t = statsSetup();
    t.roll("Mira", 20, { actor: t.p1 });
    t.clock.advance(7 * HOUR);
    t.roll("Mira", 1, { actor: t.p1 });
    t.clock.advance(7 * HOUR);
    t.roll("Mira", 20, { actor: t.p1 });
    const list = t.sessions(t.p1).sessions;
    expect(list).toHaveLength(3);
    const per = list.map((s) => t.luck(t.p1, { n: s.fromN }).rows[0]?.nat20);
    expect(per).toEqual([1, 0, 1]);
    expect((await campaignLuck(t, t.p1)).rows[0]).toMatchObject({ rolls: 3, nat20: 2, nat1: 1 });
  });
});

describe("FR-STATS-53 show awards once", () => {
  test("FR-STATS-53 Show awards makes one row per press (the client toasts and opens once per row)", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 3, { from: "Thorn" });
    const key = t.session().session?.fromN as number;
    const seen: string[] = [];
    t.s.bus.subscribe("test-once", (d) => {
      if (d.event.type === "NotificationCreated") seen.push(d.event.type);
    });
    t.run(STATS_SHOW_AWARDS_INTENT, { fromN: key });
    expect(seen).toHaveLength(1);
  });
});
