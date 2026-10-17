// OQ-FOG-58 (sprint 4, ADR party vision): server-originated signals carried by an intent result.
// The hub strips them from the ack, sends them right after it (same frame order) with `from` =
// the sender, only to the listed players' other live connections (never a DM, never the origin
// connection), under the type's rate (excess dropped, never delayed); an unregistered type or a
// bad payload sends nothing; clients can't send one.
import { afterEach, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../commands/commands";
import { startTestServer, TEST_SECRET, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { defineServerSignal, type ResultSignal, withSignals } from "./signals";

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

const Sight = z.object({ tokenId: z.string(), see: z.array(z.array(z.number())) });
const sight = defineServerSignal({
  name: "test.sight",
  schema: Sight,
  rate: { perSecond: 4, key: (d) => d.tokenId },
});

/** A test intent whose result carries the given signals. */
const emit = defineCommand({
  name: "test.emitSignals",
  input: z.object({ signals: z.array(z.unknown()) }),
  roles: ["dm", "player"],
  execute: ({ signals }) => withSignals({ ok: true }, signals as ResultSignal[]),
});

async function setup() {
  h = await startTestServer();
  const seed = seedSyncProbe(h.s);
  h.s.signals.registerServer(sight);
  h.s.commands.register(emit as unknown as CommandDef);
  h.s.intents.add(emit.name);
  const dm = await h.live({ role: "dm", secret: TEST_SECRET });
  const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
  const p1b = await h.live({ role: "player", token: seed.p1.linkToken });
  const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
  await Bun.sleep(50);
  return { seed, dm, p1, p1b, p2 };
}

const sig = (audience: string[], tokenId = "t1"): ResultSignal => ({
  name: "test.sight",
  payload: { tokenId, see: [[0, 0, 1, 0, 1, 1]] },
  audience,
});

test("OQ-FOG-58 an intent result's signals follow its ack (stripped from it) to the listed players' other connections, from = the sender; never a DM", async () => {
  const { seed, dm, p1, p1b, p2 } = await setup();
  const id = p1.intent(emit.name, { signals: [sig([seed.p1.id, seed.p2.id])] });
  const ack = await p1.next("ack");
  expect(ack).toEqual({ type: "ack", intentId: id, result: { ok: true } });
  for (const c of [p1b, p2]) {
    expect(await c.next("signal")).toEqual({
      type: "signal",
      name: "test.sight",
      data: { tokenId: "t1", see: [[0, 0, 1, 0, 1, 1]] },
      from: { role: "player", playerId: seed.p1.id },
    });
  }
  await p1.expectNoFrame();
  await dm.expectNoFrame();
  // From the DM: only the listed player; the DM's own connection never.
  dm.intent(emit.name, { signals: [sig([seed.p2.id])] });
  await dm.next("ack");
  expect((await p2.next("signal")).from).toEqual({ role: "dm" });
  for (const c of [p1, p1b]) await c.expectNoFrame(100);
});

test("OQ-FOG-58 rate: ≤ 4 frames per receiver and key in any second, the excess dropped (never delayed); another key has its own budget", async () => {
  const { seed, p1, p2 } = await setup();
  for (let i = 0; i < 6; i++) {
    p1.intent(emit.name, { signals: [sig([seed.p2.id], "t1")] });
    await p1.next("ack");
  }
  p1.intent(emit.name, { signals: [sig([seed.p2.id], "t2")] });
  await p1.next("ack");
  await Bun.sleep(100);
  const got = p2.frames
    .filter((f) => f.type === "signal")
    .map((f) => (f.data as { tokenId: string }).tokenId);
  expect(got).toEqual(["t1", "t1", "t1", "t1", "t2"]);
  // Nothing arrives later (dropped, not queued).
  await Bun.sleep(1100);
  expect(p2.frames.filter((f) => f.type === "signal")).toHaveLength(5);
});

test("OQ-FOG-58 an unregistered type or a bad payload sends nothing (logged), the ack still goes out; a client can't send a server signal", async () => {
  const { seed, p1, p2 } = await setup();
  const err = spyOn(h.s.log, "error").mockImplementation(() => {});
  p1.intent(emit.name, {
    signals: [
      { name: "test.nope", payload: {}, audience: [seed.p2.id] },
      { name: "test.sight", payload: { tokenId: 3 }, audience: [seed.p2.id] },
    ],
  });
  expect((await p1.next("ack")).type).toBe("ack");
  await p2.expectNoFrame(100);
  expect(err).toHaveBeenCalledTimes(2);
  err.mockRestore();
  p1.send({ type: "signal", name: "test.sight", data: { tokenId: "t1", see: [] } });
  expect(await p1.next("reject")).toMatchObject({ code: "unknown_intent" });
  await p2.expectNoFrame(100);
});
