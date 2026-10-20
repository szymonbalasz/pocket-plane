// CAMP server colours: sprint 5 (K0) FR-CAMP-23 defaults, FR-CAMP-24 DM colour, FR-CAMP-25
// `camp.setColor` permissions + crash, FR-CAMP-26 uniqueness; sprint 6 (PF0) FR-CAMP-32
// defaults by distance, FR-CAMP-33 hex input + reasons + crash, FR-CAMP-34 boot migration and
// hex on every insert.
import { afterEach, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { PLAYER_COLORS } from "@shared/campaign-management/colors";
import type { CampaignRecord, PlayerRecord } from "@shared/campaign-management/schemas";
import { PlayerColorSet } from "@shared/events/campaign-management";
import { eq } from "drizzle-orm";
import { manualClock } from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { campaign, player } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent } from "../../events/types";
import { silentLogger } from "../../log";
import { createServices, type Services } from "../../services";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { migratePlayerColors, setColor } from "./colors";
import { addPlayer, createCampaign } from "./commands";

afterEach(() => armCrashHook(null));

type Input = { playerId: string | null; color: string };
const P = PLAYER_COLORS;
const HEX = /^#[0-9a-f]{6}$/;
const LAVENDER = "#b388ff";

const snapshotOf = <T>(s: Services, type: string, campaignId: string, playerId: string | null) =>
  (s.records.snapshot(
    { db: s.db, presence: { list: () => [] } },
    { connId: "x", campaignId, role: playerId ? "player" : "dm", playerId },
  )[type] ?? []) as T[];

function errOf(f: () => unknown): { code: string; message: string } {
  try {
    f();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a CommandError");
}

function setup() {
  const s = createTestServices({ clock: manualClock() });
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-events", (e) => {
    events.push(e);
  });
  const seed = seedSyncProbe(s);
  const dm: Actor = { ...DM_ACTOR, campaignId: seed.campaignId };
  const asPlayer = (playerId: string): Actor => ({
    role: "player",
    playerId,
    campaignId: seed.campaignId,
  });
  const run = (input: Input, actor: Actor = dm) =>
    s.commands.run(setColor, input as never, { actor });
  const colorOf = (id: string) => s.db.select().from(player).where(eq(player.id, id)).get()?.color;
  const dmColor = (id = seed.campaignId) =>
    s.db.select().from(campaign).where(eq(campaign.id, id)).get()?.dmColor;
  const logged = () => readEventLog(s.db).filter((r) => r.type === PlayerColorSet.type);
  const add = (name: string) => s.commands.run(addPlayer, { name }, { actor: DM_ACTOR });
  const raw = (q: string, ...args: string[]) => s.db.$client.query(q).run(...args);
  return { s, events, seed, dm, asPlayer, run, colorOf, dmColor, logged, add, raw };
}

/** `run` returning `{}` or "code: message". */
function outcome(f: () => unknown): unknown {
  try {
    return f();
  } catch (e) {
    return e instanceof CommandError ? `${e.code}: ${e.message}` : e;
  }
}

