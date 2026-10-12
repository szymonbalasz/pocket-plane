// Layout persistence in browser storage (FR-SHELL-15/17/19). Never sent to the server (#121).
import type { Layout } from "@shared/play-shell/layout";

export type StorageBackend = Pick<Storage, "getItem" | "setItem">;

export interface LayoutStorage {
  /** The stored string for `key`, or null. Never throws. */
  read(key: string): string | null;
  /** Synchronous write (FR-SHELL-15). Never throws. */
  write(key: string, layout: Layout): void;
}

/**
 * `getBackend` may itself throw (e.g. storage blocked). Any failure → the layout lives in
 * memory only for this page, with one console warning and no error UI (FR-SHELL-17).
 * No `storage` event listener: another tab's writes are never applied live (FR-SHELL-19).
 */
export function createLayoutStorage(
  getBackend: () => StorageBackend,
  warn: (msg: string, err?: unknown) => void = (m, e) => console.warn(m, e),
): LayoutStorage {
  const memory = new Map<string, string>();
  let failed = false;
  const fail = (what: string, err: unknown) => {
    if (!failed) warn(`play-shell: layout storage ${what} failed; keeping layout in memory`, err);
    failed = true;
  };
  return {
    read(key) {
      if (failed) return memory.get(key) ?? null;
      try {
        return getBackend().getItem(key);
      } catch (err) {
        fail("read", err);
        return memory.get(key) ?? null;
      }
    },
    write(key, layout) {
      const text = JSON.stringify(layout);
      memory.set(key, text);
      if (failed) return;
      try {
        getBackend().setItem(key, text);
      } catch (err) {
        fail("write", err);
      }
    },
  };
}

/** The browser's localStorage, looked up lazily (access itself can throw). */
export const browserLayoutStorage = (): LayoutStorage =>
  createLayoutStorage(() => window.localStorage);
