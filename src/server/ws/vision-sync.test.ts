// ADR-0042 ws changes (V0, FOG §14 shared changes): the identical-upsert drop per change
// (FR-SYNC-19 amended, OQ-FOG-37; an event left empty still goes out), `dmRedact` (server-only
// copies never on the DM wire), player-list signal audiences (FR-SYNC-28 amended), the
// `view-as` window + `sync.loadScene {viewAs}` (FR-FOG-43), derived types, convergence on the
// loaded pair.
import { afterEach, describe, expect, test } from "bun:test";
import { defineEvent } from "@shared/events";
import { type EventFrame, ServerFrame } from "@shared/protocol/frames";
import { SyncConnection } from "@ui/sync/connection";
import { z } from "zod";
import { defineCommand } from "../commands/commands";
import { startTestServer, TEST_SECRET, type TestClient, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { defineRecordType, RecordRegistry, type Viewer } from "./records";
import { defineSignal, reaches, validAudience } from "./signals";
import { convergence, leakScan } from "./testing/convergence";
import { registerSceneProbe } from "./testing/scene-probe";

type R = {
  id: string;
  campaignId: string;
  sceneId: string;
  playerId: string;
  text: string;
  secret?: string;
};
const dm: Viewer = { connId: "d", campaignId: "c1", role: "dm", playerId: null };
const p1: Viewer = { connId: "p", campaignId: "c1", role: "player", playerId: "p1" };
const src = { db: undefined as never, presence: { list: () => [] } };

const rowsOf: R[] = [
  { id: "A:p1", campaignId: "c1", sceneId: "A", playerId: "p1", text: "a1" },
  { id: "A:p2", campaignId: "c1", sceneId: "A", playerId: "p2", text: "a2" },
  { id: "B:p1", campaignId: "c1", sceneId: "B", playerId: "p1", text: "b1" },
  { id: "B:x", campaignId: "c2", sceneId: "B", playerId: "p1", text: "other campaign" },
];
const perPlayer = {
  type: "per-player",
  scope: "scene" as const,
  schema: z.any(),
  idOf: (r: R) => r.id,
  campaignOf: (r: R) => r.campaignId,
  sceneOf: (r: R) => r.sceneId,
  visibility: (r: R, v: Viewer) =>
    r.playerId === v.playerId ? ("full" as const) : ("hidden" as const),
  dmRedact: ({ secret: _s, ...r }: R) => r,
  snapshot: () => rowsOf,
};

describe("FR-SYNC-19 identical-upsert drop (ADR-0042, OQ-FOG-37)", () => {
  const reg = () => {
    const r = new RecordRegistry();
    r.register(defineRecordType<R>({ ...perPlayer, scope: "campaign", sceneOf: undefined }));
    return r;
  };
  const base: R = { id: "x", campaignId: "c1", sceneId: "A", playerId: "p1", text: "t" };

  test("FR-SYNC-19 visible → visible with identical wire data → dropped (per connection); else upsert", () => {
    const r = reg();
    const same = { type: "per-player", id: "x", before: base, after: { ...base } };
    expect(r.classifyChange(same, p1)).toBe("same");
    expect(r.filterChange(same, p1)).toBeNull();
    // A server-only field that `dmRedact` strips: identical on the DM wire too.
    const secretOnly = { ...same, after: { ...base, secret: "s2" } };
    expect(r.classifyChange(secretOnly, dm)).toBe("same");
    // …but not for the player, whose wire (`full`) carries it.
    expect(r.classifyChange(secretOnly, p1)).toMatchObject({ op: "upsert" });
    const changed = { ...same, after: { ...base, text: "u" } };
    expect(r.filterChange(changed, p1)).toEqual({
      type: "per-player",
      id: "x",
      op: "upsert",
      data: { ...base, text: "u" },
    });
  });

  test("FR-SYNC-19 transitions unchanged: hidden → visible upsert, visible → hidden delete, hidden → hidden nothing", () => {
    const r = reg();
    const other = { ...base, playerId: "p2" };
    expect(
      r.classifyChange({ type: "per-player", id: "x", before: other, after: base }, p1),
    ).toMatchObject({ op: "upsert" });
    expect(
      r.classifyChange({ type: "per-player", id: "x", before: base, after: other }, p1),
    ).toEqual({ type: "per-player", id: "x", op: "delete" });
    expect(
      r.classifyChange({ type: "per-player", id: "x", before: other, after: other }, p1),
    ).toBeNull();
  });

  test("FR-SYNC-19 filterChanges: an event of only identical upserts is still touched (goes out empty)", () => {
    const r = reg();
    const same = { type: "per-player", id: "x", before: base, after: { ...base } };
    const hiddenOnly = {
      ...same,
      before: { ...base, playerId: "p2" },
      after: { ...base, playerId: "p2" },
    };
    expect(r.filterChanges([same], p1)).toEqual({ changes: [], touched: true });
    expect(r.filterChanges([hiddenOnly], p1)).toEqual({ changes: [], touched: false });
  });
});

describe("FR-FOG-43 view-as window (registry)", () => {
  const reg = () => {
    const r = new RecordRegistry();
    r.register(defineRecordType<R>({ ...perPlayer, dmWindow: "view-as" }));
    r.provideActiveScene(() => "A");
    return r;
  };

  test("FR-FOG-43 registration: view-as and active-scene accepted, scope scene only", () => {
    const r = new RecordRegistry();
    expect(() =>
      r.register(
        defineRecordType<R>({
          ...perPlayer,
          scope: "campaign",
          sceneOf: undefined,
          dmWindow: "view-as",
        }),
      ),
    ).toThrow(/scope scene/);
    expect(() => r.register(defineRecordType<R>({ ...perPlayer, dmWindow: "x" as never }))).toThrow(
      /dmWindow/,
    );
    r.register(defineRecordType<R>({ ...perPlayer, dmWindow: "view-as" }));
    expect(r.viewAsTypes().map((d) => d.type)).toEqual(["per-player"]);
    expect(r.dmWindowed()).toEqual([]);
  });

  test("FR-FOG-43 DM snapshot holds no view-as rows; a player gets their own on the active scene", () => {
    const r = reg();
    expect(r.snapshot(src, dm)["per-player"]).toEqual([]);
    expect((r.snapshot(src, p1)["per-player"] as R[]).map((x) => x.id)).toEqual(["A:p1"]);
  });

  test("FR-FOG-43 loadViewAs: that player's rows of that scene only, any scene, DM wire", () => {
    const r = reg();
    expect(r.loadViewAs(src, dm, "B", "p1")).toEqual({
      "per-player": [{ id: "B:p1", campaignId: "c1", sceneId: "B", playerId: "p1", text: "b1" }],
    });
    expect((r.loadViewAs(src, dm, "A", "p2")["per-player"] as R[]).map((x) => x.id)).toEqual([
      "A:p2",
    ]);
    // Plain scene loads never carry view-as types.
    expect(r.loadScene(src, dm, "A")).toEqual({});
  });
});

describe("FR-SYNC-28 audience player lists (ADR-0042)", () => {
  test("FR-SYNC-28 validAudience / reaches", () => {
    expect([validAudience("all"), validAudience("dm"), validAudience({ players: ["p1"] })]).toEqual(
      [true, true, true],
    );
    expect([validAudience("x"), validAudience({ players: [1] }), validAudience(null)]).toEqual([
      false,
      false,
      false,
    ]);
    const a = { players: ["p1"] };
    expect(reaches(a, { role: "dm", playerId: null })).toBe(true);
    expect(reaches(a, { role: "player", playerId: "p1" })).toBe(true);
    expect(reaches(a, { role: "player", playerId: "p2" })).toBe(false);
    expect(reaches("dm", { role: "player", playerId: "p1" })).toBe(false);
  });
});

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

const ProbeTouched = defineEvent({
  type: "ProbeTouched",
  payload: z.object({ id: z.string() }),
  logged: false,
  undoable: false,
});

async function setup() {
  h = await startTestServer();
  const seed = seedSyncProbe(h.s);
  const fx = registerSceneProbe(h.s, { dmWindow: true });
  fx.activeCache.set(seed.campaignId, "scene-a");
  for (const id of ["scene-a", "scene-b"]) fx.scenes.set(id, seed.campaignId);
  const rows = new Map<string, R>();
  const put = (r: R) => rows.set(r.id, r);
  put({
    id: "A:p1",
    campaignId: seed.campaignId,
    sceneId: "scene-a",
    playerId: seed.p1.id,
    text: "a1",
  });
  put({
    id: "A:p2",
    campaignId: seed.campaignId,
    sceneId: "scene-a",
    playerId: seed.p2.id,
    text: "a2",
  });
  put({
    id: "B:p1",
    campaignId: seed.campaignId,
    sceneId: "scene-b",
    playerId: seed.p1.id,
    text: "b1",
  });
  h.s.records.register(
    defineRecordType<R>({
      ...perPlayer,
      type: "view-probe",
      derived: true,
      dmWindow: "view-as",
      snapshot: (_s, v, scope) =>
        [...rows.values()].filter(
          (r) => r.campaignId === v.campaignId && (!scope || r.sceneId === scope.sceneId),
        ),
    }),
  );
  h.s.records.providePlayerCampaign(
    (pid) =>
      ({
        [seed.p1.id]: seed.campaignId,
        [seed.p2.id]: seed.campaignId,
        [seed.p3.id]: seed.secondCampaignId,
      })[pid] ?? null,
    { replace: true },
  );
  // A command that re-emits a row unchanged (identical upsert for everyone who sees it).
  h.s.commands.registerEvent(ProbeTouched);
  const touch = defineCommand({
    name: "viewprobe.touch",
    input: z.object({ id: z.string(), text: z.string().optional() }),
    execute({ id, text }, { emit }) {
      const before = rows.get(id) as R;
      const after = { ...before, ...(text !== undefined ? { text } : {}) };
      rows.set(id, after);
      emit({
        type: ProbeTouched.type,
        campaignId: before.campaignId,
        payload: { id },
        changes: [{ type: "view-probe", id, before, after }],
      });
    },
  });
  h.s.commands.register(touch as never);
  h.s.intents.add(touch.name);
  return { seed, rows, put };
}

async function until(c: TestClient, id: string): Promise<ServerFrame[]> {
  const seen: ServerFrame[] = [];
  for (;;) {
    const f = await c.next(undefined, 2000);
    seen.push(f);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return seen;
  }
}

describe("ADR-0042 over real sockets", () => {
  test("FR-SYNC-19 an event whose only change is an identical upsert still arrives, empty, keeping seq", async () => {
    const { seed } = await setup();
    const dmc = await h.live({ role: "dm", secret: TEST_SECRET });
    const pc1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const pc2 = await h.live({ role: "player", token: seed.p2.linkToken });
    const probeEvent = async (c: TestClient) => {
      for (;;) {
        const f = await c.next("event");
        if (f.cause.name === "ProbeTouched") return f;
      }
    };
    dmc.intent("viewprobe.touch", { id: "A:p1" });
    const e1 = await probeEvent(pc1);
    expect(e1).toMatchObject({ cause: { name: "ProbeTouched" }, changes: [] });
    const d1 = await probeEvent(dmc);
    expect(d1.changes).toEqual([]);
    // P2 never saw the row: hidden → hidden → no frame at all (FR-SYNC-17).
    await Bun.sleep(100);
    expect(pc2.frames.some((f) => f.type === "event" && f.cause.name === "ProbeTouched")).toBe(
      false,
    );
    dmc.intent("viewprobe.touch", { id: "A:p1", text: "changed" });
    const e2 = await probeEvent(pc1);
    expect(e2.seq).toBe(e1.seq + 1);
    expect(e2.changes).toEqual([
      expect.objectContaining({ op: "upsert", data: expect.objectContaining({ text: "changed" }) }),
    ]);
    expect(pc1.gap).toBe(false);
  });

  test("FR-SYNC-19 / FR-SYNC-21 the sync client applies an empty event: seq advances, no store change, no resync", async () => {
    const { seed } = await setup();
    const dmc = await h.live({ role: "dm", secret: TEST_SECRET });
    // The real client over a real socket: frames go through the `ServerFrame` schema.
    const sent: string[] = [];
    const received: ServerFrame[] = [];
    const conn = new SyncConnection({
      credential: { role: "player", token: seed.p1.linkToken },
      url: h.url,
      probe: () => true,
      onWake: () => () => {},
      onChange() {},
      createSocket: (url) => {
        const ws = new WebSocket(url);
        const send = ws.send.bind(ws);
        ws.send = (d) => {
          sent.push(String(d));
          send(d);
        };
        ws.addEventListener("message", (e) => received.push(JSON.parse(String(e.data))));
        return ws;
      },
    });
    const waitFor = async (ok: () => boolean) => {
      const end = performance.now() + 2000;
      while (!ok()) {
        if (performance.now() > end) throw new Error("timed out");
        await Bun.sleep(5);
      }
    };
    const probeEvent = async (n: number): Promise<EventFrame> => {
      const of = () =>
        received.filter(
          (f): f is EventFrame => f.type === "event" && f.cause.name === "ProbeTouched",
        );
      await waitFor(() => of().length >= n);
      const f = of()[n - 1] as EventFrame;
      await waitFor(() => conn.snapshot.store.seq >= f.seq);
      return f;
    };
    try {
      conn.start();
      await waitFor(() => conn.snapshot.state === "live");
      dmc.intent("viewprobe.touch", { id: "A:p1" });
      const before = conn.snapshot.store.records;
      const e1 = await probeEvent(1);
      expect(ServerFrame.parse(e1)).toMatchObject({ changes: [] });
      expect(conn.snapshot.store.seq).toBe(e1.seq);
      expect(conn.snapshot.store.records).toBe(before);
      dmc.intent("viewprobe.touch", { id: "A:p1", text: "changed" });
      const e2 = await probeEvent(2);
      expect(e2.seq).toBe(e1.seq + 1);
      expect(conn.snapshot.store.seq).toBe(e2.seq);
      expect(conn.snapshot.store.records["view-probe"]?.["A:p1"]).toMatchObject({
        text: "changed",
      });
      expect(sent.some((d) => JSON.parse(d).type === "resync")).toBe(false);
      expect(received.filter((f) => f.type === "snapshot")).toHaveLength(1);
    } finally {
      conn.stop();
    }
  });

  test("FR-FOG-43 DM snapshot has no view-as rows; loadViewAs returns that player's rows only; not_found across campaigns", async () => {
    const { seed } = await setup();
    const dmc = await h.live({ role: "dm", secret: TEST_SECRET });
    expect(dmc.store.records["view-probe"]).toEqual({});
    const pc1 = await h.live({ role: "player", token: seed.p1.linkToken });
    expect(Object.keys(pc1.store.records["view-probe"] ?? {})).toEqual(["A:p1"]);
    const ack = (await until(dmc, dmc.loadViewAs("scene-b", seed.p1.id))).at(-1);
    expect(ack).toMatchObject({ type: "ack" });
    expect(Object.keys(dmc.store.records["view-probe"] ?? {})).toEqual(["B:p1"]);
    // Another pair replaces the rows.
    await until(dmc, dmc.loadViewAs("scene-a", seed.p2.id));
    expect(Object.keys(dmc.store.records["view-probe"] ?? {})).toEqual(["A:p2"]);
    expect(dmc.viewAs).toEqual({ sceneId: "scene-a", playerId: seed.p2.id });
    const code = async (c: TestClient, id: string) => {
      const f = (await until(c, id)).at(-1) as ServerFrame;
      return f.type === "reject" ? f.code : f.type;
    };
    expect(await code(dmc, dmc.loadViewAs("scene-a", seed.p3.id))).toBe("not_found");
    expect(await code(dmc, dmc.loadViewAs("scene-a", "nobody"))).toBe("not_found");
    expect(await code(pc1, pc1.loadViewAs("scene-a", seed.p1.id))).toBe("forbidden");
    expect(leakScan(h.s, dmc)).toEqual([]);
    expect(leakScan(h.s, pc1)).toEqual([]);
    expect(pc1.raw()).not.toContain('"a2"');
  });

  test("FR-FOG-43 convergence compares view-as types on the loaded pair only; live events still reach the DM", async () => {
    const { seed } = await setup();
    const dmc = await h.live({ role: "dm", secret: TEST_SECRET });
    await until(dmc, dmc.loadViewAs("scene-a", seed.p1.id));
    dmc.intent("viewprobe.touch", { id: "A:p2", text: "p2 moved" });
    const done = dmc.intent("viewprobe.touch", { id: "A:p1", text: "p1 moved" });
    await until(dmc, done);
    // The p2 row arrived live (ADR-0041 live events) but is outside the loaded pair.
    expect(Object.keys(dmc.store.records["view-probe"] ?? {}).sort()).toEqual(["A:p1", "A:p2"]);
    const fresh = await h.live({ role: "dm", secret: TEST_SECRET });
    await until(fresh, fresh.loadViewAs("scene-a", seed.p1.id));
    const c = convergence(h.s, dmc, fresh);
    expect(c.live).toEqual(c.fresh);
    expect(Object.keys(c.live["view-probe"] ?? {})).toEqual(["A:p1"]);
    // A snapshot resets the pair.
    dmc.send({ type: "resync" });
    await dmc.next("snapshot");
    expect(dmc.viewAs).toBeNull();
    expect(dmc.store.records["view-probe"]).toEqual({});
  });

  test("FR-SYNC-28 a {players} audience reaches the DM and the listed players only", async () => {
    const { seed } = await setup();
    h.s.signals.register(
      defineSignal({
        name: "test.listed",
        schema: z.object({ to: z.array(z.string()) }),
        roles: ["dm", "player"],
        audience: (d) => ({ players: d.to }),
      }),
    );
    const dm1 = await h.live({ role: "dm", secret: TEST_SECRET });
    const dm2 = await h.live({ role: "dm", secret: TEST_SECRET });
    const pc1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const pc2 = await h.live({ role: "player", token: seed.p2.linkToken });
    dm1.send({ type: "signal", name: "test.listed", data: { to: [seed.p1.id] } });
    expect(await dm2.next("signal")).toMatchObject({ name: "test.listed" });
    expect(await pc1.next("signal")).toMatchObject({ name: "test.listed" });
    await Bun.sleep(100);
    expect(pc2.frames.some((f) => f.type === "signal")).toBe(false);
  });
});