describe("FR-CAMP-23 / -24 / -32 defaults", () => {
  test("FR-CAMP-32 defaults: Jade, Sky, … in add order, per campaign, as hex; all 8 taken → Amber (the farthest, ties in palette order) again; PlayerAdded's upsert carries it", () => {
    const t = setup();
    expect([t.colorOf(t.seed.p1.id), t.colorOf(t.seed.p2.id)]).toEqual([P.jade, P.sky]);
    // Another campaign counts on its own.
    expect(t.colorOf(t.seed.p3.id)).toBe(P.jade);
    const n0 = t.events.length;
    const added = ["C", "D", "E", "F", "G", "H", "I"].map((name) => t.add(name));
    // After Bronze all 8 are held (DM + 7 players): every distance is 0 → Amber, twice.
    expect(added.map((p) => t.colorOf(p.id))).toEqual([
      P.rose,
      P.yellow,
      P.blue,
      P.vermillion,
      P.bronze,
      P.amber,
      P.amber,
    ]);
    const first = t.events[n0]?.event;
    expect(first?.type).toBe("PlayerAdded");
    expect(first?.payload).toEqual({
      playerId: added[0]?.id,
      campaignId: t.seed.campaignId,
      name: "C",
    });
    expect(first?.changes[0]?.after).toMatchObject({ name: "C", color: P.rose });
  });

  test("FR-CAMP-32 defaults: a freed colour is the next default; the DM's and picked colours are skipped; a free lavender blocks Blue and Sky", () => {
    const t = setup();
    t.run({ playerId: t.seed.p1.id, color: P.rose }); // frees Jade
    expect(t.colorOf(t.add("C").id)).toBe(P.jade);
    t.run({ playerId: null, color: P.yellow }); // frees Amber, takes Yellow
    expect(t.colorOf(t.add("D").id)).toBe(P.amber);
    expect(t.colorOf(t.add("E").id)).toBe(P.blue);

    const u = setup();
    u.run({ playerId: u.seed.p2.id, color: LAVENDER }); // Sky freed, but lavender is 4.9 from it
    expect(u.colorOf(u.add("C").id)).toBe(P.rose);
    expect(u.colorOf(u.add("D").id)).toBe(P.yellow);
    expect(u.colorOf(u.add("E").id)).toBe(P.vermillion);
  });

  test("FR-CAMP-24 DM colour: a new campaign starts at Amber's hex; the campaign record carries dmColor in event and snapshot", () => {
    const t = setup();
    expect(t.dmColor()).toBe(P.amber);
    const n0 = t.events.length;
    const c = t.s.commands.run(createCampaign, { name: "Third" }, { actor: DM_ACTOR });
    expect(t.dmColor(c.id)).toBe(P.amber);
    expect(t.events[n0]?.event.changes[0]?.after).toEqual({
      id: c.id,
      name: "Third",
      dmColor: P.amber,
    });
    for (const viewer of [null, t.seed.p1.id]) {
      expect(snapshotOf<CampaignRecord>(t.s, "campaign", t.seed.campaignId, viewer)).toEqual([
        { id: t.seed.campaignId, name: "Fixture Campaign", dmColor: P.amber },
      ]);
    }
  });

  test("FR-CAMP-34 inserts write hex: campaign create writes dm_color '#e69f00' (never the DB default 'amber'); player add writes a hex; the snapshot right after matches #rrggbb with no restart", () => {
    const t = setup();
    const c = t.s.commands.run(createCampaign, { name: "Third" }, { actor: DM_ACTOR });
    const row = t.s.db.$client
      .query<{ dm_color: string }, [string]>("SELECT dm_color FROM campaign WHERE id = ?")
      .get(c.id);
    expect(row?.dm_color).toBe("#e69f00");
    // The column default is still the sprint-5 key; only the create command makes it hex.
    expect(
      t.s.db.$client
        .query<{ dflt_value: string }, []>(
          "SELECT dflt_value FROM pragma_table_info('campaign') WHERE name = 'dm_color'",
        )
        .get()?.dflt_value,
    ).toBe("'amber'");
    const added = t.add("C");
    const prow = t.s.db.$client
      .query<{ color: string }, [string]>("SELECT color FROM player WHERE id = ?")
      .get(added.id);
    expect(prow?.color).toMatch(HEX);
    for (const viewer of [null, t.seed.p1.id, added.id]) {
      const camps = snapshotOf<CampaignRecord>(t.s, "campaign", t.seed.campaignId, viewer);
      const players = snapshotOf<PlayerRecord>(t.s, "player", t.seed.campaignId, viewer);
      expect(camps.map((r) => r.dmColor).every((v) => HEX.test(v))).toBe(true);
      expect(players).toHaveLength(3);
      expect(players.every((r) => HEX.test(r.color))).toBe(true);
    }
  });
});

