// PARTY §13.1 leak / reconnect / restart tests over real sockets on the `party-s5` bundle (S5 P0):
// `FR-PARTY-35 leak` (share + present walks, per-player frames), `FR-PARTY-35 reconnect` (a present
// waiting for a later connect; an unshare while offline), the crash hook after commit + restart,
// and `FR-ASSET-25 leak` (h6's attachment id never in a player frame until h6 is shared with them).
// The FR-PARTY-35 invariant is checked after every step.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { HANDOUT_ATTACHMENT } from "@fixtures/units/party-board/handout-attachment";
import { HANDOUTS_1 } from "@fixtures/units/party-board/handouts-1";
import {
  HANDOUT_BODY_TYPE,
  HANDOUT_PRESENT_TYPE,
  HANDOUT_TYPE,
  type HandoutPresentRecord,
  type SharedWith,
} from "@shared/party-board/schemas";
import type { Credential } from "@shared/protocol/frames";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, campaign, handout, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";
import { PARTY_INTENTS as P } from "./commands";
import { presentInvariantViolations } from "./testing";

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
const presents = (c: TestClient) =>
  Object.values(c.store.records[HANDOUT_PRESENT_TYPE] ?? {}) as HandoutPresentRecord[];
const snapshotPresents = (c: TestClient) => {
  const snap = [...c.frames].reverse().find((f) => f.type === "snapshot");
  if (snap?.type !== "snapshot") throw new Error("no snapshot");
  return (snap.records[HANDOUT_PRESENT_TYPE] ?? []) as HandoutPresentRecord[];
};
/** Every `handout-present` id a client's frames ever carried (snapshot rows and changes). */
const presentIdsSeen = (c: TestClient) => {
  const out = new Set<string>();
  for (const f of c.frames) {
    if (f.type === "snapshot")
      for (const r of (f.records[HANDOUT_PRESENT_TYPE] ?? []) as { id: string }[]) out.add(r.id);
    if (f.type === "event")
      for (const ch of f.changes) if (ch.type === HANDOUT_PRESENT_TYPE) out.add(ch.id);
  }
  return out;
};

