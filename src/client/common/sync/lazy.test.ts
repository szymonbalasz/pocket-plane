// ADR-0045 client: loaded set, `sync.load` chunks of 50, replace on load, reject → error + retry,
// snapshot purge (FR-SYNC-34–37). Pure status helpers back `useLazyRecords`.
import { expect, test } from "bun:test";
import {
  applyLoad,
  emptyLoaded,
  idsToRequest,
  isLoaded,
  lazyAfterSnapshot,
  lazyStatus,
  markLoaded,
  SYNC_LOAD,
  unmark,
  wholeToRequest,
} from "@shared/protocol/lazy";
import { type Clock, SyncConnection } from "./connection";

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.onclose?.({ code });
  }
}

const clock: Clock = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
};

type Load = { intentId: string; payload: { type: string; ids?: string[] } };

function setup() {
  const sockets: FakeSocket[] = [];
  const conn = new SyncConnection({
    credential: { role: "player", token: "t" },
    url: "ws://x/ws",
    clock,
    probe: () => true,
    onChange() {},
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
    onWake: () => () => {},
  });
  conn.start();
  const ws = () => sockets.at(-1) as FakeSocket;
  const frame = (f: unknown) => ws().onmessage?.({ data: JSON.stringify(f) });
  const snapshot = () =>
    frame({
      type: "snapshot",
      seq: 0,
      you: { campaignId: "c", role: "player", playerId: "p" },
      records: { probe: [{ id: "x" }] },
    });
  let seq = 0;
  const upsert = (type: string, id: string, data: object = {}) =>
    frame({
      type: "event",
      seq: ++seq,
      cause: { name: "Changed" },
      changes: [{ type, id, op: "upsert", data: { id, ...data } }],
    });
  const loads = (): Load[] =>
    ws()
      .sent.map((t) => JSON.parse(t) as Load & { type: string; name?: string })
      .filter((f) => f.type === "intent" && f.name === SYNC_LOAD);
  const ack = (l: Load, rows: object[]) =>
    frame({ type: "ack", intentId: l.intentId, result: { records: { [l.payload.type]: rows } } });
  const reject = (l: Load) =>
    frame({ type: "reject", intentId: l.intentId, code: "invalid", message: "no" });
  const ids = (type: string) => Object.keys(conn.snapshot.store.records[type] ?? {}).sort();
  return {
    conn,
    ws,
    snapshot,
    upsert,
    loads,
    ack,
    reject,
    ids,
    resetSeq: () => {
      seq = 0;
    },
  };
}

const range = (n: number, p = "h") => Array.from({ length: n }, (_, i) => `${p}${i}`);

test("FR-SYNC-35 useLazyRecords: chunks of 50, no reload of loaded ids, whole-type covers ids, reject → error + retry", async () => {
  const { conn, snapshot, loads, ack, reject } = setup();
  expect(conn.load("t", ["a"])).toBeNull(); // not live yet
  snapshot();
  const st = () => conn.snapshot.lazy;

  // 120 ids → 3 chunks (50, 50, 20); the same ids again while in flight → nothing sent.
  const want = range(120);
  const p = conn.load("t", [...want, "h0"]);
  expect(p).not.toBeNull();
  expect(loads().map((l) => l.payload.ids?.length)).toEqual([50, 50, 20]);
  expect(conn.load("t", want)).toBeNull();
  expect(lazyStatus(st(), "t", want)).toBe("loading");
  const [c1, c2, c3] = loads() as [Load, Load, Load];
  ack(
    c1,
    (c1.payload.ids ?? []).map((id) => ({ id })),
  );
  ack(
    c2,
    (c2.payload.ids ?? []).map((id) => ({ id })),
  );
  // A reject: that chunk is failed, nothing of it loaded; status error; no auto reload.
  reject(c3);
  await expect(p as Promise<void>).rejects.toThrow("no");
  expect(lazyStatus(st(), "t", want)).toBe("error");
  expect(lazyStatus(st(), "t", range(100))).toBe("ready");
  expect(conn.isLoaded("t", "h99")).toBe(true);
  expect(conn.isLoaded("t", "h100")).toBe(false);
  expect(idsToRequest(st(), "t", want)).toEqual([]);
  expect(conn.load("t", want)).toBeNull();
  // Loaded ids are never requested again; new ones are.
  conn.load("t", ["h5", "new"]);
  expect(loads().at(-1)?.payload).toEqual({ type: "t", ids: ["new"] });
  // Retry re-sends only the failed chunk.
  const r = conn.retryLoad("t", want);
  const retried = loads().at(-1) as Load;
  expect(retried.payload.ids).toEqual(range(20).map((_, i) => `h${100 + i}`));
  ack(retried, []);
  await r;
  expect(lazyStatus(st(), "t", want)).toBe("ready");

  // Whole-type load: one in flight; once loaded it covers every id (id load is a no-op).
  expect(conn.load("w")).not.toBeNull();
  expect(conn.load("w")).toBeNull();
  expect(conn.load("w", ["a"])).toBeNull(); // in flight whole-type covers ids
  expect(lazyStatus(st(), "w", ["a"])).toBe("loading");
  ack(loads().at(-1) as Load, [{ id: "a" }]);
  expect(lazyStatus(st(), "w")).toBe("ready");
  expect(conn.load("w", ["zzz"])).toBeNull();
  expect(conn.isLoaded("w", "zzz")).toBe(true);
  // A whole-type reject → error; retry → reload.
  conn.load("v")?.catch(() => {});
  reject(loads().at(-1) as Load);
  await Bun.sleep(0);
  expect(lazyStatus(st(), "v")).toBe("error");
  expect(lazyStatus(st(), "v", ["a"])).toBe("error");
  expect(conn.load("v")).toBeNull();
  conn.retryLoad("v");
  expect(loads().at(-1)?.payload).toEqual({ type: "v" });
  expect(lazyStatus(st(), "v")).toBe("loading");
});

