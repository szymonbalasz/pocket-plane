// Map effects preference (FR-VFX-25–27), per browser, both clients, never sent: one
// browser-storage entry `pp.vfx` = `{level}`, zod-parsed on read; unreadable → the default
// (Still under `prefers-reduced-motion: reduce`, else Full), kept in memory when storage is
// blocked. Plus the page's slow-frames tier drop (FR-VFX-27): memory only, never below Still.
import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { StorageBackend } from "../play-shell/storage";

export const FX_LEVELS = ["full", "reduced", "still", "off"] as const;
export const FxLevel = z.enum(FX_LEVELS);
export type FxLevel = z.infer<typeof FxLevel>;

export const FX_LEVEL_LABEL: Record<FxLevel, string> = {
  full: "Full",
  reduced: "Reduced",
  still: "Still",
  off: "Off",
};

export const VfxPrefs = z.object({ level: FxLevel });
export type VfxPrefs = z.infer<typeof VfxPrefs>;

export const VFX_PREFS_KEY = "pp.vfx";

/** FR-VFX-25: Still when the OS asks for reduced motion, else Full. */
export const defaultLevel = (reducedMotion: boolean): FxLevel => (reducedMotion ? "still" : "full");

/** FR-VFX-27: one tier down, Full → Reduced → Still, never to Off. */
export function lowerTier(level: FxLevel): FxLevel {
  return level === "full" ? "reduced" : level === "reduced" ? "still" : level;
}

const TIER: Record<FxLevel, number> = { full: 0, reduced: 1, still: 2, off: 3 };

/** The level drawn: the chosen one, or the lowered tier when that is lower (never raises Off). */
export function effectiveLevel(chosen: FxLevel, lowered: FxLevel | null): FxLevel {
  return lowered !== null && TIER[lowered] > TIER[chosen] ? lowered : chosen;
}

export interface VfxPrefsEnv {
  storage(): StorageBackend | undefined;
  reducedMotion(): boolean;
}

export function createVfxPrefs(env: VfxPrefsEnv) {
  let memory: VfxPrefs | null = null;
  let cache: { raw: string | null; value: VfxPrefs } | null = null;
  let lowered: FxLevel | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of [...listeners]) fn();
  };
  const raw = (): string | null => {
    try {
      return env.storage()?.getItem(VFX_PREFS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const read = (): VfxPrefs => {
    if (memory) return memory;
    const r = raw();
    if (cache && cache.raw === r) return cache.value;
    let json: unknown = null;
    try {
      json = r === null ? null : JSON.parse(r);
    } catch {
      json = null;
    }
    const parsed = VfxPrefs.safeParse(json);
    cache = {
      raw: r,
      value: parsed.success ? parsed.data : { level: defaultLevel(env.reducedMotion()) },
    };
    return cache.value;
  };
  return {
    read,
    write(level: FxLevel) {
      const next = { level };
      try {
        const backend = env.storage();
        if (!backend) throw new Error("no storage");
        backend.setItem(VFX_PREFS_KEY, JSON.stringify(next));
        memory = null;
      } catch {
        memory = next;
      }
      emit();
    },
    /** FR-VFX-27: the slow-frames tier for the rest of the page's life (null = none). */
    lowered: () => lowered,
    /** FR-VFX-27: drops one tier below what is drawn now; Still and Off stay. */
    lower() {
      const now = effectiveLevel(read().level, lowered);
      const next = lowerTier(now);
      if (next === now) return;
      lowered = next;
      emit();
    },
    /** The level the map draws at. */
    level: () => effectiveLevel(read().level, lowered),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export type VfxPrefsStore = ReturnType<typeof createVfxPrefs>;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let page: VfxPrefsStore | null = null;
/** The page's preference over `localStorage` (looked up lazily: access itself can throw). */
export const vfxPrefs = (): VfxPrefsStore => {
  page ??= createVfxPrefs({
    storage: () => (typeof localStorage === "undefined" ? undefined : localStorage),
    reducedMotion,
  });
  return page;
};

/** React: `{chosen, level, lowered}`; re-renders on a pick or a tier drop. */
export function useVfxLevel(): { chosen: FxLevel; level: FxLevel; lowered: FxLevel | null } {
  const p = vfxPrefs();
  const chosen = useSyncExternalStore(p.subscribe, () => p.read().level);
  const lowered = useSyncExternalStore(p.subscribe, p.lowered);
  return { chosen, level: effectiveLevel(chosen, lowered), lowered };
}
