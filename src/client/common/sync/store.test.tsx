// BL-16: `useRecords` keeps one array per type's records map, so memos / effects keyed on it
// settle. Static server renders over fake stores (each render reads the store's initial state).
import { expect, test } from "bun:test";
import type { EventFrame } from "@shared/protocol/frames";
import { applyEvent, emptyStore, type RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { SyncContext, type SyncState, useRecords } from "./store";

type Rec = { id: string };

function renderRecords(store: RecordStore, type: string): Rec[] {
  let seen: Rec[] | null = null;
  function Probe() {
    seen = useRecords<Rec>(type);
    return null;
  }
  const sync = createStore<SyncState>()(() => ({ state: "live", store }) as unknown as SyncState);
  renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <Probe />
    </SyncContext.Provider>,
  );
  if (!seen) throw new Error("not rendered");
  return seen;
}

function upsert(s: RecordStore, type: string, id: string): RecordStore {
  const frame = { seq: s.seq + 1, changes: [{ op: "upsert", type, id, data: { id } }] };
  const r = applyEvent(s, frame as unknown as EventFrame);
  if (!r.ok) throw new Error("gap");
  return r.store;
}

test("BL-16 useRecords stable array", () => {
  let s = upsert(upsert(emptyStore(), "token", "t1"), "note", "n1");
  const first = renderRecords(s, "token");
  expect(first.map((r) => r.id)).toEqual(["t1"]);
  // Unchanged store: same reference across renders.
  expect(renderRecords(s, "token")).toBe(first);
  // Another type's upsert leaves this type's array alone.
  s = upsert(s, "note", "n2");
  expect(renderRecords(s, "token")).toBe(first);
  // An upsert of this type gives a new array, stable again after that.
  s = upsert(s, "token", "t2");
  const second = renderRecords(s, "token");
  expect(second).not.toBe(first);
  expect(second.map((r) => r.id)).toEqual(["t1", "t2"]);
  expect(renderRecords(s, "token")).toBe(second);
  // No records of a type: one shared empty array.
  expect(renderRecords(s, "missing")).toBe(renderRecords(emptyStore(), "other"));
  expect(renderRecords(s, "missing")).toEqual([]);
});
