import { afterEach, describe, expect, test } from "bun:test";
import { recordsOf } from "@shared/protocol/store";
import { z } from "zod";
import { startTestServer, TEST_SECRET, type TestServer } from "../testing/harness";
import { seedSyncProbe } from "../testing/seed";
import { createTestServices } from "../testing/services";
import { defineRecordType, RecordRegistry, type Viewer } from "./records";
import { convergence, leakScan, windowIdsFor } from "./testing/convergence";
import { LOG_PROBE_WINDOW, type LogProbeRecord, registerLogProbe } from "./testing/log-probe";

describe("ADR-0029 registry", () => {
  type R = { id: string; campaignId: string; n: number; hidden: boolean; pinned: boolean };
  const row = (n: number, o: Partial<R> = {}): R => ({
    id: `e${n}`,
    campaignId: "c1",
    n,
    hidden: false,
    pinned: false,
    ...o,
  });
  const base = {
    type: "log",
    scope: "campaign" as const,
    schema: z.any(),
    idOf: (r: R) => r.id,
    campaignOf: (r: R) => r.campaignId,
    visibility: (r: R) => (r.hidden ? ("hidden" as const) : ("full" as const)),
  };
  const player: Viewer = { connId: "p", campaignId: "c1", role: "player", playerId: "p1" };
  const dm: Viewer = { connId: "d", campaignId: "c1", role: "dm", playerId: null };
  const src = { db: undefined as never, presence: { list: () => [] } };

  test("CON-38 registration: window size must be an integer ≥ 1", () => {
    const r = new RecordRegistry();
    for (const size of [0, -1, 1.5]) {
      expect(() =>
        r.register(
          defineRecordType<R>({ ...base, snapshot: () => [], window: { orderBy: "n", size } }),
        ),
      ).toThrow(/window size/);
    }
  });

  test("ADR-0029 snapshot = pinned + newest size, cut BEFORE the filter: same floor for DM and player; player may get fewer", () => {
    const r = new RecordRegistry();
    const log = [
      row(1, { pinned: true }),
      row(2),
      row(3),
      row(4, { hidden: true }),
      row(5),
      row(6, { hidden: true }),
    ];
    r.register(
      defineRecordType<R>({
        ...base,
        snapshot: () => log,
        window: { orderBy: "n", size: 3, pin: (x) => x.pinned },
      }),
    );
    expect((r.snapshot(src, dm).log as R[]).map((x) => x.n)).toEqual([1, 4, 5, 6]);
    // Not "newest 3 visible" (2, 3, 5): the cut runs first, then the filter.
    expect((r.snapshot(src, player).log as R[]).map((x) => x.n)).toEqual([1, 5]);
    expect(r.windowCuts(src, dm)).toEqual({ log: { ids: ["e1", "e4", "e5", "e6"], floor: 4 } });
    expect(r.windowCuts(src, player)).toEqual(r.windowCuts(src, dm));
  });

  test("ADR-0029 unwindowed types are untouched; audience dm types are not cut for players", () => {
    const r = new RecordRegistry();
    r.register(defineRecordType<R>({ ...base, snapshot: () => [row(1), row(2), row(3)] }));
    r.register(
      defineRecordType<R>({
        ...base,
        type: "dm-log",
        audience: "dm",
        snapshot: () => [row(1), row(2)],
        window: { orderBy: "n", size: 1 },
      }),
    );
    expect(r.snapshot(src, player).log).toHaveLength(3);
    expect(r.snapshot(src, player)["dm-log"]).toBeUndefined();
    expect(r.windowCuts(src, player)).toEqual({});
    expect(r.windowCuts(src, dm)).toEqual({ "dm-log": { ids: ["e2"], floor: 2 } });
  });

  test("log probe exists only in test mode", () => {
    expect(() => registerLogProbe(createTestServices({ testMode: false }))).toThrow(/test mode/);
  });
});

