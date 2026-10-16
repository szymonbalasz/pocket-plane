// PARTY §13 leak tests over real sockets (`FR-PARTY-07 leak`) on the `party-board` bundle: the
// snapshot, every event frame and the `sync.load` acks of player-1 and player-2, before and after
// a reconnect; a share walk (player-1 → all → unshare) on a new handout; the stale-store check
// (FR-PARTY-10 loaded set, FR-SYNC-37); campaign scope; convergence with the loaded set
// (FR-SYNC-38); a restart on the same DB gives identical loads.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { HANDOUTS_1 } from "@fixtures/units/party-board/handouts-1";
import { SECOND_HANDOUT_TITLE, SECOND_ITEM_NAME } from "@fixtures/units/party-board/party-second";
import type { NotificationRecord } from "@shared/notifications/schemas";
import {
  HANDOUT_BODY_TYPE,
  HANDOUT_TYPE,
  PARTY_ITEM_TYPE,
  type SharedWith,
} from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE } from "@shared/party-loot/schemas";
import type { Credential } from "@shared/protocol/frames";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, campaign, handout, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { NOTIFICATION_TYPE } from "../notifications/helpers";
import { PARTY_INTENTS as P } from "./commands";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
const NONE: SharedWith = { mode: "none", playerIds: [] };
const ALL: SharedWith = { mode: "all", playerIds: [] };

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
const ok = async (c: TestClient, id: string) => {
  const a = await answer(c, id);
  expect(a.type === "reject" ? JSON.stringify(a) : a.type).toBe("ack");
  return a as { type: "ack"; result?: unknown };
};
const ids = (c: TestClient, type: string) => Object.keys(c.store.records[type] ?? {}).sort();

