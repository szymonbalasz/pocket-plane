// Stats Campaign tab in-process (STATS §13.4, sprint 10 T3): `stats.query {scope: "campaign"}`
// over two sittings (injected clock) and two fights of combat-tracker's ambush (Mira = Player 1,
// Thorn = Player 2; Goblin 7 HP, Goblin 2 visible; Wolf 11 HP, Elite hidden): every number per
// role (FR-STATS-81–84, -86), the Session tab's winners (FR-STATS-84), the pipeline (FR-STATS-87).
//
// Sitting 1, fight A: Thorn 30 → Goblin (callout kill, overkill 23); Mira 30 → the hidden Wolf
// (DM-only kill, overkill 19); the hidden Elite 4 → Thorn (DM-only); Goblin 2 40 → Mira (down);
// Thorn heals Mira 5; Thorn nat 20 (Player 2) and a hidden DM roll as Thorn, nat 20.
// Sitting 2 (+7 h), fight B (same tokens, so HP carries): the DM heals the Goblin 7 (no source);
// Mira 10 → Goblin 2 (kill, overkill 3, no callout); Mira 7 → Goblin (kill); Mira heals Thorn 12;
// Mira nat 1 (Player 1).
import { describe, expect, test } from "bun:test";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import {
  CampaignResult,
  type CampaignStats,
  type SessionResult,
  type SessionsResult,
} from "@shared/stats/schemas";
import type { Actor } from "../../events/types";
import { applyHp } from "../combat-tracker/hp";
import { startCommand } from "../combat-tracker/lifecycle";
import { statsSetup } from "./testing";

type T = ReturnType<typeof statsSetup>;
const HOUR = 60 * 60 * 1000;

