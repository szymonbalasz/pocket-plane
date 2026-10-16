// Zustand binding for the sync connection. One per client app.
import type { Credential } from "@shared/protocol/frames";
import {
  idsToRequest,
  isLoaded,
  type LazyStatus,
  lazyStatus,
  wholeToRequest,
} from "@shared/protocol/lazy";
import { emptyStore, recordsOf } from "@shared/protocol/store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import {
  type EventHandler,
  type SignalHandler,
  SyncConnection,
  type SyncSnapshot,
} from "./connection";
import { type PresenceView, presenceOf } from "./presence";

export interface SyncState extends SyncSnapshot {
  connection: SyncConnection;
}

export type SyncStore = StoreApi<SyncState>;

export function createSyncStore(credential: Credential): SyncStore {
  let connection: SyncConnection | null = null;
  const store = createStore<SyncState>()((set) => {
    connection = new SyncConnection({ credential, onChange: (s) => set(s) });
    return { ...connection.snapshot, connection };
  });
  return store;
}

export const SyncContext = createContext<SyncStore | null>(null);

export function useSync<T>(selector: (s: SyncState) => T): T {
  const store = useContext(SyncContext);
  if (!store) throw new Error("useSync outside SyncContext");
  return useStore(store, selector);
}

/** Records of one type, as a stable array per store version. */
export function useRecords<T>(type: string): T[] {
  const byId = useSync((s) => s.store.records[type]);
  return byId ? (Object.values(byId) as T[]) : [];
}

export function useHasType(type: string): boolean {
  return useSync((s) => s.store.records[type] !== undefined);
}

export interface LazyRecords<T> {
  /** Loaded rows only (the type's, or those of `ids`); never rows merely present in the store. */
  rows: T[];
  state: LazyStatus;
  /** Loads the failed part again (after `error`). */
  retry(): void;
}

/** Sorted, deduplicated id key: a stable dependency for an id list. */
const idKey = (ids: readonly string[] | undefined) =>
  ids === undefined ? null : JSON.stringify([...new Set(ids)].sort());

/**
 * A lazy record type (ADR-0045, FR-SYNC-35): `useLazyRecords(type)` loads the whole type,
 * `useLazyRecords(type, ids)` those ids (only ids not yet loaded, chunks of ≤ 50). Loads once per
 * snapshot generation while live; `loading` until loaded, `error` after a reject (`retry`).
 */
export function useLazyRecords<T>(type: string, ids?: readonly string[]): LazyRecords<T> {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const lazy = useSync((s) => s.lazy);
  const byId = useSync((s) => s.store.records[type]);
  const key = idKey(ids);
  const want = useMemo(() => (key === null ? undefined : (JSON.parse(key) as string[])), [key]);
  const needs =
    want === undefined ? wholeToRequest(lazy, type) : idsToRequest(lazy, type, want).length > 0;
  useEffect(() => {
    if (live && needs) connection.load(type, want)?.catch(() => {});
  }, [connection, live, needs, type, want]);
  const rows = useMemo(() => {
    if (!byId) return [];
    const keep = want === undefined ? null : new Set(want);
    return Object.entries(byId)
      .filter(([id]) => (keep === null || keep.has(id)) && isLoaded(lazy.loaded, type, id))
      .map(([, r]) => r as T);
  }, [byId, lazy.loaded, type, want]);
  const retry = useCallback(() => {
    connection.retryLoad(type, want)?.catch(() => {});
  }, [connection, type, want]);
  return { rows, state: lazyStatus(lazy, type, want), retry };
}

/** Whether `type` (or one id of it) is loaded in this snapshot generation (FR-SYNC-35). */
export function useIsLoaded(type: string, id?: string): boolean {
  return useSync((s) => isLoaded(s.lazy.loaded, type, id));
}

/**
 * Presence for display (FR-SYNC-29): unknown while not `live`, else the online player IDs of
 * the current store. Stable per (live, presence records).
 */
export function usePresence(): PresenceView {
  const live = useSync((s) => s.state === "live");
  const byId = useSync((s) => s.store.records.presence);
  return useMemo(
    () =>
      presenceOf(live ? "live" : "reconnecting", {
        ...emptyStore(),
        records: byId ? { presence: byId } : {},
      }),
    [live, byId],
  );
}

/** Calls `handler` for every incoming signal named `name` (FR-SYNC-22, ADR-0026). */
export function useSignal(name: string, handler: SignalHandler): void {
  const store = useContext(SyncContext);
  if (!store) throw new Error("useSignal outside SyncContext");
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () =>
      store.getState().connection.onSignal((s) => {
        if (s.name === name) ref.current(s);
      }),
    [store, name],
  );
}

/** Calls `handler` for every applied event frame (live only; never a snapshot or resync). */
export function useEventFrame(handler: EventHandler): void {
  const store = useContext(SyncContext);
  if (!store) throw new Error("useEventFrame outside SyncContext");
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => store.getState().connection.onEvent((f, s) => ref.current(f, s)), [store]);
}

/** Sends a signal; false when not live (dropped, never queued). */
export function useSendSignal(): (name: string, data: unknown) => boolean {
  const connection = useSync((s) => s.connection);
  return useCallback((name, data) => connection.sendSignal(name, data), [connection]);
}

export { recordsOf };
