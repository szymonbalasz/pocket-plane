import { afterEach, describe, expect, test } from "bun:test";
import type { ProbeRecord } from "@shared/live-sync/schemas";
import { recordsOf } from "@shared/protocol/store";
import { manualClock } from "../commands/context";
import { readEventLog } from "../events/log";
import { activateCampaign, renamePlayer } from "../features/campaign-management/commands";
import { probeSet } from "../features/live-sync/probe";
import { silentLogger } from "../log";
import { CloseCode, startTestServer, TEST_SECRET, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { createTestServices, DM_ACTOR } from "../testing/services";
import { Hub, type SocketLike } from "./hub";
import { fakeTimers } from "./timers";

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

async function setup(testMode = true) {
  h = await startTestServer({ testMode });
  const seed = seedSyncProbe(h.s);
  return seed;
}

const probes = (c: { store: Parameters<typeof recordsOf>[0] }) =>
  recordsOf<ProbeRecord>(c.store, "probe")
    .map((p) => p.text)
    .sort();

describe("hello and lifecycle", () => {
  test("FR-SYNC-01 no hello within 5 s → close 4408, no frame", async () => {
    await setup();
    const c = await h.connect(null);
    await Bun.sleep(30);
    h.timers.advance(4_999);
    expect(c.isClosed()).toBe(false);
    h.timers.advance(1);
    expect((await c.closed).code).toBe(CloseCode.noHello);
    expect(c.frames).toHaveLength(0);
  });

  test("FR-SYNC-02 invalid DM secret / unknown token → 4401, no other frame", async () => {
    await setup();
    const a = await h.connect({ role: "dm", secret: "wrong-secret-123" });
    const b = await h.connect({ role: "player", token: "AAAAAAAAAAAAAAAAAAAAAA" });
    const c = await h.connect({ role: "player", token: "not-a-token" });
    for (const x of [a, b, c]) {
      expect((await x.closed).code).toBe(CloseCode.credentialInvalid);
      expect(x.frames).toHaveLength(0);
    }
  });

  test("FR-SYNC-06 player of an inactive campaign → 4409, no frame; DM with none active → 4409", async () => {
    const seed = await setup();
    const c = await h.player(seed.p3.linkToken);
    expect(await c.closed).toEqual({ code: 4409, reason: "campaign-inactive" });
    expect(c.frames).toHaveLength(0);
    await h.stop();
    h = await startTestServer();
    const dm = await h.dm();
    expect((await dm.closed).code).toBe(CloseCode.campaignInactive);
  });

  test("FR-SYNC-08 exactly one snapshot (seq 0, you) precedes any event", async () => {
    const seed = await setup();
    const dm = await h.dm();
    const snap = await dm.next("snapshot");
    expect(snap.seq).toBe(0);
    expect(snap.you).toEqual({ campaignId: seed.campaignId, role: "dm", playerId: null });
    const p = await h.player(seed.p1.linkToken);
    const ps = await p.next("snapshot");
    expect(ps.you).toEqual({ campaignId: seed.campaignId, role: "player", playerId: seed.p1.id });
    expect(dm.frames.filter((f) => f.type === "snapshot")).toHaveLength(1);
  });

  test("FR-SYNC-04 ping → pong; 30 s silence → close 4408 (CON-11)", async () => {
    const seed = await setup();
    const p = await h.live({ role: "player", token: seed.p1.linkToken });
    p.send({ type: "ping" });
    await p.next("pong");
    await Bun.sleep(20);
    h.timers.advance(29_000);
    p.send({ type: "ping" });
    await p.next("pong");
    await Bun.sleep(20);
    h.timers.advance(29_000);
    expect(p.isClosed()).toBe(false);
    h.timers.advance(2_000);
    expect((await p.closed).code).toBe(CloseCode.noHello);
  });

  test("FR-SYNC-03 several connections of one player each get the same stream", async () => {
    const seed = await setup();
    const a = await h.live({ role: "player", token: seed.p1.linkToken });
    const b = await h.live({ role: "player", token: seed.p1.linkToken });
    const dm = { ...DM_ACTOR, campaignId: seed.campaignId };
    h.s.commands.run(
      probeSet,
      { id: seed.probes.public, text: "edited", hidden: false },
      { actor: dm },
    );
    expect((await a.next("event")).changes).toEqual((await b.next("event")).changes);
  });
});

describe("intents", () => {
  test("FR-SYNC-12 bad JSON / payload → reject invalid; unknown → unknown_intent; stays open", async () => {
    const seed = await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    dm.sendRaw("{nope");
    expect(await dm.next("reject")).toMatchObject({ code: "invalid", intentId: null });
    dm.intent("probe.set", { text: 5 }, "i-bad");
    const r = await dm.next("reject");
    expect(r).toMatchObject({ code: "invalid", intentId: "i-bad" });
    expect(r.issues?.length).toBeGreaterThan(0);
    dm.intent("nope.nope", {}, "i-unknown");
    expect(await dm.next("reject")).toMatchObject({
      code: "unknown_intent",
      intentId: "i-unknown",
    });
    dm.intent("campaign.create", { name: "x" }, "i-rest-only");
    expect(await dm.next("reject")).toMatchObject({ code: "unknown_intent" });
    dm.intent("probe.set", { id: seed.probes.public, text: "ok", hidden: false }, "i-ok");
    await dm.next("ack");
  });

  test("FR-SYNC-12 client frame > 64 KB → close 1009", async () => {
    await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    dm.intent("probe.set", { text: "x".repeat(70_000), hidden: false });
    expect((await dm.closed).code).toBe(1009);
  });

  test("FR-SYNC-13 player not allowed / not owner → reject forbidden, no change, no event", async () => {
    const seed = await setup();
    const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const logBefore = readEventLog(h.db).length;
    p2.intent("probe.set", { text: "hack", hidden: false }, "a");
    expect(await p2.next("reject")).toMatchObject({ code: "forbidden", intentId: "a" });
    p2.intent("probe.edit", { id: seed.probes.mine, text: "hack" }, "b");
    expect(await p2.next("reject")).toMatchObject({ code: "forbidden", intentId: "b" });
    p2.intent("probe.edit", { id: seed.probes.secret, text: "hack" }, "c");
    expect(await p2.next("reject")).toMatchObject({ code: "forbidden" });
    await dm.expectNoFrame();
    expect(readEventLog(h.db).length).toBe(logBefore);
  });

  test("FR-SYNC-14 events reach the sender before its ack; intentId on the sender's copy only", async () => {
    const seed = await setup();
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const p1b = await h.live({ role: "player", token: seed.p1.linkToken });
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const id = p1.intent("probe.edit", { id: seed.probes.mine, text: "mine v2" });
    const ev = await p1.next();
    expect(ev.type).toBe("event");
    expect(ev).toMatchObject({ cause: { name: "ProbeEdited", intentId: id } });
    expect(await p1.next()).toEqual({
      type: "ack",
      intentId: id,
      result: { id: seed.probes.mine },
    });
    const other = await p1b.next("event");
    expect(other.cause).toEqual({ name: "ProbeEdited" });
    expect((await dm.next("event")).cause).toEqual({ name: "ProbeEdited" });
    const log = readEventLog(h.db).at(-1);
    expect(log).toMatchObject({ type: "ProbeEdited", actorRole: "player", intentId: id });
    expect(log?.actorPlayerId).toBe(seed.p1.id);
  });
});

describe("visibility and convergence", () => {
  test("FR-SYNC-18/19 probe visibility: reveal = upsert, hide = delete, hidden→hidden = nothing", async () => {
    const seed = await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
    expect(probes(dm)).toEqual(["SECRET-PROBE", "mine", "public"]);
    expect(probes(p1)).toEqual(["mine", "public"]);
    expect(probes(p2)).toEqual(["public"]);

    const set = (id: string, hidden: boolean, text = "SECRET-PROBE") =>
      dm.intent("probe.set", { id, text, hidden });
    set(seed.probes.secret, false);
    expect((await p2.next("event")).changes).toEqual([
      expect.objectContaining({ type: "probe", id: seed.probes.secret, op: "upsert" }),
    ]);
    set(seed.probes.secret, true);
    expect((await p2.next("event")).changes).toEqual([
      { type: "probe", id: seed.probes.secret, op: "delete" },
    ]);
    set(seed.probes.secret, true, "SECRET-PROBE 2");
    await dm.next("ack");
    await dm.next("ack");
    await dm.next("ack");
    await p2.expectNoFrame();
    expect(probes(p2)).toEqual(["public"]);
  });

  test("FR-SYNC-20 convergence + leak scan: store after events = fresh snapshot; SECRET-PROBE only while revealed", async () => {
    const seed = await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
    const steps: [string, Record<string, unknown>][] = [
      ["probe.set", { id: seed.probes.public, text: "public 2", hidden: false }],
      [
        "probe.set",
        { id: seed.probes.mine, text: "mine", hidden: true, ownerPlayerId: seed.p1.id },
      ],
      [
        "probe.set",
        { id: seed.probes.mine, text: "mine", hidden: false, ownerPlayerId: seed.p2.id },
      ],
      ["probe.set", { text: "new", hidden: false, ownerPlayerId: seed.p1.id }],
      ["probe.set", { id: seed.probes.public, text: "public 3", hidden: true }],
    ];
    for (const [name, payload] of steps) {
      dm.intent(name, payload);
      await dm.next("ack");
    }
    await Bun.sleep(50);
    for (const [c, token] of [
      [p1, seed.p1.linkToken],
      [p2, seed.p2.linkToken],
    ] as const) {
      const fresh = await h.live({ role: "player", token });
      expect(c.store.records).toEqual(fresh.store.records);
      expect(c.gap).toBe(false);
      expect(c.raw()).not.toContain("SECRET-PROBE");
    }
  });

  test("FR-SYNC-10 commit during a paused snapshot arrives as an event after it, none lost or duplicated", async () => {
    const seed = await setup();
    const pause = h.pauseSnapshot();
    const p1 = await h.connect({ role: "player", token: seed.p1.linkToken });
    await pause.reached;
    const dmActor = { ...DM_ACTOR, campaignId: seed.campaignId };
    h.s.commands.run(
      probeSet,
      { id: seed.probes.public, text: "during", hidden: false },
      { actor: dmActor },
    );
    pause.release();
    const snap = await p1.next("snapshot");
    const pub = snap.records.probe?.find((r) => (r as ProbeRecord).id === seed.probes.public);
    expect((pub as ProbeRecord).text).toBe("public");
    const ev = await p1.next("event");
    expect(ev.seq).toBe(1);
    expect(ev.changes[0]).toMatchObject({ op: "upsert", data: { text: "during" } });
    await p1.expectNoFrame();
  });

  test("FR-SYNC-11/21 resync → fresh snapshot, seq restarts at 1", async () => {
    const seed = await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    dm.intent("probe.set", { id: seed.probes.public, text: "a", hidden: false });
    expect((await dm.next("event")).seq).toBe(1);
    dm.send({ type: "resync" });
    await dm.next("snapshot");
    dm.intent("probe.set", { id: seed.probes.public, text: "b", hidden: false });
    expect((await dm.next("event")).seq).toBe(1);
  });

  test("FR-CAMP-10/15 renames reach open connections of that campaign at once", async () => {
    const seed = await setup();
    const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
    h.s.commands.run(renamePlayer, { id: seed.p1.id, name: "Thorin" }, { actor: DM_ACTOR });
    const ev = await p2.next("event");
    expect(ev).toMatchObject({
      cause: { name: "PlayerRenamed" },
      changes: [{ type: "player", id: seed.p1.id, op: "upsert", data: { name: "Thorin" } }],
    });
  });

  test("FR-CAMP-19 no link token or DM secret in any frame; players get {id, name} of their campaign only", async () => {
    const seed = await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    h.s.commands.run(renamePlayer, { id: seed.p2.id, name: "P2b" }, { actor: DM_ACTOR });
    await p1.next("event");
    await dm.next("event");
    for (const c of [dm, p1]) {
      for (const t of [seed.p1.linkToken, seed.p2.linkToken, seed.p3.linkToken, TEST_SECRET]) {
        expect(c.raw()).not.toContain(t);
      }
      expect(c.raw()).not.toContain("Second");
    }
    expect(Object.keys(p1.store.records.player ?? {}).sort()).toEqual(
      [seed.p1.id, seed.p2.id].sort(),
    );
  });
});

describe("campaign switch, presence, restart", () => {
  test("FR-SYNC-07/FR-CAMP-09 switch closes every old-campaign connection with 4409; DM reconnects into the new one; waiting player rejoins", async () => {
    const seed = await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const mid = h.pauseSnapshot();
    const p2 = await h.connect({ role: "player", token: seed.p2.linkToken });
    await mid.reached;
    h.s.commands.run(activateCampaign, { id: seed.secondCampaignId }, { actor: DM_ACTOR });
    for (const c of [dm, p1, p2]) expect((await c.closed).code).toBe(CloseCode.campaignInactive);
    mid.release();
    expect(p2.frames).toHaveLength(0);

    const dm2 = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(dm2.store.you?.campaignId).toBe(seed.secondCampaignId);
    expect(recordsOf(dm2.store, "probe")).toEqual([]);
    const waiting = await h.player(seed.p1.linkToken);
    expect((await waiting.closed).code).toBe(4409);

    h.s.commands.run(activateCampaign, { id: seed.campaignId }, { actor: DM_ACTOR });
    expect((await dm2.closed).code).toBe(4409);
    const back = await h.live({ role: "player", token: seed.p1.linkToken });
    expect(probes(back)).toEqual(["mine", "public"]);
  });

  test("FR-SYNC-23 DM gets presence on connect and clean close; players never do", async () => {
    const seed = await setup();
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(recordsOf(dm.store, "presence")).toEqual([
      { id: seed.p1.id, playerId: seed.p1.id, campaignId: seed.campaignId, online: false },
      { id: seed.p2.id, playerId: seed.p2.id, campaignId: seed.campaignId, online: false },
    ]);
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const on = await dm.next("event");
    expect(on).toMatchObject({
      cause: { name: "presence" },
      changes: [{ type: "presence", id: seed.p1.id, op: "upsert", data: { online: true } }],
    });
    const p1b = await h.live({ role: "player", token: seed.p1.linkToken });
    await dm.expectNoFrame();
    p1.close();
    await dm.expectNoFrame();
    p1b.close();
    expect((await dm.next("event")).changes[0]).toMatchObject({ data: { online: false } });
    const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
    expect(p2.store.records.presence).toBeUndefined();
    expect(p2.raw()).not.toContain('"presence"');
  });

  test("FR-SYNC-25 restart on the same DB → identical snapshots", async () => {
    const seed = await setup();
    const before = await h.live({ role: "player", token: seed.p1.linkToken });
    const dmBefore = await h.live({ role: "dm", secret: TEST_SECRET });
    await h.restart();
    const after = await h.live({ role: "player", token: seed.p1.linkToken });
    const dmAfter = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(after.store.records).toEqual(before.store.records);
    const { presence: _a, ...dmA } = dmAfter.store.records;
    const { presence: _b, ...dmB } = dmBefore.store.records;
    expect(dmA).toEqual(dmB);
  });

  test("FR-SYNC-27 without test mode: no probe type, probe intents unknown", async () => {
    h = await startTestServer({ testMode: false });
    h.s.commands.run("campaign.create", { name: "C" }, { actor: DM_ACTOR });
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(dm.store.records.probe).toBeUndefined();
    dm.intent("probe.set", { text: "x", hidden: false });
    expect(await dm.next("reject")).toMatchObject({ code: "unknown_intent" });
  });
});

describe("hub unit", () => {
  test("FR-SYNC-21 send-buffer overflow → close 4000, frames never dropped silently", () => {
    const clock = manualClock();
    const s = createTestServices({ clock });
    const hub = new Hub(s, { timers: fakeTimers(clock), maxBufferedBytes: 10 });
    s.hub = hub;
    s.commands.run("campaign.create", { name: "C" }, { actor: DM_ACTOR });
    const closes: number[] = [];
    let buffered = 0;
    const sock: SocketLike = {
      send: (d) => {
        buffered += d.length;
        return -1;
      },
      close: (code) => closes.push(code ?? 0),
      getBufferedAmount: () => buffered,
    };
    const c = hub.open(sock);
    hub.message(
      c,
      JSON.stringify({ type: "hello", credential: { role: "dm", secret: TEST_SECRET } }),
    );
    expect(closes).toEqual([CloseCode.resyncRequired]);
    void silentLogger;
  });
});
