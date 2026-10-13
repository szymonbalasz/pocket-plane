// Zustand binding for the sync connection. One per client app.
import type { Credential } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import {
  type EventHandler,
  type SignalHandler,
  SyncConnection,
  type SyncSnapshot,
} from "./connection";

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
