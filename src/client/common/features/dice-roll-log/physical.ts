// FR-DICE-07: physical-dice mode, per client, in browser storage. Shared by the log window's
// toggle and every roll control in this tab (same-tab listeners + the `storage` event).
import { useCallback, useSyncExternalStore } from "react";
import { useSync } from "../../sync/store";
import { physicalKey } from "./logic";

const listeners = new Set<() => void>();

function read(key: string | null): boolean {
  if (!key) return false;
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("pp.dice.v1.")) fn();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(fn);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

/** `[on, set]` for this client's campaign; off until the first snapshot. */
export function usePhysicalDice(): [boolean, (on: boolean) => void] {
  const you = useSync((s) => s.store.you);
  const key = you ? physicalKey(you.campaignId, you.role, you.playerId) : null;
  const on = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (v: boolean) => {
      if (!key) return;
      try {
        globalThis.localStorage?.setItem(key, v ? "1" : "0");
      } catch {
        // Storage unavailable (private mode quota): the toggle just doesn't stick.
      }
      for (const fn of [...listeners]) fn();
    },
    [key],
  );
  return [on, set];
}
