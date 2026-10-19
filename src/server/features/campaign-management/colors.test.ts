// CAMP sprint 5 server (K0): FR-CAMP-23 defaults + boot backfill, FR-CAMP-24 DM colour,
// FR-CAMP-25 `camp.setColor` permissions + crash, FR-CAMP-26 uniqueness.
import { afterEach, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
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
import { backfillPlayerColors, setColor } from "./colors";
import { addPlayer, createCampaign } from "./commands";

afterEach(() => armCrashHook(null));

type Input = { playerId: string | null; color: string };

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
  return { s, events, seed, dm, asPlayer, run, colorOf, dmColor, logged, add };
}

describe("FR-CAMP-23 / -24 defaults", () => {
  test("FR-CAMP-23 default colour: jade, sky, … in add order, per campaign; past 8 the least used; PlayerAdded's upsert carries it", () => {
    const t = setup();
    expect([t.colorOf(t.seed.p1.id), t.colorOf(t.seed.p2.id)]).toEqual(["jade", "sky"]);
    // Another campaign counts on its own.
    expect(t.colorOf(t.seed.p3.id)).toBe("jade");
    const n0 = t.events.length;
    const added = ["C", "D", "E", "F", "G", "H", "I"].map((name) => t.add(name));
    // After bronze all 8 are used once (DM amber + 7 players): the least used, palette order.
    expect(added.map((p) => t.colorOf(p.id))).toEqual([
      "rose",
      "yellow",
      "blue",
      "vermillion",
      "bronze",
      "amber",
      "jade",
    ]);
    const first = t.events[n0]?.event;
    expect(first?.type).toBe("PlayerAdded");
    expect(first?.payload).toEqual({
      playerId: added[0]?.id,
      campaignId: t.seed.campaignId,
      name: "C",
    });
    expect(first?.changes[0]?.after).toMatchObject({ name: "C", color: "rose" });
  });

  test("FR-CAMP-23 default colour: a freed key is the next default; the DM's and picked keys are skipped", () => {
    const t = setup();
    t.run({ playerId: t.seed.p1.id, color: "rose" }); // frees jade
    expect(t.colorOf(t.add("C").id)).toBe("jade");
    t.run({ playerId: null, color: "yellow" }); // frees amber, takes yellow
    expect(t.colorOf(t.add("D").id)).toBe("amber");
    expect(t.colorOf(t.add("E").id)).toBe("blue");
  });

  test("FR-CAMP-24 DM colour: a new campaign starts amber; the campaign record carries dmColor in event and snapshot", () => {
    const t = setup();
    expect(t.dmColor()).toBe("amber");
    const n0 = t.events.length;
    const c = t.s.commands.run(createCampaign, { name: "Third" }, { actor: DM_ACTOR });
    expect(t.dmColor(c.id)).toBe("amber");
    expect(t.events[n0]?.event.changes[0]?.after).toEqual({
      id: c.id,
      name: "Third",
      dmColor: "amber",
    });
    for (const viewer of [null, t.seed.p1.id]) {
      expect(snapshotOf<CampaignRecord>(t.s, "campaign", t.seed.campaignId, viewer)).toEqual([
        { id: t.seed.campaignId, name: "Fixture Campaign", dmColor: "amber" },
      ]);
    }
  });
});

