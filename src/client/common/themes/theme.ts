// Theme choice (theme-system FR-THEME-01, -03; ADR-0069): one browser-storage entry `pp.theme.v1`
// = {theme}, zod-parsed, shared by both clients and every campaign on this browser; never sent.
// The active theme is `data-theme` on <html>; Simple Dark (`default`, the original look) has none.
// No stored choice, or an unreadable one → Gilt & Stone (DM #355). The boot script in both
// index.html files applies that before first paint and warns once about an unreadable choice
// (FR-THEME-04); this store reads, writes and applies it after that and tells this tab's
// subscribers. No `storage` listener: another tab picks a change up on its next load.
import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { StorageBackend } from "../features/play-shell/storage";

export const THEME_IDS = ["default", "gilt"] as const;
export const ThemeId = z.enum(THEME_IDS);
export type ThemeId = z.infer<typeof ThemeId>;

export const ThemePref = z.object({ theme: ThemeId });
export type ThemePref = z.infer<typeof ThemePref>;

export const THEME_KEY = "pp.theme.v1";
/** The theme of a browser with no (readable) stored choice (DM #355, OQ-THEME-03 B). */
export const FALLBACK_THEME: ThemeId = "gilt";
/** The stored id `default` keeps meaning the original look, shown as "Simple Dark" (no migration). */
export const THEME_LABELS: Readonly<Record<ThemeId, string>> = {
  default: "Simple Dark",
  gilt: "Gilt & Stone",
};

/** A stored string → its theme; missing, not JSON or not a `ThemePref` → null. */
export function parseTheme(raw: string | null): ThemeId | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = ThemePref.safeParse(json);
  return r.success ? r.data.theme : null;
}

type Root = Pick<Element, "setAttribute" | "removeAttribute">;

/** The attribute side of FR-THEME-01: `data-theme="<id>"`, none for Simple Dark. */
export function applyTheme(root: Root, t: ThemeId) {
  if (t === "default") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

/**
 * `getBackend` / `getRoot` are looked up per call (storage access itself can throw). A failed
 * write keeps the choice in memory for this page (spec §7: storage blocked → the choice works for
 * the session), with one console warning.
 */
export function createThemeStore(
  getBackend: () => StorageBackend | undefined,
  getRoot: () => Root | undefined,
  warn: (msg: string, err?: unknown) => void = (m, e) => console.warn(m, e),
) {
  let memory: ThemeId | null = null;
  let warned = false;
  const listeners = new Set<() => void>();
  const read = (): ThemeId => {
    if (memory) return memory;
    try {
      return parseTheme(getBackend()?.getItem(THEME_KEY) ?? null) ?? FALLBACK_THEME;
    } catch {
      return FALLBACK_THEME;
    }
  };
  return {
    read,
    /** Stores, applies at once (no reload, FR-THEME-02) and notifies. Never throws. */
    write(theme: ThemeId) {
      try {
        const backend = getBackend();
        if (!backend) throw new Error("no storage");
        backend.setItem(THEME_KEY, JSON.stringify({ theme } satisfies ThemePref));
        memory = null;
      } catch (err) {
        memory = theme;
        if (!warned) warn("theme: storage unavailable; keeping the choice for this page", err);
        warned = true;
      }
      const root = getRoot();
      if (root) applyTheme(root, theme);
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

export type ThemeStore = ReturnType<typeof createThemeStore>;

let page: ThemeStore | null = null;
/** The page's store over `localStorage` and <html>. */
export const themeStore = (): ThemeStore => {
  page ??= createThemeStore(
    () => (typeof localStorage === "undefined" ? undefined : localStorage),
    () => (typeof document === "undefined" ? undefined : document.documentElement),
  );
  return page;
};

export function useTheme(): ThemeId {
  const s = themeStore();
  return useSyncExternalStore(s.subscribe, s.read, s.read);
}