describe("FR-CAMP-34 boot migration", () => {
  test("FR-CAMP-34 key migration: jade, blue, #E08AB8, null, red, … → hex, lowercase, defaults (after pass 1: the null player skips Blue's hex); DM 'red' → #e69f00; no event or log row; rerun no-op; snapshot never carries a key", () => {
    const t = setup();
    const more = ["C", "D", "E", "F", "G", "H"].map((n) => t.add(n));
    const [c, d, e, f, g, h] = more.map((p) => p.id) as [string, ...string[]];
    // What a sprint-5 DB holds (createdAt equal under the manual clock → rowid order).
    const set = (id: string, color: string | null) =>
      t.s.db.update(player).set({ color }).where(eq(player.id, id)).run();
    set(t.seed.p1.id, "jade");
    set(t.seed.p2.id, "blue");
    set(c, "#E08AB8");
    set(d as string, null);
    set(e as string, "red");
    set(f as string, "yellow");
    set(g as string, "sky");
    set(h as string, "#ABCDEF");
    t.raw("UPDATE campaign SET dm_color = 'red' WHERE id = ?", t.seed.campaignId);
    t.raw("UPDATE campaign SET dm_color = 'amber' WHERE id = ?", t.seed.secondCampaignId);
    set(t.seed.p3.id, "rose");
    const log0 = readEventLog(t.s.db).length;
    const n0 = t.events.length;

    expect(t.s.startHooks.map((x) => x.name)).toContain("campaign-management.color-backfill");
    expect(migratePlayerColors(t.s.db)).toEqual({ normalised: 8, filled: 3 });
    expect(
      [t.seed.p1.id, t.seed.p2.id, c, d, e, f, g, h].map((id) => t.colorOf(id as string)),
    ).toEqual([
      P.jade,
      P.blue,
      P.rose,
      // Pass 2 after pass 1: Amber (DM), Jade, Blue, Rose, Yellow, Sky held → Vermillion, then
      // Bronze. Had Blue stayed a key, the null player would have got Blue's hex.
      P.vermillion,
      P.bronze,
      P.yellow,
      P.sky,
      "#abcdef",
    ]);
    expect([t.dmColor(), t.dmColor(t.seed.secondCampaignId)]).toEqual([P.amber, P.amber]);
    expect(t.colorOf(t.seed.p3.id)).toBe(P.rose);
    expect(readEventLog(t.s.db)).toHaveLength(log0);
    expect(t.events).toHaveLength(n0);

    const digest = stateDigest(t.s.db.$client).sha256;
    expect(migratePlayerColors(t.s.db)).toEqual({ normalised: 0, filled: 0 });
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    for (const viewer of [null, t.seed.p1.id, c]) {
      const recs = snapshotOf<PlayerRecord>(t.s, "player", t.seed.campaignId, viewer);
      expect(recs).toHaveLength(8);
      expect(recs.every((r) => HEX.test(r.color))).toBe(true);
      const camps = snapshotOf<CampaignRecord>(t.s, "campaign", t.seed.campaignId, viewer);
      expect(camps.map((r) => r.dmColor)).toEqual([P.amber]);
    }
  });

  test("FR-CAMP-23 backfill: null colours filled per campaign in createdAt, rowid order (equal createdAt too); rerun no-op", () => {
    const t = setup();
    const more = ["C", "D"].map((n) => t.add(n));
    const fixture = [t.seed.p1, t.seed.p2, ...more].map((p) => p.id);
    // What the push leaves on a pre-sprint-5 DB: every colour null. D was created first.
    t.s.db.update(player).set({ color: null }).run();
    t.s.db
      .update(player)
      .set({ createdAt: "2025-01-01T00:00:00.000Z" })
      .where(eq(player.id, more[1]?.id as string))
      .run();
    // A DM who already moved to jade (a sprint-5 key): the defaults skip it after pass 1.
    t.raw("UPDATE campaign SET dm_color = 'jade' WHERE id = ?", t.seed.campaignId);
    expect(() => snapshotOf(t.s, "player", t.seed.campaignId, null)).toThrow(/no colour/);

    expect(migratePlayerColors(t.s.db)).toEqual({ normalised: 1, filled: 5 });
    const [p1, p2, c, d] = fixture;
    expect([d, p1, p2, c].map((id) => t.colorOf(id as string))).toEqual([
      P.amber,
      P.sky,
      P.rose,
      P.yellow,
    ]);
    expect(t.dmColor()).toBe(P.jade);
    expect(t.colorOf(t.seed.p3.id)).toBe(P.jade); // Second Campaign's DM is Amber
    expect(migratePlayerColors(t.s.db)).toEqual({ normalised: 0, filled: 0 });
  });

  test("FR-CAMP-34 key migration: one transaction (a failure in either pass changes nothing)", () => {
    // Pass 1 (Second Player's key → hex) or pass 2 (its default) fails: the first campaign's
    // rows and both DM colours roll back too.
    for (const [p3Color, when] of [
      ["jade", "OLD.color = 'jade'"],
      [null, "OLD.color IS NULL"],
    ] as const) {
      const t = setup();
      t.s.db.update(player).set({ color: "jade" }).run();
      t.s.db.update(player).set({ color: p3Color }).where(eq(player.id, t.seed.p3.id)).run();
      t.raw("UPDATE campaign SET dm_color = 'red'");
      const digest = stateDigest(t.s.db.$client).sha256;
      t.raw(
        `CREATE TRIGGER fail_second BEFORE UPDATE OF color ON player WHEN NEW.campaign_id = '${t.seed.secondCampaignId}' AND ${when} BEGIN SELECT RAISE(ABORT, 'boom'); END`,
      );
      expect(() => migratePlayerColors(t.s.db)).toThrow(/boom/);
      t.raw("DROP TRIGGER fail_second");
      expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    }
  });

  test("FR-CAMP-34 old PlayerColorSet log rows (a key) still parse; new ones are lowercase hex", () => {
    const ok = (color: string) =>
      PlayerColorSet.payload.safeParse({ playerId: null, color }).success;
    expect(["amber", "vermillion", "#e69f00", LAVENDER].map(ok)).toEqual([true, true, true, true]);
    expect(["red", "#E69F00", "#fff", ""].map(ok)).toEqual([false, false, false, false]);
  });
});

