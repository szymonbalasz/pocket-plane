// Launcher badge refresh (OQ-NOTE-13, #142). A window type's `badge(store)` may read client
// state outside the synced store (e.g. a browser seen marker); its owner calls `refreshBadges()`
// when that state changes, and the launcher recomputes every badge.
import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

export function refreshBadges(): void {
  version += 1;
  for (const l of [...listeners]) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Changes whenever `refreshBadges()` is called. */
export function useBadgeVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

/** A badge value as shown: positive integers only; 99+ caps. Never throws. */
export function badgeText(fn: (() => number) | undefined): string | null {
  if (!fn) return null;
  let n = 0;
  try {
    n = fn();
  } catch (err) {
    console.warn("launcher badge() threw", err);
    return null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? "99+" : String(Math.floor(n));
}
