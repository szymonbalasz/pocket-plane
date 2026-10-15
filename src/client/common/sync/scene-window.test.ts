// ADR-0041 DM client: loaded-scene set, `sync.loadScene` merge in frame order, one load in
// flight per scene, reject → unloaded, snapshot (reconnect / resync) resets the set.
import { expect, test } from "bun:test";
import { SYNC_LOAD_SCENE } from "@shared/protocol/scene-window";
import { type Clock, IntentRejected, SyncConnection } from "./connection";

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

function setup(role: "dm" | "player" = "dm") {
  const sockets: FakeSocket[] = [];
  const conn = new SyncConnection({
    credential: role === "dm" ? { role, secret: "s" } : { role, token: "t" },
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
  const snapshot = (active: string, tokens: { id: string; sceneId: string }[]) =>
    frame({
      type: "snapshot",
      seq: 0,
      you: { campaignId: "c", role, playerId: role === "dm" ? null : "p" },
      records: {
        scene: [
          { id: "A", active: active === "A" },
          { id: "B", active: active === "B" },
        ],
        token: tokens,
      },
    });
  const loads = () =>
    ws()
      .sent.map(
        (t) =>
          JSON.parse(t) as { type: string; name?: string; intentId?: string; payload?: unknown },
      )
      .filter((f) => f.type === "intent" && f.name === SYNC_LOAD_SCENE);
  return { conn, ws, frame, snapshot, loads };
}

const tokenIds = (c: SyncConnection) => Object.keys(c.snapshot.store.records.token ?? {}).sort();

test("ADR-0041 after a snapshot the DM's loaded set is just the active scene", () => {
  const { conn, snapshot } = setup();
  snapshot("A", [{ id: "a1", sceneId: "A" }]);
  expect(conn.snapshot.scenes).toEqual({ loaded: ["A"], loading: [] });
});

test("ADR-0041 load: one in flight per scene; ack merges in frame order; event before the ack kept", async () => {
  const { conn, snapshot, frame, loads } = setup();
  snapshot("A", [{ id: "a1", sceneId: "A" }]);
  const p = conn.loadScene("B");
  expect(p).not.toBeNull();
  expect(conn.loadScene("B")).toBeNull();
  expect(conn.loadScene("A")).toBeNull();
  expect(loads()).toHaveLength(1);
  expect(loads()[0]?.payload).toEqual({ sceneId: "B" });
  expect(conn.snapshot.scenes).toEqual({ loaded: ["A"], loading: ["B"] });
  // An event for scene B committed before the read: it is in the store and in the result.
  frame({
    type: "event",
    seq: 1,
    cause: { name: "TokenPlaced" },
    changes: [{ type: "token", id: "b2", op: "upsert", data: { id: "b2", sceneId: "B" } }],
  });
  expect(conn.snapshot.scenes.loaded).not.toContain("B");
  frame({
    type: "ack",
    intentId: loads()[0]?.intentId,
    result: {
      records: {
        token: [
          { id: "b1", sceneId: "B" },
          { id: "b2", sceneId: "B" },
        ],
      },
    },
  });
  // Merged synchronously, before any later frame.
  expect(tokenIds(conn)).toEqual(["a1", "b1", "b2"]);
  expect(conn.snapshot.store.seq).toBe(1);
  expect(conn.snapshot.scenes).toEqual({ loaded: ["A", "B"], loading: [] });
  await p;
  expect(conn.loadScene("B")).toBeNull();
});

test("ADR-0041 reject → unloaded, not loading; the next view retries", async () => {
  const { conn, snapshot, frame, loads } = setup();
  snapshot("A", []);
  const p = conn.loadScene("B");
  frame({
    type: "reject",
    intentId: loads()[0]?.intentId,
    code: "not_found",
    message: "Scene not found",
  });
  await expect(p).rejects.toBeInstanceOf(IntentRejected);
  expect(conn.snapshot.scenes).toEqual({ loaded: ["A"], loading: [] });
  expect(conn.loadScene("B")).not.toBeNull();
  expect(loads()).toHaveLength(2);
});

test("ADR-0041 reconnect / resync: the snapshot resets the set; a stale ack is dropped", async () => {
  const { conn, snapshot, frame, loads } = setup();
  snapshot("A", [{ id: "a1", sceneId: "A" }]);
  const p = conn.loadScene("B");
  const stale = loads()[0]?.intentId;
  // A resync snapshot arrives first (the activation moved the window to B).
  snapshot("B", [{ id: "b1", sceneId: "B" }]);
  expect(conn.snapshot.scenes).toEqual({ loaded: ["B"], loading: [] });
  frame({
    type: "ack",
    intentId: stale,
    result: { records: { token: [{ id: "x", sceneId: "A" }] } },
  });
  await p;
  expect(tokenIds(conn)).toEqual(["b1"]);
  expect(conn.snapshot.scenes).toEqual({ loaded: ["B"], loading: [] });
  // A disconnect rejects the in-flight load and clears `loading`.
  const q = conn.loadScene("A");
  expect(conn.snapshot.scenes.loading).toEqual(["A"]);
  conn.drop();
  await expect(q).rejects.toBeInstanceOf(IntentRejected);
  expect(conn.snapshot.scenes.loading).toEqual([]);
  expect(conn.loadScene("A")).toBeNull(); // not live
});

test("ADR-0041 players never load (the scene gate gives them their scene)", () => {
  const { conn, snapshot, loads } = setup("player");
  snapshot("A", []);
  expect(conn.loadScene("B")).toBeNull();
  expect(loads()).toHaveLength(0);
});