describe("PARTY §13.1 present leak tests (party-s5; player-1, player-2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let pid: Record<string, string>;
  let hid: Record<"mayor" | "thievesMap" | "secretOrders" | "shipManifest" | "ransom", string>;
  let attachment: string;
  let fixture: string;
  /** Handouts shared with player-2 during the walk (their ids, title, body may reach them). */
  const p2Gained = new Set<string>();
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const invariant = () => expect(presentInvariantViolations(h.s.db)).toEqual([]);

  /** What player-2 must never receive (PARTY §13.1 leak list), minus what the walk shared. */
  const p2Forbidden = () =>
    [
      HANDOUTS_1.p1Only,
      HANDOUTS_1.secret,
      HANDOUTS_1.prep,
      HANDOUT_ATTACHMENT.body,
      hid.thievesMap,
      hid.secretOrders,
      hid.shipManifest,
      hid.ransom,
      attachment,
    ].filter((x) => !p2Gained.has(x));
  /** The raw frames minus notification records (their history keeps handout ids, OQ-PARTY-15). */
  const rawWithoutNotifications = (c: TestClient) =>
    c.frames
      .map((f) =>
        f.type === "snapshot"
          ? JSON.stringify({ ...f, records: { ...f.records, notification: [] } })
          : f.type === "event"
            ? JSON.stringify({ ...f, changes: f.changes.filter((x) => x.type !== "notification") })
            : JSON.stringify(f),
      )
      .join("\n");
  const expectClean = (c: TestClient, forbidden: string[], label: string) => {
    const raw = c.raw();
    expect([label, forbidden.filter((s) => raw.includes(s))]).toEqual([label, []]);
    expect([label, leakScan(h.s, c)]).toEqual([label, []]);
  };
  const share = (handoutId: string, sharedWith: SharedWith, present?: boolean) =>
    ok(dm, dm.intent(P.shareHandout, { handoutId, sharedWith, ...(present ? { present } : {}) }));
  const toP1 = (): SharedWith => ({ mode: "players", playerIds: [pid["Player 1"] as string] });
  const reconnect = async (c: TestClient, name: string) => {
    c.close();
    await c.closed;
    return h.live(cred(name));
  };

  beforeAll(async () => {
    const loaded = await loadBundle("party-s5", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    pid = Object.fromEntries(players.map((r) => [r.name, r.id]));
    fixture = db
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
      shipManifest: byTitle["Ship Manifest"] as string,
      ransom: byTitle[HANDOUT_ATTACHMENT.title] as string,
    };
    attachment = db
      .select()
      .from(asset)
      .all()
      .find((a) => a.name === "ransom-note")?.id as string;
    expect(Object.values(hid).every(Boolean) && Boolean(attachment)).toBe(true);
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

  test("FR-PARTY-31 snapshots: DM all rows, player-1 its own (h2, waiting since load), player-2 none; no attachment record", () => {
    expect(snapshotPresents(dm).map((r) => r.handoutId)).toEqual([hid.thievesMap]);
    expect(snapshotPresents(p1).map((r) => [r.handoutId, r.playerId])).toEqual([
      [hid.thievesMap, pid["Player 1"] as string],
    ]);
    expect(snapshotPresents(p2)).toEqual([]);
    // FR-ASSET-24: the attachment is no `asset` record, not even for the DM.
    const dmSnap = dm.frames.find((f) => f.type === "snapshot");
    if (dmSnap?.type !== "snapshot") throw new Error("no snapshot");
    expect(((dmSnap.records.asset ?? []) as { id: string }[]).map((a) => a.id)).not.toContain(
      attachment,
    );
    expectClean(p2, p2Forbidden(), "p2 initial");
    expectClean(p1, [HANDOUTS_1.secret, HANDOUTS_1.prep, hid.ransom, attachment], "p1 initial");
    invariant();
  });

  test("FR-PARTY-35 leak: share h5 → player-1 + present, → all + present, unshare; player-2 never holds player-1's row and vice versa; nobody holds a row after", async () => {
    const h5 = hid.shipManifest;
    await share(h5, toP1(), true);
    await until(() => presents(p1).some((r) => r.handoutId === h5));
    invariant();
    // One row per player: h5 replaced player-1's h2 present.
    expect(presents(p1).map((r) => r.handoutId)).toEqual([h5]);
    const p1Row = presents(p1)[0]?.id as string;
    await Bun.sleep(100);
    expect(presents(p2)).toEqual([]);
    expectClean(p2, p2Forbidden(), "p2 after share+present to p1");
    for (const ev of p2.frames.filter(
      (f) => f.type === "event" && f.cause.name === "HandoutPresented",
    ))
      expect(ev.type === "event" && ev.changes).toEqual([]);

    await share(h5, ALL, true);
    for (const x of [h5, HANDOUTS_1.prep]) p2Gained.add(x);
    await until(() => presents(p2).some((r) => r.handoutId === h5));
    invariant();
    const p2Row = presents(p2)[0]?.id as string;
    // Gainers only (review #23): player-1 already had h5, its row is untouched.
    expect(presents(p1).map((r) => r.id)).toEqual([p1Row]);
    expect(presentIdsSeen(p2).has(p1Row)).toBe(false);
    expect(presentIdsSeen(p1).has(p2Row)).toBe(false);

    await share(h5, NONE);
    for (const c of [p1, p2]) await until(() => presents(c).length === 0);
    await until(() => presents(dm).length === 0);
    invariant();
    expectClean(p2, p2Forbidden(), "p2 after");
    for (const [c, name] of [
      [p1, "Player 1"],
      [p2, "Player 2"],
    ] as const) {
      const fresh = await h.live(cred(name));
      expect(snapshotPresents(fresh)).toEqual([]);
      expect(rawWithoutNotifications(fresh)).not.toContain(h5);
      fresh.close();
      expect(presents(c)).toEqual([]);
    }
  });

  test("FR-PARTY-35 reconnect: a present made while offline is in the reconnect snapshot; an unshare while offline leaves no row and no h2 id", async () => {
    p1.close();
    await p1.closed;
    await ok(
      dm,
      dm.intent(P.presentHandout, {
        handoutId: hid.thievesMap,
        to: { mode: "players", playerIds: [pid["Player 1"]] },
      }),
    );
    invariant();
    p1 = await h.live(cred("Player 1"));
    expect(snapshotPresents(p1).map((r) => r.handoutId)).toEqual([hid.thievesMap]);
    // The popup's content loads by id (FR-PARTY-36 → FR-PARTY-10).
    await ok(p1, p1.load(HANDOUT_TYPE));
    await ok(p1, p1.load(HANDOUT_BODY_TYPE, [hid.thievesMap]));
    expect(p1.store.records[HANDOUT_BODY_TYPE]?.[hid.thievesMap]).toBeDefined();

    p1.close();
    await p1.closed;
    await share(hid.thievesMap, NONE);
    invariant();
    p1 = await h.live(cred("Player 1"));
    expect(snapshotPresents(p1)).toEqual([]);
    // Only player-1's own `handout-shared` history row still names h2 (OQ-PARTY-15).
    expect(rawWithoutNotifications(p1)).not.toContain(hid.thievesMap);

    expectClean(p2, p2Forbidden(), "p2 before reconnect");
    p2 = await reconnect(p2, "Player 2");
    await ok(p2, p2.load(HANDOUT_TYPE));
    await ok(p2, p2.load(HANDOUT_BODY_TYPE, Object.values(hid)));
    expectClean(p2, p2Forbidden(), "p2 after reconnect");
    // Restore the fixture share for the tests below.
    await share(hid.thievesMap, toP1());
  });

  test("FR-PARTY-31 crash hook party.presentHandout:after-commit → restart → the row is in player-1's snapshot and its data loads", async () => {
    armCrashHook({ point: "after-commit", target: P.presentHandout }, (w) => {
      throw new Error(w);
    });
    try {
      // The process "dies" after commit: no listener ran, nothing was broadcast.
      expect(() =>
        h.s.commands.run(
          P.presentHandout,
          { handoutId: hid.thievesMap, to: { mode: "all" } },
          { actor: { role: "dm", playerId: null, campaignId: fixture } },
        ),
      ).toThrow();
    } finally {
      armCrashHook(null);
    }
    await h.restart();
    for (const c of [dm, p1, p2]) await c.closed;
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
    expect(snapshotPresents(p1).map((r) => r.handoutId)).toEqual([hid.thievesMap]);
    expect(snapshotPresents(dm).map((r) => r.playerId)).toEqual([pid["Player 1"] as string]);
    expect(snapshotPresents(p2)).toEqual([]);
    await ok(p1, p1.load(HANDOUT_BODY_TYPE, [hid.thievesMap]));
    expect(p1.store.records[HANDOUT_BODY_TYPE]?.[hid.thievesMap]).toBeDefined();
    expectClean(p2, p2Forbidden(), "p2 after restart");
    invariant();
  });

  test("FR-ASSET-25 leak: h6's attachment id reaches a player only once h6 is shared with them", async () => {
    await ok(dm, dm.load(HANDOUT_TYPE));
    expect(dm.raw()).toContain(attachment);
    for (const c of [p1, p2]) {
      await ok(c, c.load(HANDOUT_TYPE));
      await ok(c, c.load(HANDOUT_BODY_TYPE, [hid.ransom]));
      expect(c.raw()).not.toContain(attachment);
    }
    await share(hid.ransom, toP1(), true);
    await until(() => p1.store.records[HANDOUT_TYPE]?.[hid.ransom] !== undefined);
    expect(p1.raw()).toContain(attachment);
    expect(presents(p1).map((r) => r.handoutId)).toEqual([hid.ransom]);
    await Bun.sleep(100);
    expectClean(p2, p2Forbidden(), "p2 after h6 → player-1");
    // Unshare: player-1's row goes with it; player-2 still never saw the id.
    await share(hid.ransom, NONE);
    await until(() => presents(p1).length === 0);
    invariant();
    const fresh = await h.live(cred("Player 2"));
    await ok(fresh, fresh.load(HANDOUT_TYPE));
    expectClean(fresh, p2Forbidden(), "p2 fresh after h6 unshare");
    fresh.close();
  });
});
