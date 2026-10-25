// STATS §13 fixtures: `st-past-crypt`, `st-ambush-facts`; bundles `stats-past`, `stats`,
// `stats-e2e`, and `session-sim-11`'s ST part. Expected numbers (one past session, fixed clock):
//
// Fight "Ambush at the Ford" (players: "Fight 2 · ‹day›"), DM | players:
//   Thorn   Dealt 30 | 30  Taken 9 | 0   Kills 1 | 1   (the hidden Elite's 9 is DM-only)
//   Brakka  Dealt 12 | 12  Taken 55 | 55 Healed 8 | 8  Kills 1 | 1
//   Mira    Dealt 11 | 0   Taken 11 | 11 Kills 1 | 0   (late damage on the hidden Goblin 2)
//   Owlbear Dealt 7 | 7    Kills 1 | 1   (under Mira)
//   DM only: Elite Dealt 9 (hidden), "DM (direct)" Dealt 3 (on the hidden Wolf)
// Fight "Old Crypt" (players: "Fight 1 · ‹day›"): Thorn Dealt 43, Kills 2; Mira Taken 15, down;
//   DM: Skeleton 2 Dealt 15, "Unattributed" Healed 12.
// Session awards, DM: Biggest hit Thorn 30; Biggest overkill Thorn 23; Most damage dealt Thorn 73;
//   Most damage taken Brakka 55; Most healing Brakka 8; Most kills Thorn 3; Most nat 20s Thorn 3;
//   Most nat 1s Mira 1; Most times downed Mira, Brakka 1 (tie). Players (BL-111 / BL-121): only
//   Most healing Brakka 8: Mira's DM-only 11 withholds the damage cards, the hidden Elite's 9 on
//   Thorn Most damage taken / times downed, the hidden DM roll as Thorn Most nat 20s / 1s.
//
// Sprint 8 `stats-b` (= `stats` + gems on + `sb-fight-facts`, `sb-luck-rolls`, `sb-luck-reroll`),
// DM | players:
//   Luck · Campaign: Mira rolls 7, d20s 8, avg 12.5, nat 20s 1, nat 1s 1 (both; the advantage's
//   dropped 3 and the reroll's 17 count, the 4 and the "Me" nat 20 never); Thorn rolls 7 | 5,
//   nat 20s 5 | 3 (two hidden DM rolls), nat 1s 1 | 1; "DM dice" rolls 1, nat 20s 1 | none.
//   Ambush Highlights: players' Kills Goblin Scout (Thorn, overkill), Goblin Scout 3 (Brakka),
//   Goblin Scout 4 (Owlbear), Bandit (Mira, overkill), Bandit 3 (Owlbear); the DM's add Goblin 2
//   (Mira) and the Bandit Captain (Thorn), both hidden. Downs: Brakka (Goblin Scout 2), Thorn
//   (Bandit 2, overkill). Still standing (DM): Goblin, Wolf, Elite (hidden), Goblin Scout 2,
//   Bandit 2, Bandit 4.
//   Trophies: Mira (Player 1) fights 2, dealt 43, taken 26, kills 3, downed 1; no Records (BL-121:
//   the campaign holds party damage players don't see). Thorn (DM) dealt 93, taken 209, kills 4,
//   nat 20s 5; Biggest hit 30 → Skeleton (Old Crypt), overkill 23 → Goblin Scout.
//
// Sprint 10 T3 `stats-b` Campaign tab (one session), DM | players:
//   Header: sessions 1, fights 2, monsters slain 9 | 7 (the hidden Goblin 2 and Captain).
//   Party (dealt, taken, healed, kills, downed, nat 20s, nat 1s, fights):
//     Thorn  93 | 73, 209 | 200, 0, 4 | 3, 1, 5 | 3, 1, 2
//     Mira   54 | 43, 26, 0, 4 | 3, 1, 1, 1, 2
//     Brakka 12, 55, 8, 1, 1, 0, 0, 1
//   Records, DM: Biggest hit Thorn 30 → Skeleton (Old Crypt); Biggest overkill Thorn 23 → Goblin
//   Scout (Ambush); most damage in a fight Mira 54 (Ambush); most kills Mira 4 (Ambush); most
//   healing Brakka 8. Players (BL-121): most healing Brakka 8 only (the damage records withheld).
//   Awards won: DM Thorn 8, Mira 3, Brakka 2 (the one session's winners, ties count); players
//   Brakka 1 (Most healing, the one card they get: BL-111 / BL-121).
import { afterAll, describe, expect, test } from "bun:test";
import { combatant, encounter, entity, hpChange, notification, player } from "@server/db/schema";
import { servicesFromBundle } from "@server/ws/testing/snapshot-size";
import { DamageCardPayload } from "@shared/combat-tracker/schemas";
import { dayLabel } from "@shared/stats/rules";
import {
  type Award,
  CampaignResult,
  type CampaignStats,
  type DmFightResult,
  DmHighlights,
  type DmLuckResult,
  type PlayerFightResult,
  PlayerHighlights,
  type SessionResult,
  STATS_QUERY_INTENT,
  type TrophiesResult,
} from "@shared/stats/schemas";
import { asc, eq } from "drizzle-orm";
import { library, loadBundle } from "../../index";
import { BRAKKA_DAMAGE_ROLL, MIRA_LATE_ROLL } from "./st-ambush-facts";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

