// Stats preferences (FR-STATS-30, -34), per browser, both clients, never sent: "Kill feed" and
// "Open the fight summary at End", both on by default. One browser-storage entry `pp.stats.v1`,
// zod-parsed on read; invalid → defaults; storage blocked → memory only for this page.
import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { StorageBackend } from "../play-shell/storage";

export const StatsPrefs = z.object({
  /** FR-STATS-30: kill-feed toasts. */
  feed: z.boolean(),
  /** FR-STATS-34: a live fight summary opens Stats. */
  openSummary: z.boolean(),
});
export type StatsPrefs = z.infer<typeof StatsPrefs>;

export const DEFAULT_STATS_PREFS: StatsPrefs = { feed: true, openSummary: true };
export const STATS_PREFS_KEY = "pp.stats.v1";

export function createStatsPrefs(getBackend: () => StorageBackend | undefined) {
  let memory: StatsPrefs | null = null;
  let cache: { raw: string | null; value: StatsPrefs } | null = null;
  const listeners = new Set<() => void>();
  const raw = (): string | null => {
    try {
      return getBackend()?.getItem(STATS_PREFS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const read = (): StatsPrefs => {
    if (memory) return memory;
    const r = raw();
    if (cache && cache.raw === r) return cache.value;
    let json: unknown = null;
    try {
      json = r === null ? null : JSON.parse(r);
    } catch {
      json = null;
    }
    const parsed = StatsPrefs.safeParse(json);
    cache = { raw: r, value: parsed.success ? parsed.data : DEFAULT_STATS_PREFS };
    return cache.value;
  };
  return {
    read,
    write(patch: Partial<StatsPrefs>) {
      const next = { ...read(), ...patch };
      try {
        const backend = getBackend();
        if (!backend) throw new Error("no storage");
        backend.setItem(STATS_PREFS_KEY, JSON.stringify(next));
        memory = null;
      } catch {
        memory = next;
      }
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export type StatsPrefsStore = ReturnType<typeof createStatsPrefs>;

let page: StatsPrefsStore | null = null;
/** The page's preferences over `localStorage` (looked up lazily: access itself can throw). */
export const statsPrefs = (): StatsPrefsStore => {
  page ??= createStatsPrefs(() => (typeof localStorage === "undefined" ? undefined : localStorage));
  return page;
};

export function useStatsPrefs(): StatsPrefs {
  const p = statsPrefs();
  return useSyncExternalStore(p.subscribe, p.read, p.read);
}
