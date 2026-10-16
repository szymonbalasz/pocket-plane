// FR-FOG-43 DM client View as: one loaded (sceneId, playerId) pair of `view-as` rows, loaded with
// `sync.loadScene {sceneId, viewAs}`; a new pair replaces the old rows; one load in flight (a
// superseded ack is dropped); reject or View as off → no pair; a snapshot resets it.
import { expect, test } from "bun:test";
import { SYNC_LOAD_SCENE } from "@shared/protocol/scene-window";
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
  const snapshot = () =>
    frame({
      type: "snapshot",
      seq: 0,
      you: { campaignId: "c", role, playerId: role === "dm" ? null : "p1" },
      records: { scene: [{ id: "A", active: true }], vision: [], "fog-explored": [] },
    });
  const loads = () =>
    ws()
      .sent.map((t) => JSON.parse(t) as { name?: string; intentId: string; payload?: unknown })
      .filter((f) => f.name === SYNC_LOAD_SCENE);
  const ack = (intentId: string, records: Record<string, unknown[]>) =>
    frame({ type: "ack", intentId, result: { records } });
  return { conn, frame, snapshot, loads, ack };
}

const vision = (sceneId: string, playerId: string) => ({
  id: `${sceneId}:${playerId}`,
  sceneId,
  playerId,
  blind: false,
  see: [],
  dark: [],
});
const visionIds = (c: SyncConnection) => Object.keys(c.snapshot.store.records.vision ?? {});

test("FR-FOG-43 loadViewAs sends sync.loadScene {sceneId, viewAs}; the ack loads the pair", async () => {
  const { conn, snapshot, loads, ack } = setup();
  snapshot();
  const p = conn.loadViewAs("A", "p1");
  expect(conn.loadViewAs("A", "p1")).toBeNull(); // already loading
  const [l] = loads();
  expect(l?.payload).toEqual({ sceneId: "A", viewAs: "p1" });
  expect(conn.snapshot.viewAs.loading).toEqual({ sceneId: "A", playerId: "p1" });
  ack(l?.intentId as string, { vision: [vision("A", "p1")], "fog-explored": [] });
  await p;
  expect(conn.snapshot.viewAs).toEqual({
    loaded: { sceneId: "A", playerId: "p1" },
    loading: null,
    types: ["vision", "fog-explored"],
  });
  expect(visionIds(conn)).toEqual(["A:p1"]);
  expect(conn.loadViewAs("A", "p1")).toBeNull(); // already loaded
});

test("FR-FOG-43 a new pair replaces the old rows; a superseded ack is dropped", async () => {
  const { conn, snapshot, loads, ack } = setup();
  snapshot();
  const first = conn.loadViewAs("A", "p1");
  const second = conn.loadViewAs("A", "p2");
  const [l1, l2] = loads();
  ack(l1?.intentId as string, { vision: [vision("A", "p1")], "fog-explored": [] });
  await first;
  expect(visionIds(conn)).toEqual([]); // superseded: not applied
  ack(l2?.intentId as string, { vision: [vision("A", "p2")], "fog-explored": [] });
  await second;
  expect(visionIds(conn)).toEqual(["A:p2"]);
  expect(conn.snapshot.viewAs.loaded).toEqual({ sceneId: "A", playerId: "p2" });
});

test("FR-FOG-43 View as off clears the rows; a reject leaves no pair; a snapshot resets", async () => {
  const { conn, frame, snapshot, loads, ack } = setup();
  snapshot();
  const p = conn.loadViewAs("A", "p1");
  ack(loads()[0]?.intentId as string, { vision: [vision("A", "p1")], "fog-explored": [] });
  await p;
  conn.clearViewAs();
  expect(visionIds(conn)).toEqual([]);
  expect(conn.snapshot.viewAs.loaded).toBeNull();
  const r = conn.loadViewAs("A", "p9");
  frame({ type: "reject", intentId: loads()[1]?.intentId, code: "not_found", message: "x" });
  await expect(r).rejects.toThrow();
  expect(conn.snapshot.viewAs).toEqual({ loaded: null, loading: null, types: [] });
  const q = conn.loadViewAs("A", "p1");
  ack(loads()[2]?.intentId as string, { vision: [vision("A", "p1")], "fog-explored": [] });
  await q;
  snapshot();
  expect(conn.snapshot.viewAs.loaded).toBeNull();
  expect(visionIds(conn)).toEqual([]);
});

test("FR-FOG-43 players never load view-as rows", () => {
  const { conn, snapshot } = setup("player");
  snapshot();
  expect(conn.loadViewAs("A", "p1")).toBeNull();
});