async function loaded(bundle: string) {
  const l = await loadBundle(bundle, { testMode: true });
  const { s, cleanup } = await servicesFromBundle(l);
  cleanups.push(cleanup);
  const players = s.db.select().from(player).all();
  const campaignId = players[0]?.campaignId as string;
  const p = (name: string) => players.find((x) => x.name === name)?.id as string;
  const dm = { role: "dm" as const, playerId: null, campaignId };
  const as = (name: string) => ({ role: "player" as const, playerId: p(name), campaignId });
  const q = <R>(input: unknown, actor: typeof dm | ReturnType<typeof as>) =>
    s.commands.run(STATS_QUERY_INTENT, input, { actor }) as R;
  return { s, dm, as, q, manifest: l.manifest };
}

const table = (
  rows: readonly { name: string; dealt: number; taken: number; healed: number; kills: number }[],
) => Object.fromEntries(rows.map((r) => [r.name, [r.dealt, r.taken, r.healed, r.kills]]));
const awardsOf = (awards: readonly Award[]) =>
  Object.fromEntries(awards.map((a) => [a.key, [a.value, ...a.winners.map((w) => w.name).sort()]]));

describe("STATS §13 fixtures", () => {
  test("stats bundle: loads from empty; the seeded rolls the unit names are the cards' damage rolls", async () => {
    const t = await loaded("stats");
    const cards = t.s.db
      .select()
      .from(notification)
      .where(eq(notification.kind, "damage-card"))
      .orderBy(asc(notification.seq))
      .all()
      .map((n) => DamageCardPayload.parse(n.payload).damage?.rollId);
    expect(cards).toContain(BRAKKA_DAMAGE_ROLL());
    expect(cards).toContain(MIRA_LATE_ROLL());
    // Nothing left pending by the unit (the concentration save was rolled).
    expect(
      t.s.db
        .select()
        .from(notification)
        .all()
        .filter((n) => n.state === "pending").length,
    ).toBe(0);
    const undone = t.s.db.select().from(hpChange).where(eq(hpChange.undone, true)).all();
    expect(undone.map((r) => [r.attackerName, r.targetName, r.raw])).toEqual([
      ["Thorn", "Goblin Scout 2", 5],
    ]);
    const crypt = t.s.db.select().from(encounter).where(eq(encounter.name, "Old Crypt")).get();
    expect(crypt?.status).toBe("ended");
  }, 60_000);

  test("stats bundle: the Fight tab numbers per role (header)", async () => {
    const t = await loaded("stats");
    const dm = t.q<DmFightResult>({ scope: "fight" }, t.dm);
    expect(dm.fight?.label).toBe("Ambush at the Ford");
    const d = table(dm.fight?.rows ?? []);
    expect(d.Thorn).toEqual([30, 9, 0, 1]);
    expect(d.Brakka).toEqual([12, 55, 8, 1]);
    expect(d.Mira).toEqual([11, 11, 0, 1]);
    expect(d.Owlbear).toEqual([7, 0, 0, 1]);
    expect(d["Elite Goblin Warrior"]).toEqual([9, 0, 0, 0]);
    expect(d["DM (direct)"]).toEqual([3, 0, 0, 0]);
    expect(d.Wolf).toEqual([0, 3, 0, 0]);
    expect(dm.fights.map((f) => f.label)).toEqual(["Ambush at the Ford", "Old Crypt"]);
    for (const name of ["Player 1", "Player 2"]) {
      const p = t.q<PlayerFightResult>({ scope: "fight" }, t.as(name));
      expect(p.fight?.label).toMatch(/^Fight 2 · /);
      expect(p.fights.map((f) => f.label.slice(0, 7))).toEqual(["Fight 2", "Fight 1"]);
      const r = table(p.fight?.rows ?? []);
      expect(r.Thorn).toEqual([30, 0, 0, 1]);
      expect(r.Brakka).toEqual([12, 55, 8, 1]);
      expect(r.Mira).toEqual([0, 11, 0, 0]);
      expect(r.Owlbear).toEqual([7, 0, 0, 1]);
      expect(Object.keys(r)).not.toContain("Elite Goblin Warrior");
      expect(Object.keys(r)).not.toContain("Goblin 2");
      expect(Object.keys(r)).not.toContain("DM (direct)");
    }
    const cryptKey = dm.fights[1]?.key as string;
    const crypt = table(
      t.q<DmFightResult>({ scope: "fight", encounterId: cryptKey }, t.dm).fight?.rows ?? [],
    );
    expect(crypt.Thorn).toEqual([43, 0, 0, 2]);
    expect(crypt.Mira).toEqual([0, 15, 0, 0]);
    expect(crypt.Unattributed).toEqual([0, 0, 12, 0]);
  }, 60_000);

  test("stats bundle: the session awards per role (header)", async () => {
    const t = await loaded("stats");
    const dm = t.q<SessionResult>({ scope: "session" }, t.dm).session;
    expect(dm?.fights).toBe(2);
    expect(awardsOf(dm?.awards ?? [])).toEqual({
      "biggest-hit": [30, "Thorn"],
      "biggest-overkill": [23, "Thorn"],
      "most-dealt": [73, "Thorn"],
      "most-taken": [55, "Brakka"],
      "most-healing": [8, "Brakka"],
      "most-kills": [3, "Thorn"],
      "most-nat20": [3, "Thorn"],
      "most-nat1": [1, "Mira"],
      "most-downed": [1, "Brakka", "Mira"],
    });
    const p = t.q<SessionResult>({ scope: "session" }, t.as("Player 2")).session;
    expect(p?.fromN).toBe(dm?.fromN);
    // BL-111 / BL-121: Mira's late 11 on the hidden Goblin 2 (dealt), the hidden Elite's 9 on
    // Thorn (taken) and the DM's hidden nat 20 as Thorn (rolled) leave one card, the same as the
    // DM's.
    expect(awardsOf(p?.awards ?? [])).toEqual({ "most-healing": [8, "Brakka"] });
  }, 60_000);

  test("stats-e2e and session-sim-11: the past crypt loads first; sim-10's running fight is unchanged", async () => {
    expect(library.bundles.find((b) => b.name === "stats-e2e")?.includes).toEqual(["stats"]);
    const t = await loaded("session-sim-11");
    const encs = t.s.db.select().from(encounter).orderBy(asc(encounter.seq)).all();
    expect(encs.map((e) => [e.name, e.status])).toEqual([
      ["Old Crypt", "ended"],
      ["Ambush at the Ford", "started"],
      ["Escort to the Ford", "planned"],
    ]);
    // Mira was healed back to full in the crypt: sim-10 starts as before (12 / 12).
    const mira = t.s.db.select().from(entity).where(eq(entity.name, "Mira")).get();
    expect(mira?.hpCurrent).toBe(12);
    const ambush = encs[1]?.id as string;
    const names = t.s.db
      .select({ name: combatant.name })
      .from(combatant)
      .where(eq(combatant.encounterId, ambush))
      .all()
      .map((c) => c.name);
    expect(names).toContain("Brakka");
    expect(names).not.toContain("Goblin Scout");
    // The crypt's facts are in the session (FU's units may add the ambush's own); the crypt is
    // the first fight players list.
    const s = t.q<SessionResult>({ scope: "session" }, t.as("Player 1")).session;
    expect(s?.fights).toBeGreaterThanOrEqual(1);
    const overkill = s?.awards.find((a) => a.key === "biggest-overkill");
    expect(overkill).toMatchObject({ value: 30, detail: { to: "Skeleton" } });
    expect(overkill?.detail?.fight).toMatch(/^Fight 1 · /);
  }, 60_000);

  test("stats-b bundle: loads from empty; luck, highlights and trophies per role (header)", async () => {
    const t = await loaded("stats-b");
    const chars = t.s.db.select().from(entity).where(eq(entity.kind, "character")).all();
    const id = (name: string) => chars.find((c) => c.name === name)?.id as string;
    const luck = (actor: typeof t.dm | ReturnType<typeof t.as>) =>
      Object.fromEntries(
        t
          .q<DmLuckResult>({ scope: "luck", campaign: true }, actor)
          .luck.rows.map((r) => [r.name, [r.rolls, r.d20s, r.avg, r.nat20, r.nat1]]),
      );
    expect(luck(t.dm)).toEqual({
      Mira: [7, 8, 12.5, 1, 1],
      Thorn: [7, 7, 16.6, 5, 1],
      "DM dice": [1, 1, 20, 1, 0],
    });
    for (const p of ["Player 1", "Player 2"]) {
      expect(luck(t.as(p))).toEqual({ Mira: [7, 8, 12.5, 1, 1], Thorn: [5, 5, 15.2, 3, 1] });
    }
    const kills = (h: { kills: { events: { to: string }[] } }) => h.kills.events.map((e) => e.to);
    const dm = DmHighlights.parse(t.q<DmFightResult>({ scope: "fight" }, t.dm).fight?.highlights);
    expect(kills(dm)).toEqual([
      "Goblin Scout",
      "Goblin Scout 3",
      "Goblin 2",
      "Goblin Scout 4",
      "Bandit",
      "Bandit Captain",
      "Bandit 3",
    ]);
    expect(dm.standing.map((s) => s.name)).toEqual([
      "Goblin",
      "Wolf",
      "Elite Goblin Warrior",
      "Goblin Scout 2",
      "Bandit 2",
      "Bandit 4",
    ]);
    const p = PlayerHighlights.parse(
      t.q<PlayerFightResult>({ scope: "fight" }, t.as("Player 2")).fight?.highlights,
    );
    expect(kills(p)).toEqual([
      "Goblin Scout",
      "Goblin Scout 3",
      "Goblin Scout 4",
      "Bandit",
      "Bandit 3",
    ]);
    expect(p.downed.events.map((e) => [e.from, e.to])).toEqual([
      ["Goblin Scout 2", "Brakka"],
      ["Bandit 2", "Thorn"],
    ]);
    const mira = t.q<TrophiesResult>(
      { scope: "trophies", characterId: id("Mira") },
      t.as("Player 1"),
    ).trophies;
    expect(mira.lifetime).toMatchObject({ fights: 2, dealt: 43, taken: 26, kills: 3, downed: 1 });
    // BL-121: no Records for players (the campaign holds party damage they don't see).
    expect(mira.records).toEqual({});
    const thorn = t.q<TrophiesResult>(
      { scope: "trophies", characterId: id("Thorn") },
      t.dm,
    ).trophies;
    expect(thorn.lifetime).toMatchObject({ dealt: 93, taken: 209, kills: 4, nat20: 5 });
    expect(thorn.records?.["biggest-hit"]).toEqual({
      value: 30,
      to: "Skeleton",
      fight: "Old Crypt",
    });
    // Bandit 4 stays a live target at 11 HP (walkthrough step 2).
    const b4 = t.s.db.select().from(combatant).where(eq(combatant.name, "Bandit 4")).get();
    expect(b4?.hpCurrent).toBe(11);
    expect(library.bundles.find((b) => b.name === "stats-b-e2e")?.includes).toEqual(["stats-b"]);
    // SB1 + SB2's e2e alias (`e2e/stats-ui-b.e2e.ts` changes state on its own server).
    expect(library.bundles.find((b) => b.name === "stats-b-ui-e2e")?.includes).toEqual(["stats-b"]);
  }, 60_000);

  test("FR-STATS-81 FR-STATS-82 FR-STATS-83 FR-STATS-84 stats-b bundle: the Campaign tab per role (header)", async () => {
    const t = await loaded("stats-b");
    const ask = (actor: typeof t.dm | ReturnType<typeof t.as>) => {
      const c = CampaignResult.parse(t.q({ scope: "campaign" }, actor)).campaign;
      if ("pending" in c) throw new Error("pending");
      return c;
    };
    const rows = (c: CampaignStats) =>
      Object.fromEntries(
        c.rows.map((r) => [
          r.name,
          [r.dealt, r.taken, r.healed, r.kills, r.downed, r.nat20, r.nat1, r.fights],
        ]),
      );
    const records = (c: CampaignStats) =>
      Object.fromEntries(
        Object.entries(c.records).map(([k, r]) => [k, r && [r.name, r.value, r.to, r.fight]]),
      );
    const awards = (c: CampaignStats) => c.awards.map((a) => [a.name, a.total]);
    const day = (iso: string) => dayLabel(iso);
    const at = t.s.db.select().from(encounter).all();
    const started = (name: string) => day(at.find((e) => e.name === name)?.startedAt as string);
    const dm = ask(t.dm);
    expect([dm.sessions, dm.fights, dm.slain]).toEqual([1, 2, 9]);
    expect(rows(dm)).toEqual({
      Thorn: [93, 209, 0, 4, 1, 5, 1, 2],
      Mira: [54, 26, 0, 4, 1, 1, 1, 2],
      Brakka: [12, 55, 8, 1, 1, 0, 0, 1],
    });
    expect(dm.rows.map((r) => r.name)).toEqual(["Thorn", "Mira", "Brakka"]);
    const crypt = `Old Crypt · ${started("Old Crypt")}`;
    const ambush = `Ambush at the Ford · ${started("Ambush at the Ford")}`;
    expect(records(dm)).toEqual({
      "biggest-hit": ["Thorn", 30, "Skeleton", crypt],
      "biggest-overkill": ["Thorn", 23, "Goblin Scout", ambush],
      "best-fight-damage": ["Mira", 54, undefined, ambush],
      "best-fight-kills": ["Mira", 4, undefined, ambush],
      "best-fight-healing": ["Brakka", 8, undefined, ambush],
    });
    expect(awards(dm)).toEqual([
      ["Thorn", 8],
      ["Mira", 3],
      ["Brakka", 2],
    ]);
    const first = ask(t.as("Player 1"));
    expect(ask(t.as("Player 2"))).toEqual(first);
    expect([first.sessions, first.fights, first.slain]).toEqual([1, 2, 7]);
    expect(rows(first)).toEqual({
      Thorn: [73, 200, 0, 3, 1, 3, 1, 2],
      Mira: [43, 26, 0, 3, 1, 1, 1, 2],
      Brakka: [12, 55, 8, 1, 1, 0, 0, 1],
    });
    const f1 = `Fight 1 · ${started("Old Crypt")}`;
    const f2 = `Fight 2 · ${started("Ambush at the Ford")}`;
    // BL-121: the damage records are withheld (party damage players don't see); healing stays.
    expect(f1).toMatch(/^Fight 1 · /);
    expect(records(first)).toEqual({ "best-fight-healing": ["Brakka", 8, undefined, f2] });
    expect(awards(first)).toEqual([["Brakka", 1]]);
    // Thorn's and Mira's rows match the trophies above (Lifetime definitions, FR-STATS-42).
    // T3's e2e alias (`e2e/t3-campaign.e2e.ts`).
    expect(library.bundles.find((b) => b.name === "stats-campaign-e2e")?.includes).toEqual([
      "stats-b",
    ]);
  }, 60_000);

  test("session-sim-12 loads from empty; sb-past-bandits and sb-luck-rolls are session-sim-11-safe (no gems, Goblins untouched)", async () => {
    for (const key of ["sb-past-bandits", "sb-luck-rolls"]) {
      const unit = library.fixtures.find((f) => f.key === key);
      expect(unit?.requires).not.toContain("gems-on");
      expect(unit?.requires).not.toContain("st-ambush-facts");
    }
    const sim12 = library.bundles.find((x) => x.name === "session-sim-12");
    expect(sim12?.includes[0]).toBe("stats-b-past");
    expect(sim12?.fixtures).toContain("sb-luck-rolls");
    expect(sim12?.fixtures).not.toContain("sb-fight-facts");
    const l = await loadBundle("session-sim-12", { testMode: true });
    const { s, cleanup } = await servicesFromBundle(l);
    cleanups.push(cleanup);
    // cp-ally's charmed Goblin 2 and fu-hurt-goblins' Goblins are untouched.
    const goblins = s.db
      .select({ name: combatant.name, hp: combatant.hpCurrent })
      .from(combatant)
      .all()
      .filter((c) => c.name === "Goblin" || c.name === "Goblin 2");
    const before = await loadBundle("session-sim-11", { testMode: true });
    const base = await servicesFromBundle(before);
    cleanups.push(base.cleanup);
    const baseGoblins = base.s.db
      .select({ name: combatant.name, hp: combatant.hpCurrent })
      .from(combatant)
      .all()
      .filter((c) => c.name === "Goblin" || c.name === "Goblin 2");
    expect(goblins).toEqual(baseGoblins);
  }, 60_000);
});
