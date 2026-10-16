// ADR-0045 lazy record types (FR-SYNC-30–34, 37, 38) on the server: registration, snapshot
// omission, `sync.load` validation / filter / frame order, live events, reconnect purge, helpers.
// Test-only lazy probes stand in for the sprint-3 consumers.
import { afterEach, describe, expect, test } from "bun:test";
import type { ServerFrame } from "@shared/protocol/frames";
import { emptyLoaded, markLoaded, SYNC_LOAD } from "@shared/protocol/lazy";
import { recordsOf } from "@shared/protocol/store";
import { count } from "drizzle-orm";
import { z } from "zod";
import { eventLog } from "../db/schema";
import type { Actor } from "../events/types";
import { startTestServer, TEST_SECRET, type TestClient, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { createTestServices } from "../testing/services";
import { defineRecordType, RecordRegistry, type Viewer } from "./records";
import { convergence, leakScan, playerViewer } from "./testing/convergence";
import {
  type LazyProbeFixture,
  type LazyProbeRecord,
  lazyLoadSizes,
  registerLazyProbe,
} from "./testing/lazy-probe";

type R = { id: string; campaignId: string; sceneId: string };
const base = {
  type: "t",
  scope: "campaign" as const,
  schema: z.any(),
  idOf: (r: R) => r.id,
  campaignOf: (r: R) => r.campaignId,
  visibility: () => "full" as const,
  snapshot: () => [] as R[],
};

describe("FR-SYNC-30 registry", () => {
  test("FR-SYNC-30 lazy registration: scene scope and window combos throw; lazy types absent from DM and player snapshots", () => {
    const r = new RecordRegistry();
    const sceneOf = (x: R) => x.sceneId;
    expect(() =>
      r.register(defineRecordType<R>({ ...base, scope: "scene", sceneOf, lazy: "all" })),
    ).toThrow(/lazy needs scope campaign or global/);
    expect(() =>
      r.register(
        defineRecordType<R>({
          ...base,
          scope: "scene",
          sceneOf,
          dmWindow: "active-scene",
          lazy: "ids",
        }),
      ),
    ).toThrow(/lazy/);
    expect(() =>
      r.register(
        defineRecordType<R>({
          ...base,
          lazy: "all",
          window: { orderBy: "seq" as never, size: 10 },
        }),
      ),
    ).toThrow(/lazy excludes window/);
    expect(() => r.register(defineRecordType<R>({ ...base, lazy: "some" as never }))).toThrow(
      /lazy must be one of/,
    );
    expect(r.all()).toEqual([]);

    const rows: R[] = [{ id: "a", campaignId: "c1", sceneId: "" }];
    r.register(defineRecordType<R>({ ...base, type: "lz", lazy: "all", snapshot: () => rows }));
    r.register(
      defineRecordType<R>({
        ...base,
        type: "lzg",
        scope: "global",
        lazy: "ids",
        snapshot: () => rows,
      }),
    );
    r.register(defineRecordType<R>({ ...base, type: "plain", snapshot: () => rows }));
    const src = { db: undefined as never, presence: { list: () => [] } };
    const dm: Viewer = { connId: "d", campaignId: "c1", role: "dm", playerId: null };
    for (const v of [dm, playerViewer("c1", "p1")]) {
      expect(Object.keys(r.snapshot(src, v))).toEqual(["plain"]);
    }
    expect(r.lazyTypes().map((d) => d.type)).toEqual(["lz", "lzg"]);
    expect(r.load(src, dm, "lz")).toEqual({ lz: rows });
    expect(() => r.load(src, dm, "plain")).toThrow(/not lazy/);
  });
});

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

async function setup() {
  h = await startTestServer();
  const seed = seedSyncProbe(h.s);
  const all = registerLazyProbe(h.s, { type: "lazy-probe" });
  const byIds = registerLazyProbe(h.s, { type: "lazy-ids", lazy: "ids", byIds: true });
  const dmOnly = registerLazyProbe(h.s, { type: "lazy-dm", audience: "dm" });
  const global = registerLazyProbe(h.s, { type: "lazy-global", scope: "global", lazy: "ids" });
  const dmActor: Actor = { role: "dm", playerId: null, campaignId: seed.campaignId };
  const put = (
    fx: LazyProbeFixture,
    input: { id?: string; text: string; secret?: string; hidden?: boolean; owner?: string },
    actor: Actor = dmActor,
  ) =>
    h.s.commands.run(
      fx.set,
      {
        id: input.id,
        text: input.text,
        secret: input.secret ?? "",
        hidden: input.hidden ?? false,
        ownerPlayerId: input.owner ?? null,
      },
      { actor },
    ) as { id: string };
  const dmCred = { role: "dm" as const, secret: TEST_SECRET };
  const p1Cred = { role: "player" as const, token: seed.p1.linkToken };
  const p2Cred = { role: "player" as const, token: seed.p2.linkToken };
  return { seed, all, byIds, dmOnly, global, dmActor, put, dmCred, p1Cred, p2Cred };
}

/** Waits for the ack / reject of `id`, returning every frame seen up to it. */
async function until(c: TestClient, id: string): Promise<ServerFrame[]> {
  const seen: ServerFrame[] = [];
  for (;;) {
    const f = await c.next(undefined, 2000);
    seen.push(f);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return seen;
  }
}
/** Next non-presence event (players connecting send the DM presence events). */
async function nextEvent(c: TestClient) {
  for (;;) {
    const e = await c.next("event");
    if (e.cause.name !== "presence") return e;
  }
}
const domainEvents = (c: TestClient) =>
  c.frames.filter((f) => f.type === "event" && f.cause.name !== "presence");
const last = (fs: ServerFrame[]) => fs[fs.length - 1] as ServerFrame;
const resultOf = (fs: ServerFrame[], type: string) => {
  const f = last(fs);
  if (f.type !== "ack") throw new Error(`expected ack, got ${JSON.stringify(f)}`);
  return (f.result as { records: Record<string, LazyProbeRecord[]> }).records[type] ?? [];
};
const texts = (c: TestClient, type: string) =>
  recordsOf<LazyProbeRecord>(c.store, type)
    .map((r) => r.text)
    .sort();

describe("ADR-0045 over real sockets", () => {
  test("FR-SYNC-30 lazy types absent from DM and player snapshots (raw frames too)", async () => {
    const { all, byIds, dmOnly, global, put, dmCred, p1Cred } = await setup();
    put(all, { text: "LZ-ALL" });
    put(byIds, { text: "LZ-IDS" });
    put(dmOnly, { text: "LZ-DM" });
    put(global, { text: "LZ-GLOBAL" });
    for (const cred of [dmCred, p1Cred]) {
      const c = await h.live(cred);
      const snap = c.frames[0] as Extract<ServerFrame, { type: "snapshot" }>;
      for (const t of ["lazy-probe", "lazy-ids", "lazy-dm", "lazy-global"]) {
        expect(snap.records[t]).toBeUndefined();
      }
      expect(snap.records.probe).toBeDefined();
      expect(c.raw()).not.toContain("LZ-");
    }
  });

  test("FR-SYNC-31 sync.load validation: invalid and forbidden cases, no change", async () => {
    const { all, byIds, dmOnly, put, dmCred, p1Cred } = await setup();
    const a = put(all, { text: "a" });
    put(dmOnly, { text: "dm only" });
    const dispatched: string[] = [];
    h.s.bus.subscribe("test-spy", (e) => dispatched.push(e.event.type));
    const logRows = () => h.s.db.select({ n: count() }).from(eventLog).get()?.n;
    const logBefore = logRows();
    const dm = await h.live(dmCred);
    const p1 = await h.live(p1Cred);
    const code = async (c: TestClient, id: string) => {
      const f = last(await until(c, id));
      return f.type === "reject" ? f.code : f.type;
    };
    const many = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
    for (const c of [dm, p1]) {
      expect(await code(c, c.load("nope"))).toBe("invalid"); // unknown type
      expect(await code(c, c.load("probe"))).toBe("invalid"); // not lazy
      expect(await code(c, c.load("lazy-ids"))).toBe("invalid"); // ids type without ids
      expect(await code(c, c.load("lazy-ids", []))).toBe("invalid");
      expect(await code(c, c.load("lazy-ids", many(51)))).toBe("invalid");
      expect(await code(c, c.load("lazy-ids", ["x", "x"]))).toBe("invalid");
      expect(await code(c, c.intent(SYNC_LOAD, { ids: ["x"] }))).toBe("invalid");
      expect(await code(c, c.load("lazy-ids", many(50)))).toBe("ack");
      expect(await code(c, c.load("lazy-probe", [a.id]))).toBe("ack"); // `all` takes ids too
    }
    expect(await code(p1, p1.load("lazy-dm"))).toBe("forbidden");
    expect(await code(p1, p1.load("lazy-dm", ["x"]))).toBe("forbidden");
    expect(await code(dm, dm.load("lazy-dm"))).toBe("ack");
    // Read-only: no event, no seq, no bus dispatch, no log row; rejects mark nothing loaded.
    for (const c of [dm, p1]) {
      expect(domainEvents(c)).toEqual([]);
      expect(c.store.seq).toBe(c.frames.filter((f) => f.type === "event").length);
    }
    expect(dispatched).toEqual([]);
    expect(logRows()).toBe(logBefore);
    expect(p1.lazy.types).toEqual([]);
    expect(p1.raw()).not.toContain("dm only");
    expect(byIds.byIdsCalls.length).toBe(2);
  });

  test("FR-SYNC-32 load result filtered as snapshot: hidden ids absent, redacted fields, other campaign absent, global gate", async () => {
    const { seed, all, byIds, global, put, dmCred, p1Cred, p2Cred } = await setup();
    const other: Actor = { role: "dm", playerId: null, campaignId: seed.secondCampaignId };
    const pub = put(all, { text: "public", secret: "S-PUB" });
    const hidden = put(all, { text: "HIDDEN-ROW", secret: "S-HID", hidden: true });
    const mine = put(all, { text: "mine", secret: "S-MINE", owner: seed.p1.id });
    const away = put(all, { text: "OTHER-CAMPAIGN" }, other);
    const g1 = put(global, { text: "global", secret: "S-G" });
    const g2 = put(global, { text: "G-HIDDEN", hidden: true });
    const i1 = put(byIds, { text: "by id", secret: "S-ID" });
    const dm = await h.live(dmCred);
    const p1 = await h.live(p1Cred);
    const p2 = await h.live(p2Cred);

    const dmAll = resultOf(await until(dm, dm.load("lazy-probe")), "lazy-probe");
    expect(dmAll.map((r) => r.text).sort()).toEqual(["HIDDEN-ROW", "mine", "public"]);
    expect(dmAll.find((r) => r.id === hidden.id)?.secret).toBe("S-HID");

    const p1All = resultOf(await until(p1, p1.load("lazy-probe")), "lazy-probe");
    expect(p1All.map((r) => r.text).sort()).toEqual(["mine", "public"]);
    expect(p1All.find((r) => r.id === pub.id)).toEqual({
      id: pub.id,
      campaignId: seed.campaignId,
      text: "public",
      hidden: false,
      ownerPlayerId: null,
    } as never);
    expect(p1All.find((r) => r.id === mine.id)?.secret).toBe("S-MINE");

    // Id loads: hidden, other-campaign and unknown ids are simply absent.
    const ids = [hidden.id, pub.id, away.id, "no-such-id", mine.id];
    const p2Ids = resultOf(await until(p2, p2.load("lazy-probe", ids)), "lazy-probe");
    expect(p2Ids.map((r) => r.id).sort()).toEqual([mine.id, pub.id].sort());
    expect(p2Ids.every((r) => r.secret === undefined)).toBe(true);
    const dmIds = resultOf(await until(dm, dm.load("lazy-probe", ids)), "lazy-probe");
    expect(dmIds.map((r) => r.id).sort()).toEqual([hidden.id, mine.id, pub.id].sort());

    // Global scope: any connection passes the gate; visibility decides.
    const gIds = [g1.id, g2.id];
    expect(resultOf(await until(dm, dm.load("lazy-global", gIds)), "lazy-global")).toHaveLength(2);
    const p1G = resultOf(await until(p1, p1.load("lazy-global", gIds)), "lazy-global");
    expect(p1G).toEqual([
      { id: g1.id, campaignId: null, text: "global", hidden: false, ownerPlayerId: null },
    ] as never);

    // `byIds` provider path filters the same way.
    const p1I = resultOf(await until(p1, p1.load("lazy-ids", [i1.id, hidden.id])), "lazy-ids");
    expect(p1I.map((r) => r.text)).toEqual(["by id"]);

    for (const c of [dm, p1, p2]) expect(leakScan(h.s, c)).toEqual([]);
    for (const c of [p1, p2]) {
      for (const s of [
        "HIDDEN-ROW",
        "OTHER-CAMPAIGN",
        "G-HIDDEN",
        "S-PUB",
        "S-HID",
        "S-G",
        "S-ID",
      ]) {
        expect(c.raw()).not.toContain(s);
      }
    }
    expect(p2.raw()).not.toContain("S-MINE");
    expect(dm.raw()).not.toContain("OTHER-CAMPAIGN");
  });

  test("FR-SYNC-33 commit during load: in result or as later event, never both, never neither", async () => {
    const { all, put, dmActor, dmCred, p1Cred } = await setup();
    const row = put(all, { text: "v0" });
    const dm = await h.live(dmCred);
    const dm2 = await h.live(dmCred);

    // (a) Pipelined on one socket: edit → load → edit; another tab commits concurrently.
    const e1 = dm.intent(all.set.name, { id: row.id, text: "v1" });
    const load = dm.load("lazy-probe");
    const e2 = dm.intent(all.set.name, { id: row.id, text: "v2" });
    dm2.intent(all.set.name, { text: "from tab 2" });
    const frames = await until(dm, e2);
    const ackAt = frames.findIndex((f) => f.type === "ack" && f.intentId === load);
    const e1At = frames.findIndex((f) => f.type === "ack" && f.intentId === e1);
    expect(e1At).toBeLessThan(ackAt);
    const result = resultOf(frames.slice(0, ackAt + 1), "lazy-probe");
    expect(result.find((r) => r.id === row.id)?.text).toBe("v1");
    for (let i = 0; i < 50 && !texts(dm, "lazy-probe").includes("from tab 2"); i++) {
      await Bun.sleep(20);
    }
    const inResult = result.some((r) => r.text === "from tab 2");
    const after = dm.frames.slice(dm.frames.indexOf(frames[ackAt] as ServerFrame) + 1);
    const asLater = after.some(
      (f) =>
        f.type === "event" &&
        f.changes.some((c) => (c.data as LazyProbeRecord)?.text === "from tab 2"),
    );
    expect(inResult !== asLater).toBe(true);
    expect(texts(dm, "lazy-probe")).toEqual(["from tab 2", "v2"]);
    expect(dm.gap).toBe(false);

    // (b) FR-SYNC-26 pause: a load sent while a resync snapshot is between read and send is
    // read at once and answered behind the events already pending.
    const p1 = await h.live(p1Cred);
    const { reached, release } = h.pauseSnapshot();
    p1.send({ type: "resync" });
    await reached;
    const x = put(all, { text: "X before load" }, dmActor);
    const id = p1.load("lazy-probe");
    p1.send({ type: "ping" });
    await p1.next("pong"); // the load was handled (frames are handled in order)
    const y = put(all, { text: "Y after load" }, dmActor);
    release();
    const seen = await until(p1, id);
    const snapAt = seen.findIndex((f) => f.type === "snapshot");
    expect(snapAt).toBeGreaterThanOrEqual(0);
    const res = resultOf(seen, "lazy-probe");
    expect(res.some((r) => r.id === x.id)).toBe(true);
    expect(res.some((r) => r.id === y.id)).toBe(false);
    const yEvent = await nextEvent(p1);
    expect(yEvent.changes.map((c) => c.id)).toEqual([y.id]);
    expect(p1.gap).toBe(false);
    expect(texts(p1, "lazy-probe")).toEqual(["X before load", "Y after load", "from tab 2", "v2"]);
    const fresh = await h.live(p1Cred);
    await until(fresh, fresh.load("lazy-probe"));
    const c = convergence(h.s, p1, fresh);
    expect(c.live).toEqual(c.fresh);
    expect(Object.keys(c.live["lazy-probe"] ?? {})).toHaveLength(4);
  });

  test("FR-SYNC-34 events for unloaded lazy rows delivered, loaded set unchanged", async () => {
    const { all, put, dmCred, p1Cred } = await setup();
    const dm = await h.live(dmCred);
    const p1 = await h.live(p1Cred);
    const row = put(all, { text: "new", secret: "S-NEW" });
    for (const c of [dm, p1]) {
      const e = await nextEvent(c);
      expect(e.changes.map((ch) => [ch.id, ch.op])).toEqual([[row.id, "upsert"]]);
    }
    expect(recordsOf<LazyProbeRecord>(p1.store, "lazy-probe")[0]?.secret).toBeUndefined();
    put(all, { id: row.id, text: "new", hidden: true });
    expect((await nextEvent(p1)).changes).toEqual([
      { type: "lazy-probe", id: row.id, op: "delete" },
    ]);
    expect((await nextEvent(dm)).changes[0]?.op).toBe("upsert");
    put(all, { id: row.id, text: "revealed" });
    expect((await nextEvent(p1)).changes[0]?.op).toBe("upsert");
    for (const c of [dm, p1]) {
      expect(c.lazy).toEqual(emptyLoaded());
      expect(leakScan(h.s, c)).toEqual([]);
    }
    expect(p1.raw()).not.toContain("S-NEW");
  });

  test("FR-SYNC-37 snapshot purges lazy rows and loaded sets; stale row not readable after reconnect", async () => {
    const { all, put, dmActor, p1Cred } = await setup();
    const row = put(all, { text: "shared once" });
    let p1 = await h.live(p1Cred);
    await until(p1, p1.load("lazy-probe"));
    expect(texts(p1, "lazy-probe")).toEqual(["shared once"]);
    // Resync: lazy rows and the loaded set are gone.
    p1.send({ type: "resync" });
    await p1.next("snapshot");
    expect(p1.store.records["lazy-probe"]).toBeUndefined();
    expect(p1.lazy).toEqual(emptyLoaded());
    // Unshared while the player is away: the new connection never sees it.
    p1.close();
    await p1.closed;
    put(all, { id: row.id, text: "shared once", hidden: true }, dmActor);
    p1 = await h.live(p1Cred);
    expect(p1.store.records["lazy-probe"]).toBeUndefined();
    expect(resultOf(await until(p1, p1.load("lazy-probe")), "lazy-probe")).toEqual([]);
    expect(p1.raw()).not.toContain("shared once");
  });

  test("FR-SYNC-38 convergence with loaded set; leak scan covers load acks", async () => {
    const { all, put, dmCred, p1Cred } = await setup();
    const a = put(all, { text: "a" });
    const p1 = await h.live(p1Cred);
    await until(p1, p1.load("lazy-probe", [a.id]));
    // A live upsert of an unloaded id lands in the store but is outside the comparison.
    const b = put(all, { text: "b" });
    put(all, { id: a.id, text: "a v2" });
    await nextEvent(p1);
    await nextEvent(p1);
    expect(texts(p1, "lazy-probe")).toEqual(["a v2", "b"]);
    const fresh = await h.live(p1Cred);
    await until(fresh, fresh.load("lazy-probe", [a.id]));
    const c = convergence(h.s, p1, fresh);
    expect(c.live).toEqual(c.fresh);
    expect(Object.keys(c.live["lazy-probe"] ?? {})).toEqual([a.id]);
    // Claiming the whole type loaded exposes the difference (b held, fresh never loaded it).
    const whole = convergence(h.s, p1, fresh, [], markLoaded(emptyLoaded(), "lazy-probe"));
    expect(whole.live).not.toEqual(whole.fresh);
    expect(Object.keys(whole.live["lazy-probe"] ?? {}).sort()).toEqual([a.id, b.id].sort());
    expect(leakScan(h.s, p1)).toEqual([]);
    const dm = await h.live(dmCred);
    await until(dm, dm.load("lazy-probe"));
    expect(leakScan(h.s, dm)).toEqual([]);
  });
});

test("FR-SYNC-38 leak scan reads sync.load acks; lazyLoadSizes measures the worst load", () => {
  const s = createTestServices({ testMode: true });
  const seed = seedSyncProbe(s);
  const all = registerLazyProbe(s);
  const ids = registerLazyProbe(s, { type: "lazy-ids", lazy: "ids" });
  const dmActor: Actor = { role: "dm", playerId: null, campaignId: seed.campaignId };
  const run = (fx: LazyProbeFixture, text: string, hidden = false, secret = "") =>
    s.commands.run(fx.set, { text, hidden, secret, ownerPlayerId: null }, { actor: dmActor }) as {
      id: string;
    };
  const hidden = run(all, "SECRET", true);
  const pub = run(all, "pub", false, "S");
  const store = {
    you: { campaignId: seed.campaignId, role: "player" as const, playerId: seed.p1.id },
    seq: 0,
    records: {},
  };
  const row = (id: string) => all.rows.get(id);
  const ack = (records: unknown): ServerFrame => ({
    type: "ack",
    intentId: "i1",
    result: { records },
  });
  expect(leakScan(s, { store, frames: [] })).toEqual([]);
  expect(leakScan(s, { store, frames: [ack({ "lazy-probe": [row(hidden.id)] })] })).toEqual([
    `ack i1: lazy-probe/${hidden.id}: hidden from this viewer`,
  ]);
  expect(leakScan(s, { store, frames: [ack({ "lazy-probe": [row(pub.id)] })] })).toEqual([
    `ack i1: lazy-probe/${pub.id}: extra fields secret`,
  ]);

  // 60 rows of growing size: the `ids` type's worst load is its 50 largest; `all` the whole type.
  for (let i = 0; i < 60; i++) run(ids, "x".repeat(10 * (i + 1)));
  const viewers = [
    {
      label: "DM",
      viewer: { connId: "d", campaignId: seed.campaignId, role: "dm" as const, playerId: null },
    },
    { label: "P1", viewer: playerViewer(seed.campaignId, seed.p1.id) },
  ];
  const idSizes = lazyLoadSizes(s, "lazy-ids", viewers);
  expect(idSizes.map((x) => x.rows)).toEqual([50, 50]);
  const top50 = [...ids.rows.values()].sort((a, b) => b.text.length - a.text.length).slice(0, 50);
  const dmBytes = Buffer.byteLength(
    JSON.stringify({
      type: "ack",
      intentId: "0".repeat(36),
      result: { records: { "lazy-ids": top50 } },
    }),
  );
  expect(idSizes.find((x) => x.label === "DM")?.bytes).toBe(dmBytes);
  const allSizes = lazyLoadSizes(s, "lazy-probe", viewers);
  expect(allSizes.map((x) => [x.label, x.rows])).toEqual([
    ["DM", 2],
    ["P1", 1],
  ]);
  expect(() => lazyLoadSizes(s, "probe", viewers)).toThrow(/not lazy/);
});