describe("FR-CAMP-25 / -33 camp.setColor", () => {
  test("FR-CAMP-25 setColor permissions: player own ✓ + PlayerColorSet + log row; other player / null forbidden; DM any ✓ and null ✓; other campaign not_found; not a hex invalid; same colour ack, no event, no log row", () => {
    const t = setup();
    const p1 = t.asPlayer(t.seed.p1.id);
    let n = t.events.length;
    expect(t.run({ playerId: t.seed.p1.id, color: P.rose }, p1)).toEqual({});
    expect(t.colorOf(t.seed.p1.id)).toBe(P.rose);
    const ev = t.events.slice(n).map((e) => e.event);
    expect(ev.map((e) => e.type)).toEqual(["PlayerColorSet"]);
    expect(ev[0]?.payload).toEqual({ playerId: t.seed.p1.id, color: P.rose });
    expect(ev[0]?.changes).toEqual([
      {
        type: "player",
        id: t.seed.p1.id,
        before: {
          id: t.seed.p1.id,
          campaignId: t.seed.campaignId,
          name: "Player 1",
          color: P.jade,
        },
        after: { id: t.seed.p1.id, campaignId: t.seed.campaignId, name: "Player 1", color: P.rose },
      },
    ]);
    const log = t.logged();
    expect(log.map((r) => [r.actorRole, r.actorPlayerId, r.payload])).toEqual([
      ["player", t.seed.p1.id, { playerId: t.seed.p1.id, color: P.rose }],
    ]);
    expect(JSON.stringify(ev)).not.toContain(t.seed.p1.linkToken);

    // A player naming someone else, or the DM colour → forbidden, nothing written.
    for (const playerId of [t.seed.p2.id, null, t.seed.p3.id]) {
      expect(errOf(() => t.run({ playerId, color: P.bronze }, p1)).code).toBe("forbidden");
    }
    expect([t.colorOf(t.seed.p2.id), t.dmColor()]).toEqual([P.sky, P.amber]);

    // DM: any player of the campaign, and the DM colour.
    n = t.events.length;
    t.run({ playerId: t.seed.p2.id, color: P.blue });
    t.run({ playerId: null, color: P.yellow });
    expect([t.colorOf(t.seed.p2.id), t.dmColor()]).toEqual([P.blue, P.yellow]);
    const dmEv = t.events.slice(n).map((e) => e.event);
    expect(dmEv[1]?.payload).toEqual({ playerId: null, color: P.yellow });
    expect(dmEv[1]?.changes).toEqual([
      {
        type: "campaign",
        id: t.seed.campaignId,
        before: { id: t.seed.campaignId, name: "Fixture Campaign", dmColor: P.amber },
        after: { id: t.seed.campaignId, name: "Fixture Campaign", dmColor: P.yellow },
      },
    ]);

    // Another campaign's player, an unknown id → not_found; not a #rrggbb → invalid.
    expect(errOf(() => t.run({ playerId: t.seed.p3.id, color: P.bronze })).code).toBe("not_found");
    expect(errOf(() => t.run({ playerId: "nope", color: P.bronze })).code).toBe("not_found");
    for (const bad of [
      { playerId: t.seed.p1.id, color: "purple" },
      { playerId: t.seed.p1.id, color: "rose" },
      { playerId: t.seed.p1.id, color: "#fff" },
      { playerId: t.seed.p1.id, color: P.bronze, extra: 1 },
      { color: P.bronze },
    ]) {
      expect(errOf(() => t.s.commands.run(setColor, bad as never, { actor: t.dm })).code).toBe(
        "invalid",
      );
    }
    expect(t.colorOf(t.seed.p3.id)).toBe(P.jade);

    // Same colour (any case) → ack, no write, no event, no log row.
    const digest = stateDigest(t.s.db.$client).sha256;
    n = t.events.length;
    const logN = t.logged().length;
    expect(t.run({ playerId: t.seed.p1.id, color: P.rose }, p1)).toEqual({});
    expect(t.run({ playerId: t.seed.p1.id, color: P.rose.toUpperCase() }, p1)).toEqual({});
    expect(t.run({ playerId: null, color: P.yellow })).toEqual({});
    expect(t.events).toHaveLength(n);
    expect(t.logged()).toHaveLength(logN);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
  });

  test("FR-CAMP-33 setColor hex: own #7fd8ff ✓ (stored lowercase); a key, too dark, too grey, too red → invalid with the reason; colour-blind clash and Taken by → conflict; same colour ack; nothing written on a reject", () => {
    const t = setup();
    t.run({ playerId: t.seed.p2.id, color: LAVENDER }); // Player 2 lavender (prefs-s6)
    const p1 = t.asPlayer(t.seed.p1.id);
    const logN = t.logged().length;
    expect(t.run({ playerId: t.seed.p1.id, color: "#7FD8FF" }, p1)).toEqual({});
    expect(t.colorOf(t.seed.p1.id)).toBe("#7fd8ff");
    expect(t.logged().map((r) => r.payload)).toHaveLength(logN + 1);
    expect(t.logged().at(-1)?.payload).toEqual({ playerId: t.seed.p1.id, color: "#7fd8ff" });

    const digest = stateDigest(t.s.db.$client).sha256;
    const n = t.events.length;
    const own = (color: string) => outcome(() => t.run({ playerId: t.seed.p1.id, color }, p1));
    expect(own("vermillion")).toBe("invalid: Invalid input");
    expect(own("#3d6ec9")).toBe("invalid: Too dark to read on the map");
    expect(own("#9e9e9e")).toBe("invalid: Too grey");
    expect(own("#f05555")).toBe("invalid: Too close to the danger red");
    expect(own("#cc793d")).toBe("invalid: Too close to the danger red");
    expect(own("#a0c814")).toBe("conflict: Too close to DM's colour for colour-blind players");
    expect(own(LAVENDER)).toBe("conflict: Taken by Player 2");
    expect(own(P.blue)).toBe("conflict: Too close to Player 2's colour for colour-blind players");
    expect(own("#7fd8ff")).toEqual({});
    expect(t.events).toHaveLength(n);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);

    // The DM's own colour is checked against every player (and never against itself).
    expect(outcome(() => t.run({ playerId: null, color: "#80d8ff" }))).toBe(
      "conflict: Too close to Player 1's colour",
    );
    expect(t.run({ playerId: null, color: "#e8a10a" })).toEqual({}); // a near-Amber: only the DM had it
    // An invalid colour is invalid even as a "same colour" resend (validity first).
    expect(outcome(() => t.run({ playerId: null, color: "#3d6ec9" }))).toBe(
      "invalid: Too dark to read on the map",
    );
  });

  test("FR-CAMP-33 setColor hex: two queued picks too close to each other (#7fd8ff for Player 1, #80d8ff by the DM for Player 2) → one ack, one conflict naming the winner", () => {
    const t = setup();
    t.run({ playerId: t.seed.p2.id, color: LAVENDER });
    const p1 = t.asPlayer(t.seed.p1.id);
    const logN = t.logged().length;
    const results = [
      () => t.run({ playerId: t.seed.p1.id, color: "#7fd8ff" }, p1),
      () => t.run({ playerId: t.seed.p2.id, color: "#80d8ff" }),
    ].map(outcome);
    expect(results).toEqual([{}, "conflict: Too close to Player 1's colour"]);
    expect(t.logged()).toHaveLength(logN + 1);
    expect([t.colorOf(t.seed.p1.id), t.colorOf(t.seed.p2.id)]).toEqual(["#7fd8ff", LAVENDER]);
  });

  test("FR-CAMP-26 uniqueness: a pick taken by a player → conflict 'Taken by Player 2'; by the DM → 'Taken by DM'; two queued picks of one colour → one ack, one conflict; defaults repeat only when no palette colour is far enough", () => {
    const t = setup();
    const p1 = t.asPlayer(t.seed.p1.id);
    const p2 = t.asPlayer(t.seed.p2.id);
    expect(errOf(() => t.run({ playerId: t.seed.p1.id, color: P.sky }, p1))).toEqual({
      code: "conflict",
      message: "Taken by Player 2",
    });
    expect(errOf(() => t.run({ playerId: t.seed.p1.id, color: P.amber }, p1))).toEqual({
      code: "conflict",
      message: "Taken by DM",
    });
    // The DM forcing a taken colour gets the same answer; the DM colour onto a player's too.
    expect(errOf(() => t.run({ playerId: t.seed.p2.id, color: P.jade })).message).toBe(
      "Taken by Player 1",
    );
    expect(errOf(() => t.run({ playerId: null, color: P.sky })).message).toBe("Taken by Player 2");
    // Another campaign's colours don't count (Second Player is Jade there).
    t.run({ playerId: null, color: P.rose });
    expect(t.dmColor()).toBe(P.rose);
    expect([t.colorOf(t.seed.p1.id), t.colorOf(t.seed.p2.id)]).toEqual([P.jade, P.sky]);

    // Two picks of one colour, queued (SQLite serialises them): the first wins.
    const logN = t.logged().length;
    const results = [
      () => t.run({ playerId: t.seed.p1.id, color: P.blue }, p1),
      () => t.run({ playerId: t.seed.p2.id, color: P.blue }, p2),
    ].map(outcome);
    expect(results).toEqual([{}, "conflict: Taken by Player 1"]);
    expect(t.logged()).toHaveLength(logN + 1);
    expect([t.colorOf(t.seed.p1.id), t.colorOf(t.seed.p2.id)]).toEqual([P.blue, P.sky]);

    // Fill the palette with defaults (DM Rose; P1 Blue, P2 Sky): 5 more distinct.
    const five = ["C", "D", "E", "F", "G"].map((n) => t.colorOf(t.add(n).id));
    expect(five).toEqual([P.amber, P.jade, P.yellow, P.vermillion, P.bronze]);
    const all = [t.dmColor(), ...[t.seed.p1, t.seed.p2].map((p) => t.colorOf(p.id)), ...five];
    expect(new Set(all).size).toBe(8);
    // The 9th person repeats (the farthest: all 0 → Amber); a pick still can't.
    const ninth = t.add("H");
    expect(t.colorOf(ninth.id)).toBe(P.amber);
    expect(errOf(() => t.run({ playerId: ninth.id, color: P.jade })).code).toBe("conflict");
    // A player whose default repeats keeps it; re-sending it is a same-colour ack.
    expect(t.run({ playerId: ninth.id, color: P.amber })).toEqual({});
  });
});

