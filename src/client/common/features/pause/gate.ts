// The page's pause gate (FR-SHELL-127, seams S10): players under the pause card. Code that has the
// synced store reads `isPausedFor(store)`; code that hasn't (a feature open, a camera refit) asks
// the gate. `deferUntilResume` runs a feature open now, or at resume while paused (the End
// summary, `stats.showAwards`, reveal refits). Window opens queue in the placer on their own
// while the card blocks input (FR-SHELL-112 (2)). The DM's gate never closes.
import { createStore, type StoreApi } from "zustand";

export interface PauseGate {
  api: StoreApi<{ paused: boolean }>;
  paused(): boolean;
  /** Runs `fn` now, or once at resume while paused; the same `key` again replaces it. */
  deferUntilResume(key: string, fn: () => void): void;
  /** The pause runtime only: up / down; down runs the deferred calls in their order. */
  set(paused: boolean): void;
}

export function createPauseGate(): PauseGate {
  const api = createStore<{ paused: boolean }>()(() => ({ paused: false }));
  const deferred = new Map<string, () => void>();
  return {
    api,
    paused: () => api.getState().paused,
    deferUntilResume(key, fn) {
      if (!api.getState().paused) {
        fn();
        return;
      }
      deferred.delete(key);
      deferred.set(key, fn);
    },
    set(paused) {
      if (api.getState().paused === paused) return;
      api.setState({ paused });
      if (paused) return;
      const run = [...deferred.values()];
      deferred.clear();
      for (const fn of run) {
        try {
          fn();
        } catch (err) {
          console.error("deferred open failed at resume", err);
        }
      }
    },
  };
}

/** The page's gate (client memory; a reload starts from the snapshot's pause). */
export const pauseGate = createPauseGate();
