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
// Session awards, DM | players: Biggest hit Thorn 30 | 30; Biggest overkill Thorn 23 | 30;
//   Most damage dealt Thorn 73; Most damage taken Brakka 55; Most healing Brakka 8; Most kills
//   Thorn 3; Most nat 20s Thorn 3 | 2 (one hidden DM roll); Most nat 1s Mira 1; Most times
//   downed Mira, Brakka 1 (tie).
import { afterAll, describe, expect, test } from "bun:test";
import { combatant, encounter, entity, hpChange, notification, player } from "@server/db/schema";
import { servicesFromBundle } from "@server/ws/testing/snapshot-size";
import { DamageCardPayload } from "@shared/combat-tracker/schemas";
import {
  type Award,
  type DmFightResult,
  type PlayerFightResult,
  type SessionResult,
  STATS_QUERY_INTENT,
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
    expect(awardsOf(p?.awards ?? [])).toEqual({
      "biggest-hit": [30, "Thorn"],
      "biggest-overkill": [30, "Thorn"],
      "most-dealt": [73, "Thorn"],
      "most-taken": [55, "Brakka"],
      "most-healing": [8, "Brakka"],
      "most-kills": [3, "Thorn"],
      "most-nat20": [2, "Thorn"],
      "most-nat1": [1, "Mira"],
      "most-downed": [1, "Brakka", "Mira"],
    });
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
    // The crypt's facts are the session's; the ambush has none yet.
    const s = t.q<SessionResult>({ scope: "session" }, t.as("Player 1")).session;
    expect(s?.fights).toBe(1);
    expect(s?.awards.find((a) => a.key === "biggest-overkill")?.value).toBe(30);
  }, 60_000);
});
