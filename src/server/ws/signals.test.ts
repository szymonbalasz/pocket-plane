import { afterEach, expect, spyOn, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { conflict, forbidden, notFound } from "../commands/errors";
import { stateDigest } from "../db/digest";
import { syncProbe } from "../db/schema";
import { readEventLog } from "../events/log";
import { startTestServer, TEST_SECRET, type TestClient, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { defineSignal, SignalRegistry } from "./signals";

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

// Shaped like scenes-map's signals (protocol §15); registered by the test, not a feature.
const Point = z.object({
  sceneId: z.string().min(1).max(64),
  x: z.number().finite().min(-16384).max(16384),
  y: z.number().finite().min(-16384).max(16384),
});
const ping = defineSignal({ name: "test.ping", schema: Point, roles: ["dm", "player"] });
const pull = defineSignal({ name: "test.pull", schema: Point, roles: ["dm"] });

async function setup() {
  h = await startTestServer();
  const seed = seedSyncProbe(h.s);
  h.s.signals.register(ping);
  h.s.signals.register(pull);
  const dm = await h.live({ role: "dm", secret: TEST_SECRET });
  const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
  const p1b = await h.live({ role: "player", token: seed.p1.linkToken });
  const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
  // Let the DM's presence events land first; `expectNoFrame` then sees only new frames.
  await Bun.sleep(50);
  return { seed, dm, p1, p1b, p2 };
}

const nextSignal = (c: TestClient) => c.next("signal");

test("ADR-0026 FR-SYNC-22 signal reaches every other live connection of the campaign with a server-stamped from, never the sender", async () => {
  const { seed, dm, p1, p1b, p2 } = await setup();
  // Spoof attempts: `from` at frame level and inside `data` are both ignored.
  p1.send({
    type: "signal",
    name: "test.ping",
    data: { sceneId: "s1", x: 10, y: -5, from: { role: "dm" } },
    from: { role: "dm" },
  });
  for (const c of [dm, p1b, p2]) {
    expect(await nextSignal(c)).toEqual({
      type: "signal",
      name: "test.ping",
      data: { sceneId: "s1", x: 10, y: -5 },
      from: { role: "player", playerId: seed.p1.id },
    });
  }
  await p1.expectNoFrame();

  dm.send({ type: "signal", name: "test.ping", data: { sceneId: "s1", x: 0, y: 0 } });
  for (const c of [p1, p1b, p2]) {
    expect((await nextSignal(c)).from).toEqual({ role: "dm" });
  }
  await dm.expectNoFrame();
});

test("ADR-0026 DM-only signal (map.pull rule): player send → reject forbidden, nobody receives; DM send reaches players", async () => {
  const { dm, p1, p1b, p2 } = await setup();
  p1.send({ type: "signal", name: "test.pull", data: { sceneId: "s1", x: 1, y: 2 } });
  expect(await p1.next("reject")).toMatchObject({ code: "forbidden", intentId: null });
  for (const c of [dm, p1b, p2]) await c.expectNoFrame(100);

  dm.send({ type: "signal", name: "test.pull", data: { sceneId: "s1", x: 1, y: 2 } });
  for (const c of [p1, p1b, p2]) {
    expect(await nextSignal(c)).toMatchObject({ name: "test.pull", from: { role: "dm" } });
  }
});

test("FR-SYNC-22 unknown signal → unknown_intent; bad data → invalid; nobody receives either", async () => {
  const { dm, p1, p2 } = await setup();
  p1.send({ type: "signal", name: "nope.nope", data: {} });
  expect(await p1.next("reject")).toMatchObject({ code: "unknown_intent", intentId: null });
  p1.send({ type: "signal", name: "test.ping", data: { sceneId: "s1", x: 1e9, y: 0 } });
  const r = await p1.next("reject");
  expect(r).toMatchObject({ code: "invalid", intentId: null });
  expect(r.issues?.[0]?.path).toEqual(["x"]);
  await dm.expectNoFrame(100);
  await p2.expectNoFrame(0);
});

test("FR-SYNC-22 signals touch no event log and no seq", async () => {
  const { seed, dm, p2 } = await setup();
  const logBefore = readEventLog(h.db).length;
  for (let i = 0; i < 3; i++) {
    dm.send({ type: "signal", name: "test.ping", data: { sceneId: "s1", x: i, y: 0 } });
    await p2.next("signal");
  }
  expect(readEventLog(h.db).length).toBe(logBefore);
  dm.intent("probe.set", { id: seed.probes.public, text: "after", hidden: false });
  expect((await p2.next("event")).seq).toBe(1);
});

test("FR-SYNC-22 registry: duplicate name or empty roles is a registration error", () => {
  const r = new SignalRegistry();
  r.register(ping);
  expect(() => r.register(ping)).toThrow(/twice/);
  expect(() => r.register(defineSignal({ name: "x.y", schema: Point, roles: [] }))).toThrow(
    /no roles/,
  );
});

// ---------- FR-SYNC-28 audience (ADR-0033) ----------

/** Names a probe like `map.drag` names a token; the hook routes by the probe's `hidden`. */
const probeRef = defineSignal({
  name: "test.probeRef",
  schema: z.object({ sceneId: z.string().min(1).max(64), probeId: z.string().min(1).max(64) }),
  roles: ["dm", "player"],
  audience: (data, sender, read) => {
    if (data.probeId === "boom") throw new Error("hook bug");
    if (data.probeId === "bad-return") return "nobody" as unknown as "all";
    if (data.probeId === "conflict") throw conflict("not a signal reject");
    const row = read.db
      .select()
      .from(syncProbe)
      .where(and(eq(syncProbe.id, data.probeId), eq(syncProbe.campaignId, sender.campaignId)))
      .get();
    if (!row) throw notFound("No such probe");
    if (sender.role === "player" && row.hidden) throw notFound("No such probe");
    if (sender.role === "player" && row.ownerPlayerId && row.ownerPlayerId !== sender.playerId) {
      throw forbidden("Not your probe");
    }
    if (read.activeSceneOf(sender.campaignId) === "prep") return "dm";
    return row.hidden ? "dm" : "all";
  },
});

async function setupAudience() {
  const base = await setup();
  h.s.signals.register(probeRef);
  const dm2 = await h.live({ role: "dm", secret: TEST_SECRET });
  await Bun.sleep(50);
  return { ...base, dm2 };
}

/** Frame counts now; `assertQuiet` then fails on any frame these clients got since. */
const mark = (cs: TestClient[]) => cs.map((c) => [c, c.frames.length] as const);
async function assertQuiet(m: ReturnType<typeof mark>, ms = 150) {
  await Bun.sleep(ms);
  for (const [c, n] of m) expect(c.frames.slice(n)).toEqual([]);
}

const ref = (probeId: string) => ({
  type: "signal",
  name: "test.probeRef",
  data: { sceneId: "s1", probeId },
});

test('FR-SYNC-28 audience "dm": hidden probe reaches the other DM connection only, never a player', async () => {
  const { seed, dm, dm2, p1, p1b, p2 } = await setupAudience();
  const quiet = mark([dm, p1, p1b, p2]);
  dm.send(ref(seed.probes.secret));
  expect(await nextSignal(dm2)).toEqual({
    type: "signal",
    name: "test.probeRef",
    data: { sceneId: "s1", probeId: seed.probes.secret },
    from: { role: "dm" },
  });
  await assertQuiet(quiet);
  for (const c of [p1, p1b, p2]) {
    expect(c.frames.some((f) => JSON.stringify(f).includes(seed.probes.secret))).toBe(false);
  }
});

test('FR-SYNC-28 audience reads the active-scene resolver: non-active scene → "dm"', async () => {
  const { seed, dm, dm2, p1, p2 } = await setupAudience();
  h.s.records.provideActiveScene(() => "prep", { replace: true });
  const quiet = mark([dm, p1, p2]);
  dm.send(ref(seed.probes.public));
  expect((await nextSignal(dm2)).data).toEqual({ sceneId: "s1", probeId: seed.probes.public });
  await assertQuiet(quiet);
});

test('FR-SYNC-28 audience "all": visible probe reaches every other live connection', async () => {
  const { seed, dm, dm2, p1, p1b, p2 } = await setupAudience();
  const quiet = mark([p1]);
  p1.send(ref(seed.probes.mine));
  for (const c of [dm, dm2, p1b, p2]) {
    expect(await nextSignal(c)).toMatchObject({
      name: "test.probeRef",
      from: { role: "player", playerId: seed.p1.id },
    });
  }
  await assertQuiet(quiet);
});

test("FR-SYNC-28 hook reject (not_found, forbidden) goes to the sender only; nobody receives the signal", async () => {
  const { seed, dm, dm2, p1, p1b, p2 } = await setupAudience();
  const quiet = mark([dm2, p1b]);
  p1.send(ref(seed.probes.secret));
  expect(await p1.next("reject")).toMatchObject({
    code: "not_found",
    intentId: null,
    message: "No such probe",
  });
  p2.send(ref(seed.probes.mine));
  expect(await p2.next("reject")).toMatchObject({ code: "forbidden", intentId: null });
  dm.send(ref("missing"));
  expect(await dm.next("reject")).toMatchObject({ code: "not_found", intentId: null });
  await assertQuiet(quiet);
  for (const c of [dm, p1, p2]) expect(c.frames.filter((f) => f.type === "signal")).toEqual([]);
});

test("FR-SYNC-28 hook error → reject internal to the sender, nobody receives it, logged once per (connection, name) per 10 s", async () => {
  const { dm, dm2, p1, p1b, p2 } = await setupAudience();
  const quiet = mark([dm, dm2, p1b]);
  const spy = spyOn(h.s.log, "error");
  try {
    for (let i = 0; i < 3; i++) {
      p1.send(ref("boom"));
      expect(await p1.next("reject")).toMatchObject({ code: "internal", intentId: null });
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain("test.probeRef");

    // Other connection: own throttle window.
    p2.send(ref("boom"));
    expect(await p2.next("reject")).toMatchObject({ code: "internal" });
    expect(spy).toHaveBeenCalledTimes(2);

    // A non-signal reject code and a bad return value are hook errors too.
    p1.send(ref("conflict"));
    expect(await p1.next("reject")).toMatchObject({ code: "internal" });
    p1.send(ref("bad-return"));
    expect(await p1.next("reject")).toMatchObject({ code: "internal" });
    expect(spy).toHaveBeenCalledTimes(2);

    h.clock.advance(9_999);
    p1.send(ref("boom"));
    await p1.next("reject");
    expect(spy).toHaveBeenCalledTimes(2);
    h.clock.advance(1);
    p1.send(ref("boom"));
    await p1.next("reject");
    expect(spy).toHaveBeenCalledTimes(3);

    await assertQuiet(quiet);
    expect(p2.frames.filter((f) => f.type === "signal")).toEqual([]);
    expect(p1.isClosed()).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

test("FR-SYNC-28 no hook: ADR-0026 forwarding unchanged (every other connection, incl. players)", async () => {
  const { dm, dm2, p1, p1b, p2 } = await setupAudience();
  const quiet = mark([dm]);
  dm.send({ type: "signal", name: "test.ping", data: { sceneId: "s1", x: 1, y: 1 } });
  for (const c of [dm2, p1, p1b, p2]) expect((await nextSignal(c)).name).toBe("test.ping");
  await assertQuiet(quiet);
});

test("FR-SYNC-28 audience hooks are read-only: DB state digest, event log and seq unchanged", async () => {
  const { seed, dm, dm2, p1, p2 } = await setupAudience();
  const before = stateDigest(h.db.$client);
  dm.send(ref(seed.probes.secret));
  await nextSignal(dm2);
  p1.send(ref(seed.probes.mine));
  await nextSignal(p2);
  p1.send(ref(seed.probes.secret));
  await p1.next("reject");
  p1.send(ref("boom"));
  await p1.next("reject");
  expect(stateDigest(h.db.$client)).toEqual(before);
  dm.intent("probe.set", { id: seed.probes.public, text: "after", hidden: false });
  expect((await p2.next("event")).seq).toBe(1);
});
