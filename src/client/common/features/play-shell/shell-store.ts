// Shell state: the stored windows of the current layout key, plus restore and write rules
// (FR-SHELL-15/16). One per play page; survives waiting / reconnect screens.
import { createStore, type StoreApi } from "zustand";
import type { Viewport } from "./geometry";
import { reduce, restoreLayout, serialise, type WindowAction, type Windows } from "./manager";
import type { WindowRegistry } from "./registry";
import type { LayoutStorage } from "./storage";

export interface ShellState {
  /** Layout key the windows belong to; null before the first snapshot. */
  key: string | null;
  windows: Windows;
}

export interface ShellController {
  store: StoreApi<ShellState>;
  registry: WindowRegistry;
  /**
   * Apply the stored entry for `key` (first snapshot after load, or after `you.campaignId`
   * changes). Same key → no-op: other snapshots never open, close or move windows.
   */
  restore(key: string): void;
  /** Apply a user change; writes synchronously to the key it was made under. */
  dispatch(action: WindowAction, available: ReadonlySet<string>): void;
}

export function createShellController(opts: {
  registry: WindowRegistry;
  storage: LayoutStorage;
  viewport: () => Viewport;
  warn?: (msg: string) => void;
}): ShellController {
  const { registry, storage } = opts;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const store = createStore<ShellState>()(() => ({ key: null, windows: [] }));
  return {
    store,
    registry,
    restore(key) {
      if (store.getState().key === key) return;
      const r = restoreLayout(registry, storage.read(key), opts.viewport());
      if (r.warning) warn(`play-shell: ${r.warning}; using the default layout`);
      store.setState({ key, windows: r.windows });
    },
    dispatch(action, available) {
      const { key, windows } = store.getState();
      if (key === null) return; // nothing shown before the first snapshot
      const next = reduce(windows, action, { registry, viewport: opts.viewport(), available });
      if (next === windows) return;
      store.setState({ windows: next });
      storage.write(key, serialise(next, registry));
    },
  };
}