describe("FR-CAMP-23 boot backfill", () => {
  test("FR-CAMP-23 backfill: null colours filled per campaign in createdAt, rowid order (equal createdAt too), one start hook, no event or log row; rerun no-op; snapshot never null", () => {
    const t = setup();
    const more = ["C", "D"].map((n) => t.add(n));
    const fixture = [t.seed.p1, t.seed.p2, ...more].map((p) => p.id);
    // What the push leaves on a pre-sprint-5 DB: every colour null. D was created first (its
    // createdAt earlier); P1, P2, C share one createdAt (manual clock) → rowid order.
    t.s.db.update(player).set({ color: null }).run();
    t.s.db
      .update(player)
      .set({ createdAt: "2025-01-01T00:00:00.000Z" })
      .where(eq(player.id, more[1]?.id as string))
      .run();
    // A DM who already moved to jade: the backfill skips the DM's key.
    t.s.db
      .update(campaign)
      .set({ dmColor: "jade" })
      .where(eq(campaign.id, t.seed.campaignId))
      .run();
    expect(() => snapshotOf(t.s, "player", t.seed.campaignId, null)).toThrow(/no colour/);
    const log0 = readEventLog(t.s.db).length;
    const n0 = t.events.length;

    expect(t.s.startHooks.map((h) => h.name)).toContain("campaign-management.color-backfill");
    expect(backfillPlayerColors(t.s.db)).toBe(5);
    const [p1, p2, c, d] = fixture;
    expect([d, p1, p2, c].map((id) => t.colorOf(id as string))).toEqual([
      "amber",
      "sky",
      "rose",
      "yellow",
    ]);
    expect(t.colorOf(t.seed.p3.id)).toBe("jade"); // Second Campaign's DM is amber
    expect(readEventLog(t.s.db)).toHaveLength(log0);
    expect(t.events).toHaveLength(n0);

    const digest = stateDigest(t.s.db.$client).sha256;
    expect(backfillPlayerColors(t.s.db)).toBe(0);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    for (const viewer of [null, ...fixture]) {
      const recs = snapshotOf<PlayerRecord>(t.s, "player", t.seed.campaignId, viewer ?? null);
      expect(recs).toHaveLength(4);
      expect(recs.every((r) => typeof r.color === "string" && r.color.length > 0)).toBe(true);
    }
  });

  test("FR-CAMP-23 backfill: one transaction (a failure fills nothing)", () => {
    const t = setup();
    t.s.db.update(player).set({ color: null }).run();
    const digest = stateDigest(t.s.db.$client).sha256;
    // Break the second campaign's update mid-way: the first campaign's rows roll back too.
    t.s.db.$client.run(
      `CREATE TRIGGER fail_second BEFORE UPDATE OF color ON player WHEN NEW.campaign_id = '${t.seed.secondCampaignId}' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    expect(() => backfillPlayerColors(t.s.db)).toThrow(/boom/);
    t.s.db.$client.run("DROP TRIGGER fail_second");
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
  });
});

describe("FR-CAMP-25 camp.setColor", () => {
  test("FR-CAMP-25 setColor permissions: player own ✓ + PlayerColorSet + log row; other player / null forbidden; DM any ✓ and null ✓; other campaign not_found; bad key invalid; same colour ack, no event, no log row", () => {
    const t = setup();
    const p1 = t.asPlayer(t.seed.p1.id);
    let n = t.events.length;
    expect(t.run({ playerId: t.seed.p1.id, color: "rose" }, p1)).toEqual({});
    expect(t.colorOf(t.seed.p1.id)).toBe("rose");
    const ev = t.events.slice(n).map((e) => e.event);
    expect(ev.map((e) => e.type)).toEqual(["PlayerColorSet"]);
    expect(ev[0]?.payload).toEqual({ playerId: t.seed.p1.id, color: "rose" });
    expect(ev[0]?.changes).toEqual([
      {
        type: "player",
        id: t.seed.p1.id,
        before: {
          id: t.seed.p1.id,
          campaignId: t.seed.campaignId,
          name: "Player 1",
          color: "jade",
        },
        after: { id: t.seed.p1.id, campaignId: t.seed.campaignId, name: "Player 1", color: "rose" },
      },
    ]);
    const log = t.logged();
    expect(log.map((r) => [r.actorRole, r.actorPlayerId, r.payload])).toEqual([
      ["player", t.seed.p1.id, { playerId: t.seed.p1.id, color: "rose" }],
    ]);
    expect(JSON.stringify(ev)).not.toContain(t.seed.p1.linkToken);

    // A player naming someone else, or the DM colour → forbidden, nothing written.
    for (const playerId of [t.seed.p2.id, null, t.seed.p3.id]) {
      expect(errOf(() => t.run({ playerId, color: "bronze" }, p1)).code).toBe("forbidden");
    }
    expect([t.colorOf(t.seed.p2.id), t.dmColor()]).toEqual(["sky", "amber"]);

    // DM: any player of the campaign, and the DM colour.
    n = t.events.length;
    t.run({ playerId: t.seed.p2.id, color: "blue" });
    t.run({ playerId: null, color: "yellow" });
    expect([t.colorOf(t.seed.p2.id), t.dmColor()]).toEqual(["blue", "yellow"]);
    const dmEv = t.events.slice(n).map((e) => e.event);
    expect(dmEv[1]?.payload).toEqual({ playerId: null, color: "yellow" });
    expect(dmEv[1]?.changes).toEqual([
      {
        type: "campaign",
        id: t.seed.campaignId,
        before: { id: t.seed.campaignId, name: "Fixture Campaign", dmColor: "amber" },
        after: { id: t.seed.campaignId, name: "Fixture Campaign", dmColor: "yellow" },
      },
    ]);

    // Another campaign's player, an unknown id → not_found; not a palette key → invalid.
    expect(errOf(() => t.run({ playerId: t.seed.p3.id, color: "bronze" })).code).toBe("not_found");
    expect(errOf(() => t.run({ playerId: "nope", color: "bronze" })).code).toBe("not_found");
    for (const bad of [
      { playerId: t.seed.p1.id, color: "purple" },
      { playerId: t.seed.p1.id, color: "#ff0000" },
      { playerId: t.seed.p1.id, color: "Rose" },
      { playerId: t.seed.p1.id, color: "rose", extra: 1 },
      { color: "rose" },
    ]) {
      expect(errOf(() => t.s.commands.run(setColor, bad as never, { actor: t.dm })).code).toBe(
        "invalid",
      );
    }
    expect(t.colorOf(t.seed.p3.id)).toBe("jade");

    // Same colour → ack, no write, no event, no log row.
    const digest = stateDigest(t.s.db.$client).sha256;
    n = t.events.length;
    const logN = t.logged().length;
    expect(t.run({ playerId: t.seed.p1.id, color: "rose" }, p1)).toEqual({});
    expect(t.run({ playerId: null, color: "yellow" })).toEqual({});
    expect(t.events).toHaveLength(n);
    expect(t.logged()).toHaveLength(logN);
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
  });

  test("FR-CAMP-26 uniqueness: a pick taken by a player → conflict 'Taken by Player 2'; by the DM → 'Taken by DM'; two queued picks of one key → one ack, one conflict; defaults repeat only past 8", () => {
    const t = setup();
    const p1 = t.asPlayer(t.seed.p1.id);
    const p2 = t.asPlayer(t.seed.p2.id);
    expect(errOf(() => t.run({ playerId: t.seed.p1.id, color: "sky" }, p1))).toEqual({
      code: "conflict",
      message: "Taken by Player 2",
    });
    expect(errOf(() => t.run({ playerId: t.seed.p1.id, color: "amber" }, p1))).toEqual({
      code: "conflict",
      message: "Taken by DM",
    });
    // The DM forcing a taken key gets the same answer; the DM colour onto a player's key too.
    expect(errOf(() => t.run({ playerId: t.seed.p2.id, color: "jade" })).message).toBe(
      "Taken by Player 1",
    );
    expect(errOf(() => t.run({ playerId: null, color: "sky" })).message).toBe("Taken by Player 2");
    // Another campaign's colours don't count (Second Player is jade there).
    t.run({ playerId: null, color: "rose" });
    expect(t.dmColor()).toBe("rose");
    expect([t.colorOf(t.seed.p1.id), t.colorOf(t.seed.p2.id)]).toEqual(["jade", "sky"]);

    // Two picks of one key, queued (SQLite serialises them): the first wins.
    const logN = t.logged().length;
    const results = [
      () => t.run({ playerId: t.seed.p1.id, color: "blue" }, p1),
      () => t.run({ playerId: t.seed.p2.id, color: "blue" }, p2),
    ].map((f) => {
      try {
        return f();
      } catch (e) {
        return e instanceof CommandError ? `${e.code}: ${e.message}` : e;
      }
    });
    expect(results).toEqual([{}, "conflict: Taken by Player 1"]);
    expect(t.logged()).toHaveLength(logN + 1);
    expect([t.colorOf(t.seed.p1.id), t.colorOf(t.seed.p2.id)]).toEqual(["blue", "sky"]);

    // Fill the palette with defaults (DM rose; P1 blue, P2 sky): 6 free keys → 6 distinct.
    const six = ["C", "D", "E", "F", "G"].map((n) => t.colorOf(t.add(n).id));
    expect(six).toEqual(["amber", "jade", "yellow", "vermillion", "bronze"]);
    const all = [t.dmColor(), ...[t.seed.p1, t.seed.p2].map((p) => t.colorOf(p.id)), ...six];
    expect(new Set(all).size).toBe(8);
    // The 9th person repeats (least used, palette order); a pick still can't.
    const ninth = t.add("H");
    expect(t.colorOf(ninth.id)).toBe("amber");
    expect(errOf(() => t.run({ playerId: ninth.id, color: "jade" })).code).toBe("conflict");
    // A player whose default repeats keeps it; re-sending it is a same-colour ack.
    expect(t.run({ playerId: ninth.id, color: "amber" })).toEqual({});
  });
});

describe("FR-CAMP-25 crash and FR-CAMP-23 backfill rerun (player-colours, file DB)", () => {
  async function bundle() {
    const loaded = await loadBundle("player-colours", { testMode: true });
    return loaded;
  }

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

  test("FR-CAMP-25 crash: before-commit → old colour, no log row, digest equal after restart; after-commit → new colour, one log row; a resend is a same-colour no-op", async () => {
    const loaded = await bundle();
    try {
      class Killed extends Error {}
      const kill = () => {
        throw new Killed();
      };
      let b = await boot(loaded.openDb);
      const p1 = ids(b.db)["Player 1"] as typeof player.$inferSelect;
      expect(p1.color).toBe("jade");
      expect(ids(b.db)["Player 2"]?.color).toBe("blue");
      expect(camp(b.db).dmColor).toBe("amber");
      // The fixture's pick ran the command: one PlayerColorSet row.
      expect(colorLog(b.db).map((r) => r.payload)).toEqual([
        { playerId: ids(b.db)["Player 2"]?.id, color: "blue" },
      ]);
      const actor: Actor = { role: "player", playerId: p1.id, campaignId: p1.campaignId };
      const input = { playerId: p1.id, color: "rose" as const };
      const before = stateDigest(b.db.$client).sha256;

      armCrashHook({ point: "before-commit", target: setColor.name }, kill);
      expect(() => b.s.commands.run(setColor, input, { actor })).toThrow();
      armCrashHook(null);
      b.close();
      b = await boot(loaded.openDb);
      expect(ids(b.db)["Player 1"]?.color).toBe("jade");
      expect(colorLog(b.db)).toHaveLength(1);
      expect(stateDigest(b.db.$client).sha256).toBe(before);

      armCrashHook({ point: "after-commit", target: setColor.name }, kill);
      expect(() => b.s.commands.run(setColor, input, { actor })).toThrow(Killed);
      armCrashHook(null);
      b.close();
      b = await boot(loaded.openDb);
      expect(ids(b.db)["Player 1"]?.color).toBe("rose");
      expect(colorLog(b.db)).toHaveLength(2);
      // The ack was lost; the client's resend is a no-op.
      const after = stateDigest(b.db.$client).sha256;
      expect(b.s.commands.run(setColor, input, { actor })).toEqual({});
      expect(stateDigest(b.db.$client).sha256).toBe(after);
      b.close();
    } finally {
      loaded.cleanup();
    }
  }, 60_000);

  test("FR-CAMP-23 backfill rerun: null a colour in the DB file, restart twice: the first boot fills it, the second leaves state:digest unchanged", async () => {
    const loaded = await bundle();
    try {
      const raw = loaded.openDb();
      const p2 = ids(raw)["Player 2"] as typeof player.$inferSelect;
      raw.update(player).set({ color: null }).where(eq(player.id, p2.id)).run();
      closeDb(raw);

      let b = await boot(loaded.openDb);
      // DM amber, Player 1 jade: Player 2's default is sky (its pick of blue was lost with it).
      expect(ids(b.db)["Player 2"]?.color).toBe("sky");
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
