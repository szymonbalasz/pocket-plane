// The one client-side reducer for records (ADR-0021 A). Used by both clients and the test harness.
import type { EventFrame, SnapshotFrame, You } from "./frames";

export type RecordMap = Record<string, Record<string, unknown>>;

export interface RecordStore {
  you: You | null;
  /** Last applied seq; 0 right after a snapshot. */
  seq: number;
  /** type → id → record. Every wire record has an `id`. */
  records: RecordMap;
}

export const emptyStore = (): RecordStore => ({ you: null, seq: 0, records: {} });

/** Replaces the whole store (FR-SYNC-08). */
export function applySnapshot(f: SnapshotFrame): RecordStore {
  const records: RecordMap = {};
  for (const [type, list] of Object.entries(f.records)) {
    const byId: Record<string, unknown> = {};
    for (const r of list) {
      const id = (r as { id?: unknown }).id;
      if (typeof id === "string") byId[id] = r;
    }
    records[type] = byId;
  }
  return { you: f.you, seq: 0, records };
}

export type ApplyResult = { ok: true; store: RecordStore } | { ok: false; reason: "gap" };

/** Applies one event atomically; a seq gap means the client must `resync` (FR-SYNC-21). */
export function applyEvent(s: RecordStore, f: EventFrame): ApplyResult {
  if (f.seq !== s.seq + 1) return { ok: false, reason: "gap" };
  const records: RecordMap = { ...s.records };
  for (const ch of f.changes) {
    const byId = { ...(records[ch.type] ?? {}) };
    if (ch.op === "upsert") byId[ch.id] = ch.data;
    else delete byId[ch.id];
    records[ch.type] = byId;
  }
  return { ok: true, store: { ...s, seq: f.seq, records } };
}

export function recordsOf<T>(s: RecordStore, type: string): T[] {
  return Object.values(s.records[type] ?? {}) as T[];
}
