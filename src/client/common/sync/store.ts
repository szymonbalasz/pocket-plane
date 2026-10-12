// Zustand binding for the sync connection. One per client app.
import type { Credential } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import { createContext, useContext } from "react";
import { createStore, type StoreApi, useStore } from "zustand";
import { SyncConnection, type SyncSnapshot } from "./connection";

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

export { recordsOf };