describe("ADR-0029 over real sockets", () => {
  let h: TestServer;
  afterEach(async () => {
    await h?.stop();
  });

  async function setup() {
    h = await startTestServer();
    const seed = seedSyncProbe(h.s);
    const fx = registerLogProbe(h.s);
    const dmActor = { role: "dm" as const, playerId: null, campaignId: seed.campaignId };
    const put = (text: string, o: { id?: string; hidden?: boolean; pinned?: boolean } = {}) =>
      h.s.commands.run(
        fx.set,
        { id: o.id, text, hidden: o.hidden ?? false, pinned: o.pinned ?? false },
        { actor: dmActor },
      ) as { id: string };
    return { seed, fx, put };
  }

  const texts = (c: { store: Parameters<typeof recordsOf>[0] }) =>
    recordsOf<LogProbeRecord>(c.store, "log-probe")
      .sort((a, b) => a.n - b.n)
      .map((r) => r.text);

  test("CON-39 FR-SYNC-20 convergence: a live store holds more than the window; compared from the floor up plus pinned", async () => {
    const { seed, put } = await setup();
    const pending = put("PINNED", { pinned: true });
    const old = put("old");
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    const dm = await h.live({ role: "dm", secret: TEST_SECRET });
    for (let i = 1; i <= 5; i++) put(`e${i}`, { hidden: i === 4 });
    for (let i = 0; i < 4; i++) await p1.next("event"); // e4 hidden: no frame
    expect(texts(p1)).toEqual(["PINNED", "old", "e1", "e2", "e3", "e5"]);

    const fresh = await h.live({ role: "player", token: seed.p1.linkToken });
    // Window 3 = e3, e4, e5 (+ pinned); e4 hidden → fresh player gets fewer than 3.
    expect(texts(fresh)).toEqual(["PINNED", "e3", "e5"]);
    expect(p1.store.records).not.toEqual(fresh.store.records);
    const c = convergence(h.s, p1, fresh);
    expect(c.live).toEqual(c.fresh);
    const freshDm = await h.live({ role: "dm", secret: TEST_SECRET });
    const cd = convergence(h.s, dm, freshDm);
    expect(cd.live).toEqual(cd.fresh);
    expect(texts(freshDm)).toHaveLength(LOG_PROBE_WINDOW + 1);

    // A change below the floor is still delivered live; a fresh snapshot omits it.
    put("old edited", { id: old.id });
    expect((await p1.next("event")).changes[0]).toMatchObject({
      op: "upsert",
      data: { text: "old edited" },
    });
    // Unpinning drops a row out of the window; it stays in the live store, still converged.
    put("PINNED done", { id: pending.id, pinned: false });
    await p1.next("event");
    const fresh2 = await h.live({ role: "player", token: seed.p1.linkToken });
    expect(texts(fresh2)).toEqual(["e3", "e5"]);
    const c2 = convergence(h.s, p1, fresh2);
    expect(c2.live).toEqual(c2.fresh);
    for (const cl of [p1, dm, fresh, fresh2]) expect(leakScan(h.s, cl)).toEqual([]);
  });

  test("CON-39 leak scan honours the window: hiding a row below the floor deletes it live; planted leaks are caught", async () => {
    const { seed, put } = await setup();
    const old = put("SECRET-LATER");
    const p1 = await h.live({ role: "player", token: seed.p1.linkToken });
    for (let i = 1; i <= 4; i++) put(`e${i}`);
    for (let i = 0; i < 4; i++) await p1.next("event");
    const v = { connId: "x", campaignId: seed.campaignId, role: "player" as const, playerId: null };
    expect(windowIdsFor(h.s, v)["log-probe"]).not.toContain(old.id);

    put("SECRET-LATER", { id: old.id, hidden: true });
    expect((await p1.next("event")).changes).toEqual([
      { type: "log-probe", id: old.id, op: "delete" },
    ]);
    expect(leakScan(h.s, p1)).toEqual([]);

    // Plant a hidden row and a tampered row in the store: both reported.
    const store = p1.store.records["log-probe"] as Record<string, unknown>;
    store[old.id] = { id: old.id, text: "x" };
    const firstVisible = recordsOf<LogProbeRecord>(p1.store, "log-probe")[0] as LogProbeRecord;
    store[firstVisible.id] = { ...firstVisible, text: "tampered" };
    expect(leakScan(h.s, p1).sort()).toEqual(
      [
        `log-probe/${old.id}: hidden from this viewer`,
        `log-probe/${firstVisible.id}: differs from the filtered record`,
      ].sort(),
    );
  });
});
