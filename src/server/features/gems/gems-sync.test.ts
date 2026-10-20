// GEM / CAMP sprint 7 over real sockets on `gems-hidden` (gems off, counts kept; DM, a second DM
// tab, `player-1`, `player-2`): FR-CAMP-40 switch resyncs every connection; leak scans per player
// while off and on (snapshot, frames, fresh connection, resync, reconnect, restart); a tagged lazy
// type's `sync.load` answers as unknown while off; a spend sent right before a drop.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import {
  CHARACTER_GEMS_TYPE,
  type CharacterGemsRecord,
  GEM_ADJUST_INTENT,
  GEM_SPEND_INTENT,
} from "@shared/gems/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import { closeDb, type Db } from "../../db/client";
import { characterGems, entity, player } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { registerLazyProbe } from "../../ws/testing/lazy-probe";
import { SET_FEATURE_INTENT } from "../campaign-management/features";
import { GEMS_OFF } from "./commands";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let chars: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("gems-hidden", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r.linkToken]),
  );
  chars = Object.fromEntries(
    db
      .select()
      .from(entity)
      .all()
      .filter((e) => e.kind === "character")
      .map((e) => [e.name, e.id]),
  );
  h = await startTestServer({ db, testMode: true, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const P1 = (): Credential => ({ role: "player", token: tokens["Player 1"] as string });
const P2 = (): Credential => ({ role: "player", token: tokens["Player 2"] as string });

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
const ok = async (c: TestClient, name: string, payload: unknown) => {
  const f = await reply(c, name, payload);
  expect(f.type === "reject" ? JSON.stringify(f) : f.type).toBe("ack");
  return f;
};
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const snapshots = (c: TestClient) => c.frames.filter((f) => f.type === "snapshot").length;
const sw = (c: TestClient, on: boolean) => ok(c, SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on });

/** Gem bytes in frames (from index `from`): records, kinds, the switch itself. */
function gemBytes(frames: readonly ServerFrame[]): string[] {
  const raw = JSON.stringify(frames);
  return [CHARACTER_GEMS_TYPE, '"gem.', '"features":["gems"]', "GemSpent", "GemsAdjusted"].filter(
    (s) => raw.includes(s),
  );
}
const lastSnapshotOn = (c: TestClient) => {
  const i = c.frames.findLastIndex((f) => f.type === "snapshot");
  return c.frames.slice(i);
};
const counts = (c: TestClient, name: string) =>
  recordsOf<CharacterGemsRecord>(c.store, CHARACTER_GEMS_TYPE).find(
    (r) => r.characterId === chars[name],
  );
const gemLines = (c: TestClient) =>
  recordsOf<GameLogEntryRecord>(c.store, "game-log-entry").filter((e) => e.kind.startsWith("gem."));

describe("gems over real sockets (gems-hidden)", () => {
  test("FR-CAMP-40 switch resyncs: DM, a second DM tab and both players each get one fresh snapshot with the new features; same value → none; player → forbidden", async () => {
    const clients = [await h.live(DM), await h.live(DM), await h.live(P1()), await h.live(P2())];
    const [dm, , p1] = clients as [TestClient, TestClient, TestClient, TestClient];
    const before = clients.map(snapshots);
    await sw(dm, true);
    await until(() => clients.every((c, i) => snapshots(c) === (before[i] as number) + 1));
    for (const c of clients) {
      expect(recordsOf<CampaignRecord>(c.store, "campaign")[0]?.features).toEqual(["gems"]);
      expect(recordsOf(c.store, CHARACTER_GEMS_TYPE)).toHaveLength(3);
    }
    await Bun.sleep(150);
    expect(clients.map(snapshots)).toEqual(before.map((n) => n + 1));
    // Same value: no-op (ack, no resync).
    await sw(dm, true);
    await Bun.sleep(150);
    expect(clients.map(snapshots)).toEqual(before.map((n) => n + 1));
    const r = await reply(p1, SET_FEATURE_INTENT, { feature: GEMS_FEATURE, on: false });
    expect(r.type === "reject" && r.code).toBe("forbidden");
    await sw(dm, false);
    await until(() => clients.every((c, i) => snapshots(c) === (before[i] as number) + 2));
    for (const c of clients) {
      expect(recordsOf<CampaignRecord>(c.store, "campaign")[0]).not.toHaveProperty("features");
      expect(c.store.records[CHARACTER_GEMS_TYPE]).toBeUndefined();
      expect(gemLines(c)).toEqual([]);
      expect(gemBytes(lastSnapshotOn(c))).toEqual([]);
      c.close();
    }
  }, 30_000);

  test("FR-GEM-02 FR-GEM-04 FR-GEM-10 leak scan per player: off → no gem byte (snapshot, frames, fresh, reconnect); on → counts for all; spend / award / removal live; off again hides; restart keeps counts", async () => {
    const dm = await h.live(DM);
    let p1 = await h.live(P1());
    const p2 = await h.live(P2());
    const online = (c: TestClient) =>
      recordsOf<{ online: boolean }>(c.store, "presence").filter((r) => r.online).length;
    await until(() => online(dm) === 2);
    for (const c of [dm, p1, p2]) {
      expect(gemBytes(c.frames)).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    // While off a spend is refused (FR-GEM-03), over the wire too.
    const off = await reply(p1, GEM_SPEND_INTENT, { characterId: chars.Mira, gem: "fortune" });
    expect(off.type === "reject" && [off.code, off.message]).toEqual(["forbidden", GEMS_OFF]);

    await sw(dm, true);
    await until(() => [dm, p1, p2].every((c) => counts(c, "Mira") !== undefined));
    for (const c of [dm, p1, p2]) {
      // Kept while off (FR-GEM-04), now back for everyone (OQ-GEM-01 A).
      expect(counts(c, "Mira")).toMatchObject({ inspiration: 2, combat: 1, fortune: 1 });
      expect(counts(c, "Brakka")).toMatchObject({ fortune: 6, action: 3 });
      expect(gemLines(c)).toHaveLength(9);
    }

    // player-1 spends Mira's Fortune gem: row + public line reach all three.
    await ok(p1, GEM_SPEND_INTENT, { characterId: chars.Mira, gem: "fortune" });
    await until(() => [dm, p1, p2].every((c) => counts(c, "Mira")?.fortune === 0));
    for (const c of [dm, p1, p2]) {
      expect(gemLines(c).filter((e) => e.kind === "gem.spend")).toHaveLength(1);
    }
    // player-2 can't spend Mira's gems.
    const theirs = await reply(p2, GEM_SPEND_INTENT, {
      characterId: chars.Mira,
      gem: "inspiration",
    });
    expect(theirs.type === "reject" && theirs.code).toBe("forbidden");
    // DM award (+ line) and removal (no line).
    await ok(dm, GEM_ADJUST_INTENT, { characterId: chars.Thorn, gem: "divine", delta: 1 });
    await ok(dm, GEM_ADJUST_INTENT, { characterId: chars.Thorn, gem: "divine", delta: -1 });
    await until(() => [dm, p1, p2].every((c) => gemLines(c).length === 11));
    await until(() => [dm, p1, p2].every((c) => counts(c, "Thorn")?.divine === 0));
    for (const c of [dm, p1, p2]) {
      expect(leakScan(h.s, c)).toEqual([]);
      const fresh = await h.live(c === dm ? DM : c === p1 ? P1() : P2());
      const { live, fresh: f } = convergence(h.s, c, fresh);
      expect(live).toEqual(f);
      fresh.close();
    }

    // Off again: one resync each; from that snapshot on, no gem byte.
    await sw(dm, false);
    await until(() =>
      [dm, p1, p2].every((c) => c.store.records[CHARACTER_GEMS_TYPE] === undefined),
    );
    for (const c of [dm, p1, p2]) {
      expect(gemBytes(lastSnapshotOn(c))).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
    }
    // Reconnect and a fresh connection per viewer: nothing.
    p1.close();
    p1 = await h.live(P1());
    for (const cred of [DM, P1(), P2()]) {
      const fresh = await h.live(cred);
      expect(gemBytes(fresh.frames)).toEqual([]);
      fresh.close();
    }
    expect(gemBytes(p1.frames)).toEqual([]);
    // Kept in the DB.
    expect(db.select().from(characterGems).all()).toHaveLength(3);

    // Restart (crash-like): counts unchanged; still off until switched on.
    for (const c of [dm, p1, p2]) c.close();
    await h.restart();
    const again = await h.live(DM);
    expect(gemBytes(again.frames)).toEqual([]);
    await sw(again, true);
    await until(() => counts(again, "Mira") !== undefined);
    expect(counts(again, "Mira")).toMatchObject({ inspiration: 2, combat: 1, fortune: 0 });
    await sw(again, false);
    again.close();
  }, 60_000);

  test("GEM §11 reconnect mid-spend: a spend sent right before the drop commits once; the next snapshot shows it", async () => {
    const dm = await h.live(DM);
    await sw(dm, true);
    const before = db
      .select()
      .from(characterGems)
      .all()
      .find((r) => r.id === chars.Brakka);
    const p1 = await h.live(P1());
    p1.intent(GEM_SPEND_INTENT, { characterId: chars.Brakka, gem: "action", use: "bonus" });
    p1.close();
    await until(
      () =>
        db
          .select()
          .from(characterGems)
          .all()
          .find((r) => r.id === chars.Brakka)?.action ===
        (before?.action as number) - 1,
    );
    const back = await h.live(P1());
    expect(counts(back, "Brakka")?.action).toBe((before?.action as number) - 1);
    await sw(dm, false);
    back.close();
    dm.close();
  }, 30_000);

  test("FR-CAMP-44 sync.load of a tagged lazy type: unknown while off, rows while on", async () => {
    const probe = registerLazyProbe(h.s, { type: "gems-lazy-probe", feature: GEMS_FEATURE });
    const dm = await h.live(DM);
    await ok(dm, probe.set.name, { text: "LAZY-GEM", hidden: false });
    const offLoad = await reply(dm, "sync.load", { type: "gems-lazy-probe" });
    expect(offLoad.type === "reject" && [offLoad.code, offLoad.message]).toEqual([
      "invalid",
      'Unknown record type "gems-lazy-probe"',
    ]);
    await sw(dm, true);
    await until(() => recordsOf(dm.store, CHARACTER_GEMS_TYPE).length > 0);
    const loadId = dm.load("gems-lazy-probe");
    await until(() => dm.frames.some((f) => f.type === "ack" && f.intentId === loadId));
    expect(recordsOf(dm.store, "gems-lazy-probe")).toHaveLength(1);
    await sw(dm, false);
    dm.close();
  }, 30_000);
});
