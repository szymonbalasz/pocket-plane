// Lazy record types (ADR-0045, FR-SYNC-30–38): campaign- / global-scope types that are never in a
// snapshot; clients load them with `sync.load {type, ids?}`. Pure; shared by the server hub, the
// clients and the test harness.
import { z } from "zod";
import type { RecordMap, RecordStore } from "./store";

/** Registration flag values: `all` = whole-type and id loads; `ids` = id loads only. */
export const LAZY_MODES = ["all", "ids"] as const;
export type LazyMode = (typeof LAZY_MODES)[number];

/** WS intent, DM and player, read-only; answered by the hub in frame order (not a command). */
export const SYNC_LOAD = "sync.load";

/** Ids per `sync.load` (FR-SYNC-31); clients chunk larger id sets (FR-SYNC-35). */
export const MAX_LOAD_IDS = 50;

export const LoadPayload = z.object({
  type: z.string().min(1).max(128),
  ids: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MAX_LOAD_IDS)
    .refine((ids) => new Set(ids).size === ids.length, "ids must be unique")
    .optional(),
});
export type LoadPayload = z.infer<typeof LoadPayload>;

/** `ack.result`: `{records {<type>: Record[]}}`, filtered as in a snapshot (FR-SYNC-32). */
export const LoadResult = z.object({ records: z.record(z.string(), z.array(z.unknown())) });
export type LoadResult = z.infer<typeof LoadResult>;

/** Whole-type loads (`types`) and id loads per type (`ids`, a union across calls). */
export interface LoadedSet {
  types: readonly string[];
  ids: Readonly<Record<string, readonly string[]>>;
}

export const emptyLoaded = (): LoadedSet => ({ types: [], ids: {} });

/** `type` loaded whole, or (with `id`) that id loaded by an id load or a whole-type load. */
export function isLoaded(set: LoadedSet, type: string, id?: string): boolean {
  if (set.types.includes(type)) return true;
  return id !== undefined && (set.ids[type]?.includes(id) ?? false);
}

/** Adds a whole-type load (`ids` undefined) or those ids. */
export function markLoaded(set: LoadedSet, type: string, ids?: readonly string[]): LoadedSet {
  if (ids === undefined) {
    return set.types.includes(type) ? set : { ...set, types: [...set.types, type] };
  }
  const had = set.ids[type] ?? [];
  const add = ids.filter((id) => !had.includes(id));
  if (add.length === 0) return set;
  return { ...set, ids: { ...set.ids, [type]: [...had, ...add] } };
}

/** Removes a whole-type entry (`ids` undefined) or those ids. */
export function unmark(set: LoadedSet, type: string, ids?: readonly string[]): LoadedSet {
  if (ids === undefined) {
    return set.types.includes(type) ? { ...set, types: set.types.filter((t) => t !== type) } : set;
  }
  const had = set.ids[type];
  if (!had) return set;
  const left = had.filter((id) => !ids.includes(id));
  const next = { ...set.ids };
  if (left.length === 0) delete next[type];
  else next[type] = left;
  return { ...set, ids: next };
}

/**
 * Applies a load result (FR-SYNC-36): a whole-type result replaces every row of `type`; an id
 * result replaces those ids (a requested id absent from the result leaves the store). Safe in
 * frame order: every change committed before the read already reached the store as an event.
 */
export function applyLoad(
  s: RecordStore,
  type: string,
  ids: readonly string[] | undefined,
  records: LoadResult["records"],
): RecordStore {
  const byId: Record<string, unknown> = ids === undefined ? {} : { ...(s.records[type] ?? {}) };
  if (ids !== undefined) for (const id of ids) delete byId[id];
  for (const r of records[type] ?? []) {
    const id = (r as { id?: unknown }).id;
    if (typeof id === "string") byId[id] = r;
  }
  const out: RecordMap = { ...s.records, [type]: byId };
  return { ...s, records: out };
}

/** Splits ids into `sync.load` chunks of ≤ `size` (FR-SYNC-35). */
export function idChunks(ids: readonly string[], size = MAX_LOAD_IDS): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * The client's lazy state (FR-SYNC-35): loaded, in flight and failed loads of the current
 * snapshot generation. Every snapshot resets it (FR-SYNC-37).
 */
export interface LazyState {
  /** Bumped by every snapshot; consumers reload on a new generation. */
  generation: number;
  loaded: LoadedSet;
  loading: LoadedSet;
  /** Rejected loads; not retried until `retry` or the next snapshot. */
  failed: LoadedSet;
}

export const lazyAfterSnapshot = (generation: number): LazyState => ({
  generation,
  loaded: emptyLoaded(),
  loading: emptyLoaded(),
  failed: emptyLoaded(),
});

/** A whole-type load of `type` is still to request: not loaded, in flight or failed. */
export function wholeToRequest(st: LazyState, type: string): boolean {
  return ![st.loaded, st.loading, st.failed].some((s) => s.types.includes(type));
}

/**
 * Ids an id load still has to request: neither loaded, in flight nor failed (a whole-type load
 * done, in flight or failed covers every id). Deduplicated, in first-seen order.
 */
export function idsToRequest(st: LazyState, type: string, ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    if ([st.loaded, st.loading, st.failed].some((s) => isLoaded(s, type, id))) continue;
    out.push(id);
  }
  return out;
}

export type LazyStatus = "loading" | "ready" | "error";

/** Status of a consumer's request: `ready` once all is loaded; `error` if any part failed. */
export function lazyStatus(st: LazyState, type: string, ids?: readonly string[]): LazyStatus {
  if (ids === undefined) {
    if (st.loaded.types.includes(type)) return "ready";
    return st.failed.types.includes(type) ? "error" : "loading";
  }
  const missing = ids.filter((id) => !isLoaded(st.loaded, type, id));
  if (missing.length === 0) return "ready";
  return missing.some((id) => isLoaded(st.failed, type, id)) ? "error" : "loading";
}