test("FR-SYNC-34 events for unloaded lazy rows delivered, loaded set unchanged (client)", () => {
  const { conn, snapshot, upsert, ids } = setup();
  snapshot();
  upsert("t", "e1");
  expect(ids("t")).toEqual(["e1"]);
  expect(conn.isLoaded("t", "e1")).toBe(false);
  expect(conn.snapshot.lazy.loaded).toEqual(emptyLoaded());
});

test("FR-SYNC-36 load replaces: stale rows of the type / requested ids removed", () => {
  const { conn, snapshot, upsert, loads, ack, ids } = setup();
  snapshot();
  upsert("t", "stale");
  upsert("t", "keep");
  upsert("u", "gone");
  upsert("u", "other");
  conn.load("t");
  ack(loads().at(-1) as Load, [{ id: "keep", v: 2 }, { id: "fresh" }]);
  expect(ids("t")).toEqual(["fresh", "keep"]);
  expect(conn.snapshot.store.records.t?.keep).toEqual({ id: "keep", v: 2 });
  // Id load: a requested id absent from the result leaves the store; others untouched.
  conn.load("u", ["gone", "new"]);
  ack(loads().at(-1) as Load, [{ id: "new" }]);
  expect(ids("u")).toEqual(["new", "other"]);
  expect(conn.isLoaded("u", "gone")).toBe(true);
  expect(conn.isLoaded("u", "other")).toBe(false);
});

test("FR-SYNC-37 snapshot purges lazy rows and loaded sets; stale row not readable after reconnect", () => {
  const { conn, ws, snapshot, loads, ack, ids, resetSeq } = setup();
  snapshot();
  const gen = conn.snapshot.lazy.generation;
  conn.load("t");
  ack(loads().at(-1) as Load, [{ id: "shared" }]);
  conn.load("u", ["a"])?.catch(() => {});
  const inFlight = loads().at(-1) as Load;
  expect(ids("t")).toEqual(["shared"]);
  // Reconnect: a new snapshot (without lazy types) drops every lazy row and resets the sets.
  ws().close(1006);
  expect(conn.snapshot.lazy.loading).toEqual(emptyLoaded()); // disconnect: not failed
  expect(conn.snapshot.lazy.failed).toEqual(emptyLoaded());
  resetSeq();
  conn.retryNow();
  expect(ws().sent).toEqual([]); // a new socket
  snapshot();
  expect(conn.snapshot.store.records.t).toBeUndefined();
  expect(conn.snapshot.lazy).toEqual(lazyAfterSnapshot(gen + 1));
  expect(conn.isLoaded("t", "shared")).toBe(false);
  // The disconnect settled the old load; a late answer changes nothing.
  ack(inFlight, [{ id: "a" }]);
  expect(ids("u")).toEqual([]);
  // A resync snapshot purges the same way; an answer for the older generation is dropped.
  conn.load("t");
  ack(loads().at(-1) as Load, [{ id: "x" }]);
  conn.load("u", ["b"]);
  const late = loads().at(-1) as Load;
  snapshot();
  expect(ids("t")).toEqual([]);
  expect(conn.snapshot.lazy.generation).toBe(gen + 2);
  ack(late, [{ id: "b" }]);
  expect(ids("u")).toEqual([]);
  expect(conn.isLoaded("u", "b")).toBe(false);
  expect(conn.snapshot.lazy.loading).toEqual(emptyLoaded());
});

test("ADR-0045 loaded-set helpers", () => {
  let s = markLoaded(emptyLoaded(), "t", ["a", "b"]);
  s = markLoaded(s, "t", ["b", "c"]);
  expect(s.ids.t).toEqual(["a", "b", "c"]);
  expect(isLoaded(s, "t", "c")).toBe(true);
  expect(isLoaded(s, "t")).toBe(false);
  expect(unmark(s, "t", ["a", "b", "c"])).toEqual(emptyLoaded());
  const w = markLoaded(emptyLoaded(), "w");
  expect(isLoaded(w, "w", "any")).toBe(true);
  expect(unmark(w, "w")).toEqual(emptyLoaded());
  const st = { ...lazyAfterSnapshot(1), loading: markLoaded(emptyLoaded(), "w") };
  expect(wholeToRequest(st, "w")).toBe(false);
  expect(wholeToRequest(st, "t")).toBe(true);
  expect(idsToRequest(st, "w", ["a"])).toEqual([]);
  expect(idsToRequest(st, "t", ["a", "a", "b"])).toEqual(["a", "b"]);
  const store = { you: null, seq: 0, records: { t: { a: { id: "a" }, b: { id: "b" } } } };
  expect(applyLoad(store, "t", ["a"], { t: [], other: [{ id: "z" }] }).records).toEqual({
    t: { b: { id: "b" } },
  });
});
