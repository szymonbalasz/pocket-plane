import { expect, test } from "bun:test";
import { ClientFrame, EventFrame, ServerFrame } from "./frames";
import { applyEvent, applySnapshot } from "./store";

const snap = applySnapshot({
  type: "snapshot",
  seq: 0,
  you: { campaignId: "c", role: "player", playerId: "p" },
  records: { probe: [{ id: "a", text: "x" }] },
});

test("FR-SYNC-08 snapshot replaces the store; FR-SYNC-17 events apply atomically", () => {
  expect(snap.records).toEqual({ probe: { a: { id: "a", text: "x" } } });
  const r = applyEvent(snap, {
    type: "event",
    seq: 1,
    cause: { name: "ProbeSet" },
    changes: [
      { type: "probe", id: "b", op: "upsert", data: { id: "b", text: "y" } },
      { type: "probe", id: "a", op: "delete" },
    ],
  });
  expect(r.ok && r.store.records.probe).toEqual({ b: { id: "b", text: "y" } });
  expect(snap.records.probe).toEqual({ a: { id: "a", text: "x" } });
});

test("FR-SYNC-19 an event frame may carry no changes; applying it only advances seq", () => {
  const empty = { type: "event", seq: 1, cause: { name: "X" }, changes: [] };
  expect(ServerFrame.safeParse(empty).success).toBe(true);
  expect(ServerFrame.safeParse({ ...empty, changes: undefined }).success).toBe(false);
  const r = applyEvent(snap, EventFrame.parse(empty));
  expect(r.ok && r.store.seq).toBe(1);
  expect(r.ok && r.store.records).toBe(snap.records);
});

test("FR-SYNC-21 seq gap → resync needed", () => {
  const r = applyEvent(snap, { type: "event", seq: 2, cause: { name: "X" }, changes: [] });
  expect(r).toEqual({ ok: false, reason: "gap" });
});

test("CON-14 frames discriminate on `type`", () => {
  expect(ClientFrame.safeParse({ type: "ping" }).success).toBe(true);
  expect(ClientFrame.safeParse({ kind: "ping" }).success).toBe(false);
  expect(
    ClientFrame.safeParse({ type: "hello", credential: { role: "dm", secret: "s" } }).success,
  ).toBe(true);
  expect(ServerFrame.safeParse({ type: "pong" }).success).toBe(true);
});
