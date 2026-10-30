// FR-DICEX-11 high-water, through a real `SyncConnection` (fake socket): snapshots, resyncs and
// undo upserts never throw; a new `n` does; one frame = one call; a campaign switch resets.
import { expect, test } from "bun:test";
import { createStore } from "zustand";
import { SyncConnection } from "../../sync/connection";
import type { SyncState } from "../../sync/store";
import { isOwn, newRollEntries, subscribeRollFrames } from "./throw-source";

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
}

const entry = (n: number, o: Record<string, unknown> = {}) => ({
  id: `e${n}`,
  campaignId: "c",
  n,
  at: "2026-10-16T00:00:00Z",
  kind: "roll",
  category: "other",
  public: true,
  undone: false,
  rollerRole: "player",
  rollerPlayerId: "p1",
  actorName: "Mira",
  payload: [],
  rollIds: [],
  encounterId: null,
  supersededBy: null,
  ...o,
});

function setup() {
  let socket: FakeSocket | null = null;
  const sync = createStore<SyncState>()((set) => {
    const connection = new SyncConnection({
      credential: { role: "player", token: "t" },
      url: "ws://x/ws",
      onChange: (s) => set(s),
      createSocket: () => {
        socket = new FakeSocket();
        return socket as unknown as WebSocket;
      },
      probe: () => true,
    });
    return { ...connection.snapshot, connection };
  });
  sync.getState().connection.start();
  const calls: number[][] = [];
  const un = subscribeRollFrames(sync, (es) => calls.push(es.map((e) => e.n)));
  let seq = 0;
  const send = (frame: unknown) => socket?.onmessage?.({ data: JSON.stringify(frame) });
  const snapshot = (entries: unknown[], campaignId = "c") => {
    seq = 0;
    send({
      type: "snapshot",
      seq: 0,
      you: { campaignId, role: "player", playerId: "p1" },
      records: { "game-log-entry": entries },
    });
  };
  const event = (changes: unknown[], name = "DiceRolled") => {
    seq += 1;
    send({ type: "event", seq, cause: { name }, changes });
  };
  const up = (e: ReturnType<typeof entry>) => ({
    type: "game-log-entry",
    id: e.id,
    op: "upsert",
    data: e,
  });
  return { calls, snapshot, event, up, un };
}

test("FR-DICEX-11 high-water: snapshot / resync / undo never throw; a new n throws once per frame", () => {
  const { calls, snapshot, event, up, un } = setup();
  snapshot([entry(1), entry(2)]);
  expect(calls).toEqual([]); // snapshot entries never throw
  event([up(entry(2, { undone: true }))], "AttackUndone"); // markUndone upserts an old n
  expect(calls).toEqual([]);
  event([up(entry(3))]);
  expect(calls).toEqual([[3]]);
  // One frame with three `roll` entries (Roll monsters) → one call, in n order.
  event([up(entry(6)), up(entry(4)), up(entry(5))], "InitiativeRolled");
  expect(calls).toEqual([[3], [4, 5, 6]]);
  // Kinds other than roll and other record types don't throw.
  event([
    up(entry(7, { kind: "cbt.hp" })),
    { type: "combatant", id: "x", op: "upsert", data: { id: "x" } },
  ]);
  expect(calls).toHaveLength(2);
  // Reconnect: the snapshot holds entries committed offline → in the log, no throw.
  snapshot([entry(1), entry(2), entry(3), entry(4), entry(5), entry(6), entry(7), entry(8)]);
  expect(calls).toHaveLength(2);
  event([up(entry(8, { undone: true }))]);
  expect(calls).toHaveLength(2);
  event([up(entry(9))]);
  expect(calls.at(-1)).toEqual([9]);
  un();
});

test("FR-DICEX-11 campaign switch resets the high-water mark with the new snapshot", () => {
  const { calls, snapshot, event, up, un } = setup();
  snapshot([entry(40)]);
  snapshot([entry(1)], "c2");
  event([up(entry(2, { campaignId: "c2" }))]);
  expect(calls).toEqual([[2]]);
  un();
});

test("newRollEntries reads the applied entry and skips old n", () => {
  const prior = { you: null, seq: 1, records: { "game-log-entry": { e5: entry(5) } } };
  const next = {
    you: null,
    seq: 2,
    records: { "game-log-entry": { e5: entry(5), e6: entry(6), e4: entry(4) } },
  };
  const frame = {
    changes: ["e4", "e6"].map((id) => ({ type: "game-log-entry", id, op: "upsert" as const })),
  };
  expect(newRollEntries(frame, prior, next).map((e) => e.n)).toEqual([6]);
});

test("FR-DICE-102 a revealed line never throws, even above this client's high-water mark", () => {
  const prior = { you: null, seq: 1, records: { "game-log-entry": { e5: entry(5) } } };
  const next = {
    you: null,
    seq: 2,
    records: { "game-log-entry": { e5: entry(5), e6: entry(6) } },
  };
  const changes = [{ type: "game-log-entry", id: "e6", op: "upsert" as const }];
  const frame = (name: string) => ({ cause: { name }, changes });
  expect(newRollEntries(frame("LogEntryHiddenSet"), prior, next)).toEqual([]);
  expect(newRollEntries(frame("DiceRolled"), prior, next).map((e) => e.n)).toEqual([6]);
});

test("FR-DICEX-09 isOwn: rollerRole / rollerPlayerId = this client", () => {
  const dm = { campaignId: "c", role: "dm" as const, playerId: null };
  const p1 = { campaignId: "c", role: "player" as const, playerId: "p1" };
  expect(isOwn({ rollerRole: "dm", rollerPlayerId: null }, dm)).toBe(true);
  expect(isOwn({ rollerRole: "player", rollerPlayerId: "p1" }, dm)).toBe(false);
  expect(isOwn({ rollerRole: "player", rollerPlayerId: "p1" }, p1)).toBe(true);
  expect(isOwn({ rollerRole: "player", rollerPlayerId: "p2" }, p1)).toBe(false);
  expect(isOwn({ rollerRole: "dm", rollerPlayerId: null }, p1)).toBe(false);
  expect(isOwn({ rollerRole: "dm", rollerPlayerId: null }, null)).toBe(false);
});
