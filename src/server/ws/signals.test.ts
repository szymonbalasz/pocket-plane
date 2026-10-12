import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
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
