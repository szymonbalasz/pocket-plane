import { afterEach, expect, test } from "bun:test";
import { recordsOf } from "@shared/protocol/store";
import { startTestServer, TEST_SECRET, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { createTestServices } from "../testing/services";
import { registerSceneProbe, type SceneProbeRecord } from "./testing/scene-probe";

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

async function setup() {
  h = await startTestServer();
  const seed = seedSyncProbe(h.s);
  const fx = registerSceneProbe(h.s);
  const dmActor = { role: "dm" as const, playerId: null, campaignId: seed.campaignId };
  const put = (sceneId: string, text: string, id?: string, hidden = false) =>
    h.s.commands.run(fx.set, { id, sceneId, text, hidden }, { actor: dmActor }) as { id: string };
  return { seed, fx, put };
}

const texts = (c: { store: Parameters<typeof recordsOf>[0] }) =>
  recordsOf<SceneProbeRecord>(c.store, "scene-probe")
    .map((r) => r.text)
    .sort();

test("CON-22 registration: scope scene needs sceneOf", () => {
  const s = createTestServices();
  const base = {
    type: "bad",
    scope: "scene" as const,
    schema: undefined as never,
    idOf: () => "x",
    campaignOf: () => "c",
    visibility: () => "full" as const,
    snapshot: () => [],
  };
  expect(() => s.records.register(base)).toThrow(/sceneOf/);
  expect(() => registerSceneProbe(createTestServices({ testMode: false }))).toThrow(/test mode/);
});

test("CON-22 FR-SYNC-09 snapshot: DM gets every scene's records; player only the active scene's; none without an active scene", async () => {
  const { seed, fx, put } = await setup();
  put("scene-a", "on A");
  put("scene-b", "OFFSCENE-SECRET");
  const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
  expect(p1.store.records["scene-probe"]).toEqual({});
  expect(p1.raw()).not.toContain("OFFSCENE-SECRET");

  fx.activeCache.set(seed.campaignId, "scene-a");
  const dm = await h.live({ role: "dm", secret: TEST_SECRET });
  const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
  expect(texts(dm)).toEqual(["OFFSCENE-SECRET", "on A"]);
  expect(texts(p2)).toEqual(["on A"]);
  expect(p2.raw()).not.toContain("OFFSCENE-SECRET");
});

test("CON-22 leak: a DM edit to a visible record on a non-active scene never reaches a player socket", async () => {
  const { seed, fx, put } = await setup();
  fx.activeCache.set(seed.campaignId, "scene-a");
  const onA = put("scene-a", "on A");
  const offB = put("scene-b", "OFFSCENE-SECRET");
  const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
  const p2 = await h.live({ role: "player", token: seed.p2.linkToken });
  const dm = await h.live({ role: "dm", secret: TEST_SECRET });

  // Visible (not hidden) record, but off the active scene: edits and a create.
  dm.intent("sceneprobe.set", {
    id: offB.id,
    sceneId: "scene-b",
    text: "OFFSCENE-SECRET 2",
    hidden: false,
  });
  dm.intent("sceneprobe.set", { sceneId: "scene-b", text: "OFFSCENE-SECRET new", hidden: false });
  for (let i = 0; i < 2; i++) {
    expect((await dm.next("event")).cause.name).toBe("SceneProbeSet");
    await dm.next("ack");
  }
  for (const p of [p1, p2]) await p.expectNoFrame(100);

  // The same edit on the active scene does reach players.
  dm.intent("sceneprobe.set", { id: onA.id, sceneId: "scene-a", text: "on A 2", hidden: false });
  for (const p of [p1, p2]) {
    expect((await p.next("event")).changes).toEqual([
      expect.objectContaining({ type: "scene-probe", id: onA.id, op: "upsert" }),
    ]);
  }
  for (const p of [p1, p2]) {
    expect(p.raw()).not.toContain("OFFSCENE-SECRET");
    expect(p.raw()).not.toContain("scene-b");
  }
});

test("CON-22 FR-SYNC-19/20 moving a record off the active scene = delete, onto it = upsert; store converges", async () => {
  const { seed, fx, put } = await setup();
  fx.activeCache.set(seed.campaignId, "scene-a");
  const r = put("scene-a", "mover");
  const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
  put("scene-b", "mover", r.id);
  expect((await p1.next("event")).changes).toEqual([
    { type: "scene-probe", id: r.id, op: "delete" },
  ]);
  put("scene-a", "mover back", r.id);
  expect((await p1.next("event")).changes[0]).toMatchObject({
    op: "upsert",
    data: { text: "mover back" },
  });
  put("scene-b", "x", undefined, true);
  await p1.expectNoFrame();
  const fresh = await h.live({ role: "player", token: seed.p1.linkToken });
  expect(p1.store.records).toEqual(fresh.store.records);
});

test("CON-22 FR-SYNC-11 after the active scene changes, a player resync shows only the new scene", async () => {
  const { seed, fx, put } = await setup();
  fx.activeCache.set(seed.campaignId, "scene-a");
  put("scene-a", "on A");
  put("scene-b", "on B");
  const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
  expect(texts(p1)).toEqual(["on A"]);
  fx.activeCache.set(seed.campaignId, "scene-b");
  h.hub.resync((c) => c.role === "player");
  await p1.next("snapshot");
  expect(texts(p1)).toEqual(["on B"]);
});