describe("FR-CAMP-25 / -33 crash and FR-CAMP-23 / -34 migration rerun (file DB)", () => {
  /** A "server boot" on the file: schema already pushed; start hooks as `startServer`. */
  async function boot(openDb: () => Db) {
    const db = openDb();
    const s = createServices({
      config: createTestServices().config,
      db,
      log: silentLogger,
    });
    for (const h of s.startHooks) await h.fn(s);
    return { s, db, close: () => closeDb(db) };
  }

  const ids = (db: Db) =>
    Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((p) => [p.name, p]),
    );
  const camp = (db: Db) =>
    db
      .select()
      .from(campaign)
      .where(eq(campaign.active, true))
      .get() as typeof campaign.$inferSelect;
  const colorLog = (db: Db) => readEventLog(db).filter((r) => r.type === PlayerColorSet.type);

  test("FR-CAMP-33 crash: before-commit with a hex → old colour, no log row, digest equal after restart; after-commit → new hex + one log row; a resend is a same-colour no-op (prefs-s6)", async () => {
    const loaded = await loadBundle("prefs-s6", { testMode: true });
    try {
      class Killed extends Error {}
      const kill = () => {
        throw new Killed();
      };
      let b = await boot(loaded.openDb);
      const p1 = ids(b.db)["Player 1"] as typeof player.$inferSelect;
      const p2Id = ids(b.db)["Player 2"]?.id;
      expect(p1.color).toBe(P.jade);
      expect(ids(b.db)["Player 2"]?.color).toBe(LAVENDER);
      expect(camp(b.db).dmColor).toBe(P.amber);
      // The fixtures' picks ran the command: two PlayerColorSet rows, hex payloads.
      expect(colorLog(b.db).map((r) => r.payload)).toEqual([
        { playerId: p2Id, color: P.blue },
        { playerId: p2Id, color: LAVENDER },
      ]);
      const actor: Actor = { role: "player", playerId: p1.id, campaignId: p1.campaignId };
      const input = { playerId: p1.id, color: "#7fd8ff" };
      const before = stateDigest(b.db.$client).sha256;

      armCrashHook({ point: "before-commit", target: setColor.name }, kill);
      expect(() => b.s.commands.run(setColor, input, { actor })).toThrow();
      armCrashHook(null);
      b.close();
      b = await boot(loaded.openDb);
      expect(ids(b.db)["Player 1"]?.color).toBe(P.jade);
      expect(colorLog(b.db)).toHaveLength(2);
      expect(stateDigest(b.db.$client).sha256).toBe(before);

      armCrashHook({ point: "after-commit", target: setColor.name }, kill);
      expect(() => b.s.commands.run(setColor, input, { actor })).toThrow(Killed);
      armCrashHook(null);
      b.close();
      b = await boot(loaded.openDb);
      expect(ids(b.db)["Player 1"]?.color).toBe("#7fd8ff");
      expect(colorLog(b.db)).toHaveLength(3);
      // The ack was lost; the client's resend is a no-op.
      const after = stateDigest(b.db.$client).sha256;
      expect(b.s.commands.run(setColor, input, { actor })).toEqual({});
      expect(stateDigest(b.db.$client).sha256).toBe(after);
      b.close();
    } finally {
      loaded.cleanup();
    }
  }, 60_000);

  test("FR-CAMP-34 migration rerun: keys (and a null) written into the DB file, restart twice: the first boot migrates, the second leaves state:digest unchanged (player-colours)", async () => {
    const loaded = await loadBundle("player-colours", { testMode: true });
    try {
      const raw = loaded.openDb();
      const p2 = ids(raw)["Player 2"] as typeof player.$inferSelect;
      raw.update(player).set({ color: "jade" }).where(eq(player.name, "Player 1")).run();
      raw.update(player).set({ color: null }).where(eq(player.id, p2.id)).run();
      raw.$client.run("UPDATE campaign SET dm_color = 'amber'");
      closeDb(raw);

      let b = await boot(loaded.openDb);
      // Keys → hex; DM Amber, Player 1 Jade: Player 2's default is Sky (its Blue pick was lost).
      expect(ids(b.db)["Player 1"]?.color).toBe(P.jade);
      expect(ids(b.db)["Player 2"]?.color).toBe(P.sky);
      expect(camp(b.db).dmColor).toBe(P.amber);
      const first = stateDigest(b.db.$client).sha256;
      b.close();
      b = await boot(loaded.openDb);
      expect(stateDigest(b.db.$client).sha256).toBe(first);
      b.close();
    } finally {
      loaded.cleanup();
    }
  }, 60_000);
});