describe("PARTY §13 leak tests (player-1, player-2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let playerIds: Record<string, string>;
  let hid: Record<keyof typeof HANDOUTS_1.h, string>;
  let assets: Record<string, string>;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });

  /** Loads the board as a client does: every header, the given bodies, every party item. */
  async function loadBoard(c: TestClient, bodies: string[]) {
    await ok(c, c.load(HANDOUT_TYPE));
    await ok(c, c.load(HANDOUT_BODY_TYPE, bodies));
    await ok(c, c.load(PARTY_ITEM_TYPE));
  }
  const allBodies = () => Object.values(hid);

  /** What player-2 must never receive from the fixture state (PARTY §13 leak list). */
  const p2Forbidden = () => [
    HANDOUTS_1.p1Only,
    HANDOUTS_1.secret,
    HANDOUTS_1.unshared,
    HANDOUTS_1.prep,
    hid.thievesMap,
    hid.secretOrders,
    hid.shipManifest as string,
    assets["thieves-map"] as string,
    assets["wanted-poster"] as string,
    SECOND_HANDOUT_TITLE,
    SECOND_ITEM_NAME,
  ];
  /** player-1 sees h1, h2 only; the unshared bodies and other ids never reach them. */
  const p1Forbidden = () => [
    HANDOUTS_1.secret,
    HANDOUTS_1.unshared,
    HANDOUTS_1.prep,
    hid.secretOrders,
    hid.shipManifest as string,
    assets["wanted-poster"] as string,
    SECOND_HANDOUT_TITLE,
    SECOND_ITEM_NAME,
  ];
  const expectClean = (c: TestClient, forbidden: string[], label: string) => {
    const raw = c.raw();
    expect([label, forbidden.filter((s) => raw.includes(s))]).toEqual([label, []]);
    expect([label, leakScan(h.s, c)]).toEqual([label, []]);
  };
  /** A fresh connection of the same viewer, loading what `live` loaded, holds the same rows. */
  async function expectConverged(live: TestClient, credential: Credential) {
    const fresh = await h.live(credential);
    for (const type of live.lazy.types) await ok(fresh, fresh.load(type));
    for (const [type, list] of Object.entries(live.lazy.ids)) {
      if (live.lazy.types.includes(type) || list.length === 0) continue;
      await ok(fresh, fresh.load(type, [...list]));
    }
    const { live: a, fresh: b } = convergence(h.s, live, fresh);
    expect(a).toEqual(b);
    fresh.close();
  }

  beforeAll(async () => {
    const loaded = await loadBundle("party-board", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    playerIds = Object.fromEntries(players.map((r) => [r.name, r.id]));
    const fixture = db
      .select()
      .from(campaign)
      .all()
      .find((x) => x.name === "Fixture Campaign")?.id as string;
    const byTitle = Object.fromEntries(
      db
        .select()
        .from(handout)
        .all()
        .filter((x) => x.campaignId === fixture)
        .map((x) => [x.title, x.id]),
    );
    hid = {
      mayor: byTitle["Mayor's Letter"] as string,
      thievesMap: byTitle[`${HANDOUTS_1.p1Only} Thieves' Map`] as string,
      secretOrders: byTitle["Secret Orders"] as string,
      oldBounty: byTitle["Old Bounty"] as string,
      shipManifest: byTitle["Ship Manifest"] as string,
    };
    assets = Object.fromEntries(
      db
        .select()
        .from(asset)
        .all()
        .map((a) => [a.name, a.id]),
    );
    expect(assets["thieves-map"]).toBeString();
    expect(assets["wanted-poster"]).toBeString();
    h = await startTestServer({ db, fake: false });
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
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

  test("FR-PARTY-07 leak: snapshots carry no party type; loads per player (headers, bodies, items)", async () => {
    for (const c of [dm, p1, p2]) {
      const snap = c.frames.find((f) => f.type === "snapshot");
      expect(snap && Object.keys(snap.type === "snapshot" ? snap.records : {})).not.toEqual(
        expect.arrayContaining([HANDOUT_TYPE]),
      );
      if (snap?.type !== "snapshot") throw new Error("no snapshot");
      for (const t of [HANDOUT_TYPE, HANDOUT_BODY_TYPE, PARTY_ITEM_TYPE])
        expect(snap.records[t]).toBeUndefined();
    }
    for (const c of [dm, p1, p2]) await loadBoard(c, allBodies());
    expect(ids(dm, HANDOUT_TYPE)).toEqual(Object.values(hid).sort());
    expect(ids(p1, HANDOUT_TYPE)).toEqual([hid.mayor, hid.thievesMap].sort());
    expect(ids(p2, HANDOUT_TYPE)).toEqual([hid.mayor]);
    expect(ids(p1, HANDOUT_BODY_TYPE)).toEqual([hid.mayor, hid.thievesMap].sort());
    expect(ids(p2, HANDOUT_BODY_TYPE)).toEqual([hid.mayor]);
    const p1h2 = p1.store.records[HANDOUT_TYPE]?.[hid.thievesMap as string] as Record<
      string,
      unknown
    >;
    expect(p1h2.sharedWith).toEqual({ mode: "players" });
    expect(p1h2.imageAssetIds).toEqual([assets["thieves-map"]]);
    expect(p1.store.records[HANDOUT_BODY_TYPE]?.[hid.thievesMap as string]).not.toHaveProperty(
      "sharedWith",
    );
    const items = (c: TestClient) =>
      Object.values(c.store.records[PARTY_ITEM_TYPE] ?? {})
        .map((i) => `${(i as { name: string }).name} ×${(i as { qty: number }).qty}`)
        .sort();
    for (const c of [dm, p1, p2])
      expect(items(c)).toEqual(["Potion of healing ×2", "Rope (50 ft) ×1", "Torch ×10"]);
    expectClean(p2, p2Forbidden(), "p2 initial");
    expectClean(p1, p1Forbidden(), "p1 initial");
    expect(leakScan(h.s, dm)).toEqual([]);
    await expectConverged(p1, cred("Player 1"));
    await expectConverged(p2, cred("Player 2"));
  });

  test("FR-PARTY-07 leak: create → share player-1 → share all → unshare; per-player frames", async () => {
    const created = await ok(
      dm,
      dm.intent(P.createHandout, {
        title: "Wanted Poster",
        body: "Reward 50 gp",
        imageAssetIds: [assets["wanted-poster"]],
      }),
    );
    const poster = (created.result as { handoutId: string }).handoutId;
    const posterSecrets = [poster, "Wanted Poster", "Reward 50 gp"];
    await Bun.sleep(100);
    expect(ids(dm, HANDOUT_TYPE)).toContain(poster);
    expectClean(p1, [...p1Forbidden(), ...posterSecrets], "p1 after create");
    expectClean(p2, [...p2Forbidden(), ...posterSecrets], "p2 after create");

    const p1Mark = p1.frames.length;
    const p2Mark = p2.frames.length;
    const toP1: SharedWith = { mode: "players", playerIds: [playerIds["Player 1"] as string] };
    await ok(dm, dm.intent(P.shareHandout, { handoutId: poster, sharedWith: toP1 }));
    await until(() => p1.store.records[HANDOUT_BODY_TYPE]?.[poster] !== undefined);
    const p1Event = p1.frames
      .slice(p1Mark)
      .find((f) => f.type === "event" && f.cause.name === "HandoutShared");
    expect(p1Event?.type === "event" && p1Event.changes.map((c) => `${c.type}:${c.op}`)).toEqual([
      `${HANDOUT_TYPE}:upsert`,
      `${HANDOUT_BODY_TYPE}:upsert`,
    ]);
    // OQ-PARTY-10: the redacted header names no recipient.
    expect(JSON.stringify(p1Event)).not.toContain(playerIds["Player 1"] as string);
    await Bun.sleep(100);
    // player-2: no change for this event (hidden → hidden), nothing of the poster.
    const p2Event = p2.frames
      .slice(p2Mark)
      .find((f) => f.type === "event" && f.cause.name === "HandoutShared");
    expect(
      p2Event === undefined || (p2Event.type === "event" && p2Event.changes.length === 0),
    ).toBe(true);
    expectClean(p2, [...p2Forbidden(), ...posterSecrets], "p2 after share to p1");
    // A fresh player-2 connection + load has nothing either.
    {
      const fresh = await h.live(cred("Player 2"));
      await loadBoard(fresh, [...allBodies(), poster]);
      expectClean(fresh, [...p2Forbidden(), ...posterSecrets], "p2 fresh after share to p1");
      fresh.close();
    }

    await ok(dm, dm.intent(P.shareHandout, { handoutId: poster, sharedWith: ALL }));
    await until(() => p2.store.records[HANDOUT_BODY_TYPE]?.[poster] !== undefined);
    expect(p2.store.records[HANDOUT_TYPE]?.[poster]).toMatchObject({ sharedWith: { mode: "all" } });
    expect(leakScan(h.s, p2)).toEqual([]);

    const p2Before = p2.frames.length;
    await ok(dm, dm.intent(P.shareHandout, { handoutId: poster, sharedWith: NONE }));
    for (const c of [p1, p2]) {
      await until(
        () =>
          c.store.records[HANDOUT_TYPE]?.[poster] === undefined &&
          c.store.records[HANDOUT_BODY_TYPE]?.[poster] === undefined,
      );
    }
    const unshare = p2.frames
      .slice(p2Before)
      .find((f) => f.type === "event" && f.cause.name === "HandoutShared");
    expect(unshare?.type === "event" && unshare.changes.map((c) => `${c.type}:${c.op}`)).toEqual([
      `${HANDOUT_TYPE}:delete`,
      `${HANDOUT_BODY_TYPE}:delete`,
    ]);
    // After a reconnect + load: no poster record and never its body or image for either player.
    // Its id and title stay in each gainer's own `handout-shared` row (OQ-PARTY-15).
    for (const [name, forbidden] of [
      ["Player 1", p1Forbidden()],
      ["Player 2", p2Forbidden()],
    ] as const) {
      const fresh = await h.live(cred(name));
      await loadBoard(fresh, [...allBodies(), poster]);
      expectClean(
        fresh,
        [...forbidden, "Reward 50 gp", assets["wanted-poster"] as string],
        `${name} fresh after unshare`,
      );
      expect(fresh.store.records[HANDOUT_TYPE]?.[poster]).toBeUndefined();
      expect(fresh.store.records[HANDOUT_BODY_TYPE]?.[poster]).toBeUndefined();
      const own = (
        Object.values(fresh.store.records[NOTIFICATION_TYPE] ?? {}) as NotificationRecord[]
      ).filter((n) => (n.payload as { handoutId?: string }).handoutId === poster);
      expect(own.map((n) => [n.kind, n.audience, n.audiencePlayerId, n.text])).toEqual([
        ["handout-shared", "player", playerIds[name] as string, "New handout: Wanted Poster"],
      ]);
      fresh.close();
    }
    await ok(dm, dm.intent(P.deleteHandout, { handoutId: poster }));
  });

  test("FR-PARTY-07 leak: before and after a reconnect, player-2 never gets the fixture's hidden handouts", async () => {
    p2.close();
    await p2.closed;
    p2 = await h.live(cred("Player 2"));
    await loadBoard(p2, allBodies());
    expect(ids(p2, HANDOUT_TYPE)).toEqual([hid.mayor]);
    expectClean(p2, p2Forbidden(), "p2 after reconnect");
    p1.close();
    await p1.closed;
    p1 = await h.live(cred("Player 1"));
    await loadBoard(p1, allBodies());
    expect(ids(p1, HANDOUT_TYPE)).toEqual([hid.mayor, hid.thievesMap].sort());
    expectClean(p1, p1Forbidden(), "p1 after reconnect");
    await expectConverged(p1, cred("Player 1"));
    await expectConverged(p2, cred("Player 2"));
  });

  test("FR-PARTY-10 loaded set: an unshare while away leaves no stale body; the reload omits it", async () => {
    await ok(p1, p1.load(HANDOUT_BODY_TYPE, [hid.thievesMap as string]));
    expect(p1.store.records[HANDOUT_BODY_TYPE]?.[hid.thievesMap as string]).toBeDefined();
    p1.close();
    await p1.closed;
    await ok(dm, dm.intent(P.shareHandout, { handoutId: hid.thievesMap, sharedWith: NONE }));
    p1 = await h.live(cred("Player 1"));
    // FR-SYNC-37: the snapshot holds no lazy row; nothing loaded.
    expect(p1.store.records[HANDOUT_BODY_TYPE]?.[hid.thievesMap as string]).toBeUndefined();
    expect(p1.lazy.types).toEqual([]);
    // A notification's Open loads the body by id: absent → "No longer shared" (client, slice 2).
    const a = await ok(p1, p1.load(HANDOUT_BODY_TYPE, [hid.thievesMap as string]));
    expect(a.result).toEqual({ records: { [HANDOUT_BODY_TYPE]: [] } });
    await ok(p1, p1.load(HANDOUT_TYPE));
    expect(ids(p1, HANDOUT_TYPE)).toEqual([hid.mayor]);
    // Restore the fixture share for the tests below.
    await ok(
      dm,
      dm.intent(P.shareHandout, {
        handoutId: hid.thievesMap,
        sharedWith: { mode: "players", playerIds: [playerIds["Player 1"] as string] },
      }),
    );
    await until(() => p1.store.records[HANDOUT_TYPE]?.[hid.thievesMap as string] !== undefined);
    // FR-SYNC-34: the re-share's live body upsert reaches player-1 (loaded or not).
    await until(() => p1.store.records[HANDOUT_BODY_TYPE]?.[hid.thievesMap] !== undefined);
  });

  test("FR-PARTY-19 FR-PARTY-17 an item add reaches every player of the campaign (party-item + item log row)", async () => {
    const before = [p1.frames.length, p2.frames.length];
    await ok(dm, dm.intent(P.addItem, { name: "Healer's kit", qty: 1, notes: "" }));
    for (const [i, c] of [p1, p2].entries()) {
      await until(() =>
        c.frames
          .slice(before[i])
          .some((f) => f.type === "event" && f.cause.name === "PartyItemAdded"),
      );
      const ev = c.frames
        .slice(before[i])
        .find((f) => f.type === "event" && f.cause.name === "PartyItemAdded");
      const changes = ev?.type === "event" ? ev.changes : [];
      expect(changes.map((x) => `${x.type}:${x.op}`)).toEqual([
        `${PARTY_ITEM_TYPE}:upsert`,
        `${LOOT_ENTRY_TYPE}:upsert`,
      ]);
      expect(changes[1]?.data).toMatchObject({ kind: "item", text: "Healer's kit", qty: 1 });
      expect(leakScan(h.s, c)).toEqual([]);
    }
    await expectConverged(p2, cred("Player 2"));
  });

  test("PARTY §11 campaign scope: Second Campaign strings never in Fixture Campaign frames", () => {
    for (const c of [dm, p1, p2]) {
      expect(c.raw()).not.toContain(SECOND_HANDOUT_TITLE);
      expect(c.raw()).not.toContain(SECOND_ITEM_NAME);
    }
  });

  test("PARTY §11 restart on the same DB → identical loads; leak scan clean", async () => {
    const loads = async (c: TestClient) => {
      const out: unknown[] = [];
      for (const [type, list] of [
        [HANDOUT_TYPE, undefined],
        [HANDOUT_BODY_TYPE, allBodies()],
        [PARTY_ITEM_TYPE, undefined],
      ] as const) {
        const a = await ok(c, c.load(type, list ? [...list] : undefined));
        out.push(a.result);
      }
      return out;
    };
    const before = { dm: await loads(dm), p1: await loads(p1), p2: await loads(p2) };
    await h.restart();
    for (const c of [dm, p1, p2]) await c.closed;
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
    expect({ dm: await loads(dm), p1: await loads(p1), p2: await loads(p2) }).toEqual(before);
    expectClean(p2, p2Forbidden(), "p2 after restart");
    expectClean(p1, p1Forbidden(), "p1 after restart");
  });
});