/** The two sittings above; fight B's ids. */
function twoSittings() {
  const t = statsSetup();
  t.hp("Goblin", "damage", 30, { from: "Thorn" });
  t.hp("Wolf", "damage", 30, { from: "Mira", public: false });
  t.hp("Thorn", "damage", 4, { from: "Elite Goblin Warrior" });
  t.hp("Mira", "damage", 40, { from: "Goblin 2" });
  t.hp("Mira", "heal", 5, { from: "Thorn" });
  t.roll("Thorn", 20, { actor: t.p2 });
  t.roll("Thorn", 20, { public: false });
  t.run(CBT_INTENTS.end, { encounterId: t.enc.id });
  t.clock.advance(7 * HOUR);
  const b = t.createAmbush();
  t.run(startCommand.name, { encounterId: b.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(b.id)[name]?.id as string;
  const hp = (target: string, kind: "damage" | "heal", amount: number, from?: string) =>
    t.run<{ hpChangeId: string }>(applyHp.name, {
      combatantId: id(target),
      kind,
      amount,
      public: true,
      ...(from ? { sourceId: id(from) } : {}),
    }).hpChangeId;
  hp("Goblin", "heal", 7);
  hp("Goblin 2", "damage", 10, "Mira");
  hp("Goblin", "damage", 7, "Mira");
  hp("Thorn", "heal", 12, "Mira");
  t.roll("Mira", 1, { actor: t.p1 });
  t.run(CBT_INTENTS.end, { encounterId: b.id });
  return { ...t, fightB: b };
}

function campaignOf(t: T, actor: Actor = t.h.dm): CampaignStats {
  t.clock.advance(1000);
  const c = CampaignResult.parse(t.query({ scope: "campaign" }, actor)).campaign;
  if ("pending" in c) throw new Error("pending");
  return c;
}

const rowsOf = (c: CampaignStats) =>
  Object.fromEntries(
    c.rows.map((r) => [
      r.name,
      [r.dealt, r.taken, r.healed, r.kills, r.downed, r.nat20, r.nat1, r.fights],
    ]),
  );
const recordsOf = (c: CampaignStats) =>
  Object.fromEntries(
    Object.entries(c.records).map(([k, r]) => [k, r && [r.name, r.value, r.to ?? null]]),
  );
const awardsOf = (c: CampaignStats) =>
  Object.fromEntries(
    c.awards.map((a) => [a.name, [a.total, ...a.won.map((w) => `${w.key}×${w.count}`)]]),
  );

describe("FR-STATS-81 Campaign scope", () => {
  test("FR-STATS-81 FR-STATS-82 FR-STATS-83 FR-STATS-84 two sittings, two fights: every number per role", () => {
    const t = twoSittings();
    const dm = campaignOf(t);
    // Header: 2 sessions, 2 fights; slain: Goblin, the hidden Wolf (A), Goblin 2, Goblin (B).
    expect([dm.sessions, dm.fights, dm.slain]).toEqual([2, 2, 4]);
    // dealt, taken, healed, kills, downed, nat 20s, nat 1s, fights
    expect(rowsOf(dm)).toEqual({
      Mira: [47, 40, 12, 3, 1, 0, 1, 2],
      Thorn: [30, 4, 5, 1, 0, 2, 0, 2],
    });
    expect(dm.rows.map((r) => r.name)).toEqual(["Mira", "Thorn"]); // by Dealt
    expect(recordsOf(dm)).toEqual({
      // Thorn's 30 and Mira's 30 on the Wolf tie: the earlier hit.
      "biggest-hit": ["Thorn", 30, "Goblin"],
      "biggest-overkill": ["Thorn", 23, "Goblin"],
      "best-fight-damage": ["Thorn", 30, null],
      "best-fight-kills": ["Mira", 2, null],
      "best-fight-healing": ["Mira", 12, null],
    });
    expect(dm.records["biggest-hit"]?.fight).toMatch(/^Ambush at the Ford · /);
    expect(awardsOf(dm)).toEqual({
      // Sitting 1: hit, dealt, kills (ties with Thorn), taken, downed; sitting 2: hit, overkill
      // (3, DM), dealt, healing, kills, nat 1.
      Mira: [
        11,
        "biggest-hit×2",
        "biggest-overkill×1",
        "most-dealt×2",
        "most-taken×1",
        "most-healing×1",
        "most-kills×2",
        "most-nat1×1",
        "most-downed×1",
      ],
      // Sitting 1: hit, overkill, dealt, healing, kills, nat 20s.
      Thorn: [
        6,
        "biggest-hit×1",
        "biggest-overkill×1",
        "most-dealt×1",
        "most-healing×1",
        "most-kills×1",
        "most-nat20×1",
      ],
    });

    const p1 = campaignOf(t, t.p1);
    expect(campaignOf(t, t.p2)).toEqual(p1); // every player the same numbers (FR-STATS-03)
    expect([p1.sessions, p1.fights, p1.slain]).toEqual([2, 2, 3]);
    expect(rowsOf(p1)).toEqual({
      // No Wolf (hidden), no Elite's 4, no hidden nat 20.
      Mira: [17, 40, 12, 2, 1, 0, 1, 2],
      Thorn: [30, 0, 5, 1, 0, 1, 0, 2],
    });
    // BL-121: the campaign holds Mira's hidden 30 on the Wolf (party damage players don't see),
    // so players get no damage record; healing was all in sight.
    expect(recordsOf(p1)).toEqual({ "best-fight-healing": ["Mira", 12, null] });
    expect(p1.records["best-fight-healing"]?.fight).toMatch(/^Fight 2 · /);
    expect(awardsOf(p1)).toEqual({
      // Sitting 2: hit, dealt, healing, kills, nat 1 (no callout). Sitting 1 (BL-111 / BL-121)
      // holds Mira's hidden 30 on the Wolf (dealt), the hidden Elite's 4 on Thorn (taken) and the
      // DM's hidden nat 20 as Thorn (rolled): players' only card there is Most healing.
      Mira: [5, "biggest-hit×1", "most-dealt×1", "most-healing×1", "most-kills×1", "most-nat1×1"],
      Thorn: [1, "most-healing×1"],
    });
  });

  test("FR-STATS-84 BL-111 players' awards won leave out Most damage dealt for a session that withholds the card; the DM keeps it", () => {
    const t = twoSittings();
    const [newest, oldest] = t.sessions(t.p1).sessions;
    const cards = (actor: Actor, fromN: number) =>
      (t.session(actor, fromN).session as NonNullable<SessionResult["session"]>).awards.map(
        (a) => a.key,
      );
    expect(cards(t.p1, oldest?.fromN as number)).not.toContain("most-dealt");
    expect(cards(t.p1, newest?.fromN as number)).toContain("most-dealt");
    const won = (c: CampaignStats, name: string) =>
      c.awards.find((a) => a.name === name)?.won.find((w) => w.key === "most-dealt")?.count ?? 0;
    const p = campaignOf(t, t.p1);
    expect([won(p, "Thorn"), won(p, "Mira")]).toEqual([0, 1]);
    const dm = campaignOf(t);
    expect([won(dm, "Thorn"), won(dm, "Mira")]).toEqual([1, 2]);
    expect(JSON.stringify(p)).not.toContain('"most-dealt","count":2');
  });

  test("FR-STATS-84 awards won = the Session tab's winners summed over the listed sessions, per role", () => {
    const t = twoSittings();
    for (const actor of [t.h.dm, t.p1]) {
      const won = new Map<string, number>();
      for (const s of t.sessions(actor).sessions) {
        const one = t.session(actor, s.fromN).session as NonNullable<SessionResult["session"]>;
        for (const a of one.awards) {
          for (const w of a.winners) won.set(w.name, (won.get(w.name) ?? 0) + 1);
        }
      }
      const c = campaignOf(t, actor);
      expect(Object.fromEntries(c.awards.map((a) => [a.name, a.total]))).toEqual(
        Object.fromEntries(won),
      );
      expect(c.sessions).toBe((t.sessions(actor) as SessionsResult).sessions.length);
    }
  });

  test("FR-STATS-82 a row is the character's Trophies Lifetime, per role", () => {
    const t = twoSittings();
    for (const [actor, who] of [
      [t.h.dm, t.miraId],
      [t.h.dm, t.thornId],
      [t.p1, t.miraId],
      [t.p2, t.thornId],
    ] as const) {
      const life = t.trophies(who, actor).lifetime;
      const row = campaignOf(t, actor).rows.find((r) => r.key === who);
      expect(row).toMatchObject({
        dealt: life?.dealt,
        taken: life?.taken,
        healed: life?.healing,
        kills: life?.kills,
        downed: life?.downed,
        nat20: life?.nat20,
        nat1: life?.nat1,
        fights: life?.fights,
      });
    }
  });

  test("FR-STATS-81 no fact yet: zero header, no rows, records null, no awards", () => {
    const t = statsSetup();
    for (const actor of [t.h.dm, t.p1]) {
      const c = campaignOf(t, actor);
      expect(c.fights).toBe(0);
      expect(c.slain).toBe(0);
      expect(c.rows).toEqual([]);
      expect(c.awards).toEqual([]);
      expect(Object.values(c.records).every((r) => r === null)).toBe(true);
    }
  });
});

describe("FR-STATS-87 read path", () => {
  test("FR-STATS-87 one memo per viewer class (players share it); over the per-viewer rate the last answer", () => {
    const t = statsSetup();
    t.hp("Goblin", "damage", 30, { from: "Thorn" });
    const gate = t.memory().gate;
    t.clock.advance(1000);
    const before = gate.computed;
    const a = t.query({ scope: "campaign" }, t.p1);
    expect(t.query({ scope: "campaign" }, t.p2)).toEqual(a);
    expect(t.query({ scope: "campaign" }, t.p1)).toEqual(a);
    expect(gate.computed - before).toBe(1);
    // A new fact stales the memo; the next answer is recomputed.
    t.hp("Goblin 2", "damage", 3, { from: "Thorn" });
    t.clock.advance(1000);
    const thorn = (x: unknown) =>
      (CampaignResult.parse(x).campaign as CampaignStats).rows.find((r) => r.name === "Thorn")
        ?.dealt;
    expect(thorn(t.query({ scope: "campaign" }, t.p1))).toBe(33);
    expect(gate.computed - before).toBe(2);
    // FR-STATS-16 / -69: a viewer's 5th computed answer in one second gets the last answer.
    t.clock.advance(1000);
    for (let i = 0; i < 4; i++) {
      t.hp("Goblin 2", "damage", 1, { from: "Thorn" });
      expect(thorn(t.query({ scope: "campaign" }, t.h.dm))).toBe(34 + i);
    }
    t.hp("Goblin 2", "damage", 1, { from: "Thorn" });
    expect(thorn(t.query({ scope: "campaign" }, t.h.dm))).toBe(37);
    t.clock.advance(1000);
    expect(thorn(t.query({ scope: "campaign" }, t.h.dm))).toBe(38);
  });

  test("FR-STATS-87 an undo in an old session drops its partial: the answer matches the recompute", () => {
    const t = statsSetup();
    const old = t.hp("Goblin", "damage", 30, { from: "Thorn" });
    t.clock.advance(7 * HOUR);
    t.roll("Mira", 20, { actor: t.p1 });
    expect(campaignOf(t).rows.find((r) => r.name === "Thorn")?.dealt).toBe(30);
    t.undo(old);
    const after = campaignOf(t);
    expect(after.rows.find((r) => r.name === "Thorn")).toBeUndefined();
    expect(after.slain).toBe(0);
    expect(after.awards.map((a) => a.name)).toEqual(["Mira"]);
  });

  test("FR-STATS-87 FR-STATS-46 more than 5 unbuilt sessions → pending (never memoised); built → the answer", async () => {
    const t = statsSetup();
    for (let i = 0; i < 7; i++) {
      t.clock.advance(7 * HOUR);
      t.roll("Thorn", 20, { actor: t.p2 });
    }
    t.memory().partials.dropAll(t.h.campaignId);
    t.clock.advance(1000);
    const first = CampaignResult.parse(t.query({ scope: "campaign" }, t.p1)).campaign;
    // The drop-all's rebuild may finish first on a fast machine; otherwise the answer is pending.
    if ("pending" in first) {
      await t.memory().partials.build(t.h.campaignId);
      const c = campaignOf(t, t.p1);
      expect(c.rows.find((r) => r.name === "Thorn")?.nat20).toBe(7);
    } else {
      expect(first.rows.find((r) => r.name === "Thorn")?.nat20).toBe(7);
    }
    expect(campaignOf(t, t.p1).sessions).toBe(t.sessions(t.p1).sessions.length);
  });
});
