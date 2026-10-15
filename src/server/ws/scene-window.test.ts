// ADR-0041 active-scene window: registry flag, DM snapshot cut, `sync.loadScene` in hub frame
// order, rejects, reconnect reset, convergence + leak helpers. Scene probe flagged `dmWindow`.
import { afterEach, describe, expect, test } from "bun:test";
import type { ServerFrame } from "@shared/protocol/frames";
import { SYNC_LOAD_SCENE } from "@shared/protocol/scene-window";
import { recordsOf } from "@shared/protocol/store";
import { z } from "zod";
import { startTestServer, TEST_SECRET, type TestClient, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { createTestServices } from "../testing/services";
import { defineRecordType, RecordRegistry, type Viewer } from "./records";
import { convergence, leakScan } from "./testing/convergence";
import { registerSceneProbe, type SceneProbeRecord } from "./testing/scene-probe";

describe("ADR-0041 registry", () => {
  type R = { id: string; campaignId: string; sceneId: string; hidden: boolean };
  const rows: R[] = [
    { id: "a1", campaignId: "c1", sceneId: "A", hidden: false },
    { id: "b1", campaignId: "c1", sceneId: "B", hidden: false },
    { id: "b2", campaignId: "c1", sceneId: "B", hidden: true },
    { id: "x1", campaignId: "c2", sceneId: "B", hidden: false },
  ];
  const base = {
    type: "tok",
    scope: "scene" as const,
    schema: z.any(),
    idOf: (r: R) => r.id,
    campaignOf: (r: R) => r.campaignId,
    sceneOf: (r: R) => r.sceneId,
    visibility: (r: R) => (r.hidden ? ("hidden" as const) : ("full" as const)),
    snapshot: () => rows,
  };
  const dm: Viewer = { connId: "d", campaignId: "c1", role: "dm", playerId: null };
  const player: Viewer = { connId: "p", campaignId: "c1", role: "player", playerId: "p1" };
  const src = { db: undefined as never, presence: { list: () => [] } };
  const ids = (list: unknown[] | undefined) => (list as R[]).map((r) => r.id);

  test("ADR-0041 registration: dmWindow needs scope scene and the one value", () => {
    const r = new RecordRegistry();
    expect(() =>
      r.register(
        defineRecordType<R>({
          ...base,
          scope: "campaign",
          sceneOf: undefined,
          dmWindow: "active-scene",
        }),
      ),
    ).toThrow(/scope scene/);
    expect(() => r.register(defineRecordType<R>({ ...base, dmWindow: "all" as never }))).toThrow(
      /dmWindow/,
    );
  });

  test("ADR-0041 snapshot: DM gets the active scene's rows only (none without one); players unchanged", () => {
    const flagged = new RecordRegistry();
    flagged.register(defineRecordType<R>({ ...base, dmWindow: "active-scene" }));
    const plain = new RecordRegistry();
    plain.register(defineRecordType<R>(base));
    expect(ids(flagged.snapshot(src, dm).tok)).toEqual([]);
    for (const r of [flagged, plain]) r.provideActiveScene(() => "B");
    expect(ids(flagged.snapshot(src, dm).tok)).toEqual(["b1", "b2"]);
    expect(ids(plain.snapshot(src, dm).tok)).toEqual(["a1", "b1", "b2"]);
    expect(flagged.snapshot(src, player)).toEqual(plain.snapshot(src, player));
    expect(flagged.dmWindowScene(dm)).toBe("B");
    expect(flagged.dmWindowScene(player)).toBeNull();
  });

  test("ADR-0041 loadScene: that scene's rows of the viewer's campaign, through the filter", () => {
    const r = new RecordRegistry();
    r.register(defineRecordType<R>({ ...base, dmWindow: "active-scene" }));
    r.register(defineRecordType<R>({ ...base, type: "other" }));
    r.provideActiveScene(() => "A");
    expect(r.loadScene(src, dm, "B")).toEqual({ tok: [rows[1], rows[2]] });
    // Uniform filter: a player would get the visible rows only (players never load, ADR-0041).
    expect(ids(r.loadScene(src, player, "B").tok)).toEqual([]);
    expect(r.loadScene(src, dm, "nope")).toEqual({ tok: [] });
  });
});

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

async function setup() {
  h = await startTestServer();
  const seed = seedSyncProbe(h.s);
  const fx = registerSceneProbe(h.s, { dmWindow: true });
  const dmActor = { role: "dm" as const, playerId: null, campaignId: seed.campaignId };
  const put = (sceneId: string, text: string, id?: string, hidden = false) =>
    h.s.commands.run(fx.set, { id, sceneId, text, hidden }, { actor: dmActor }) as { id: string };
  fx.activeCache.set(seed.campaignId, "scene-a");
  const dmCred = { role: "dm" as const, secret: TEST_SECRET };
  return { seed, fx, put, dmCred };
}

const texts = (c: TestClient) =>
  recordsOf<SceneProbeRecord>(c.store, "scene-probe")
    .map((r) => r.text)
    .sort();

/** Waits for the ack / reject of `id`, returning every frame seen up to it. */
async function until(c: TestClient, id: string): Promise<ServerFrame[]> {
  const seen: ServerFrame[] = [];
  for (;;) {
    const f = await c.next(undefined, 2000);
    seen.push(f);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return seen;
  }
}
const last = (fs: ServerFrame[]) => fs[fs.length - 1] as ServerFrame;

describe("ADR-0041 over real sockets", () => {
  test("ADR-0041 DM snapshot excludes non-active scenes' rows; players unchanged", async () => {
    const { seed, put, dmCred } = await setup();
    put("scene-a", "on A");
    put("scene-b", "on B");
    put("scene-a", "hidden A", undefined, true);
    const dm = await h.live(dmCred);
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    expect(texts(dm)).toEqual(["hidden A", "on A"]);
    expect(dm.raw()).not.toContain("on B");
    expect(texts(p1)).toEqual(["on A"]);
  });

  test("ADR-0041 sync.loadScene returns exactly that scene's rows; no event, no seq", async () => {
    const { put, dmCred } = await setup();
    put("scene-a", "on A");
    put("scene-b", "on B");
    put("scene-b", "hidden B", undefined, true);
    put("scene-c", "on C");
    const dm = await h.live(dmCred);
    const id = dm.loadScene("scene-b");
    const frames = await until(dm, id);
    expect(frames).toHaveLength(1);
    const ack = last(frames);
    expect(ack.type).toBe("ack");
    const loaded = (ack as { result: { records: Record<string, SceneProbeRecord[]> } }).result;
    expect(loaded.records["scene-probe"]?.map((r) => r.text).sort()).toEqual(["hidden B", "on B"]);
    // Every flagged type answers (the real `token` too: none on this scene).
    expect(loaded.records.token).toEqual([]);
    expect(texts(dm)).toEqual(["hidden B", "on A", "on B"]);
    expect(dm.store.seq).toBe(0);
    expect(dm.loadedScenes).toEqual(["scene-b"]);
    expect(leakScan(h.s, dm)).toEqual([]);
  });

  test("ADR-0041 FR-SYNC-10 an event racing the load: answered in frame order, nothing lost or duplicated", async () => {
    const { put, dmCred } = await setup();
    const b = put("scene-b", "v0");
    const dm = await h.live(dmCred);
    const dm2 = await h.live(dmCred);
    // Pipelined on one socket: edit → load → edit. The hub answers in frame order.
    const e1 = dm.intent("sceneprobe.set", {
      id: b.id,
      sceneId: "scene-b",
      text: "v1",
      hidden: false,
    });
    const load = dm.loadScene("scene-b");
    const e2 = dm.intent("sceneprobe.set", {
      id: b.id,
      sceneId: "scene-b",
      text: "v2",
      hidden: false,
    });
    // A second DM tab edits the same scene concurrently.
    dm2.intent("sceneprobe.set", { sceneId: "scene-b", text: "from tab 2", hidden: false });
    const frames = await until(dm, e2);
    const order = frames.map((f) =>
      f.type === "ack"
        ? `ack:${f.intentId === load ? "load" : f.intentId === e1 ? "e1" : "e2"}`
        : f.type,
    );
    expect(order.indexOf("ack:e1")).toBeLessThan(order.indexOf("ack:load"));
    expect(order.indexOf("ack:load")).toBeLessThan(order.indexOf("ack:e2"));
    const ack = frames.find((f) => f.type === "ack" && f.intentId === load) as {
      result: { records: Record<string, SceneProbeRecord[]> };
    };
    // The read saw e1 (its event went out before the ack), not e2 (its event follows).
    expect(ack.result.records["scene-probe"]?.find((r) => r.id === b.id)?.text).toBe("v1");
    for (let i = 0; i < 50 && !texts(dm).includes("from tab 2"); i++) await Bun.sleep(20);
    expect(texts(dm)).toEqual(["from tab 2", "v2"]);
    expect(dm.gap).toBe(false);
    // Converges with a fresh DM that loads the same scene.
    const fresh = await h.live(dmCred);
    expect((last(await until(fresh, fresh.loadScene("scene-b"))) as { type: string }).type).toBe(
      "ack",
    );
    const c = convergence(h.s, dm, fresh);
    expect(c.live).toEqual(c.fresh);
    expect(Object.keys(c.live["scene-probe"] ?? {})).toHaveLength(2);
  });

  test("ADR-0041 rejects: unknown scene and other-campaign scene → not_found; player → forbidden; bad payload → invalid", async () => {
    const { seed, fx, put, dmCred } = await setup();
    put("scene-b", "on B");
    fx.scenes.set("scene-other", seed.secondCampaignId);
    const dm = await h.live(dmCred);
    const code = async (c: TestClient, id: string) => {
      const f = last(await until(c, id));
      return f.type === "reject" ? f.code : f.type;
    };
    expect(await code(dm, dm.loadScene("nope"))).toBe("not_found");
    expect(await code(dm, dm.loadScene("scene-other"))).toBe("not_found");
    expect(await code(dm, dm.intent(SYNC_LOAD_SCENE, { scene: "scene-b" }))).toBe("invalid");
    expect(dm.loadedScenes).toEqual([]);
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    expect(await code(p1, p1.loadScene("scene-b"))).toBe("forbidden");
    expect(p1.raw()).not.toContain("on B");
  });

  test("ADR-0041 reconnect / resync resets the window to the active scene", async () => {
    const { put, dmCred } = await setup();
    put("scene-a", "on A");
    put("scene-b", "on B");
    const dm = await h.live(dmCred);
    await until(dm, dm.loadScene("scene-b"));
    expect(texts(dm)).toEqual(["on A", "on B"]);
    dm.send({ type: "resync" });
    await dm.next("snapshot");
    expect(texts(dm)).toEqual(["on A"]);
    expect(dm.loadedScenes).toEqual([]);
  });

  test("ADR-0041 FR-SYNC-20 convergence compares the active + loaded scenes; live events still reach the DM for every scene", async () => {
    const { put, dmCred } = await setup();
    put("scene-a", "on A");
    const b = put("scene-b", "on B");
    put("scene-c", "on C");
    const dm = await h.live(dmCred);
    await until(dm, dm.loadScene("scene-b"));
    // Live events for a loaded and an unloaded scene both arrive.
    put("scene-b", "on B v2", b.id);
    put("scene-c", "new on C");
    await dm.next("event");
    await dm.next("event");
    expect(texts(dm)).toEqual(["new on C", "on A", "on B v2"]);
    const fresh = await h.live(dmCred);
    // Unloaded scene-c (one live upsert held) is outside the comparison; loaded scene-b is in.
    const c0 = convergence(h.s, dm, fresh, []);
    expect(c0.live).toEqual(c0.fresh);
    const c1 = convergence(h.s, dm, fresh);
    expect(c1.live).not.toEqual(c1.fresh);
    await until(fresh, fresh.loadScene("scene-b"));
    const c = convergence(h.s, dm, fresh);
    expect(c.live).toEqual(c.fresh);
    expect(leakScan(h.s, dm)).toEqual([]);
  });
});

test("ADR-0041 leak scan also reads ack.records (B11)", () => {
  const s = createTestServices({ testMode: true });
  const seed = seedSyncProbe(s);
  const fx = registerSceneProbe(s, { dmWindow: true });
  const dmActor = { role: "dm" as const, playerId: null, campaignId: seed.campaignId };
  const hidden = s.commands.run(
    fx.set,
    { sceneId: "scene-a", text: "SECRET", hidden: true },
    { actor: dmActor },
  ) as { id: string };
  fx.activeCache.set(seed.campaignId, "scene-a");
  const row = fx.rows.get(hidden.id);
  const store = {
    you: { campaignId: seed.campaignId, role: "player" as const, playerId: seed.p1.id },
    seq: 0,
    records: {},
  };
  const ack: ServerFrame = {
    type: "ack",
    intentId: "i1",
    result: { records: { "scene-probe": [row] } },
  };
  expect(leakScan(s, { store, frames: [] })).toEqual([]);
  expect(leakScan(s, { store, frames: [ack] })).toEqual([
    `ack i1: scene-probe/${hidden.id}: hidden from this viewer`,
  ]);
});
