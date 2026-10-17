// FR-DICEX-36: per-device dice settings v2, per browser `pp.dicex.v2.<campaignId>.<dm | playerId>`
// = {display, others, popup}, zod-parsed. Invalid / unavailable storage → defaults, kept in memory.
// A sprint-3 v1 entry (`{render, others}`, FR-DICEX-21) migrates once on read: `3d` → `screen`,
// `flat` / `off` kept, `others` kept; the v2 entry is written so later reads skip v1. Never sent.
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";
import { useSync } from "../../sync/store";
import { useThreeD } from "./lazy3d";

/** FR-DICEX-32: `screen` full-screen 3D (default), `zone` "Tray throw", `flat` chips, `off`. */
export const DisplaySetting = z.enum(["screen", "zone", "flat", "off"]);
export type DisplaySetting = z.infer<typeof DisplaySetting>;

export const DiceSettings = z.object({
  display: DisplaySetting,
  others: z.boolean(),
  popup: z.boolean(),
});
export type DiceSettings = z.infer<typeof DiceSettings>;

export const DEFAULT_SETTINGS: DiceSettings = { display: "screen", others: true, popup: true };

/** The retired sprint-3 shape (FR-DICEX-21), read only to migrate. */
const SettingsV1 = z.object({ render: z.enum(["3d", "flat", "off"]), others: z.boolean() });

const V2 = "pp.dicex.v2.";
const V1 = "pp.dicex.v1.";

export function settingsKey(campaignId: string, role: "dm" | "player", playerId: string | null) {
  return `${V2}${campaignId}.${role === "dm" ? "dm" : playerId}`;
}

const json = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Stored v2 JSON → settings; anything invalid → the defaults. */
export function parseSettings(raw: string | null | undefined): DiceSettings {
  if (!raw) return DEFAULT_SETTINGS;
  const r = DiceSettings.safeParse(json(raw));
  return r.success ? r.data : DEFAULT_SETTINGS;
}

/** A v1 entry → v2 (`3d` → `screen`); null when it doesn't parse. */
export function migrateV1(raw: string | null | undefined): DiceSettings | null {
  if (!raw) return null;
  const r = SettingsV1.safeParse(json(raw));
  if (!r.success) return null;
  const display = r.data.render === "3d" ? "screen" : r.data.render;
  return { ...DEFAULT_SETTINGS, display, others: r.data.others };
}

export interface DisplayEnv {
  /** WebGL and the 3D code are usable here. */
  threeD: boolean;
}

/**
 * FR-DICEX-32: what this device shows. No 3D (no WebGL, a failed chunk) turns `screen` / `zone`
 * into `flat`; the stored setting is kept. The OS reduced-motion preference is ignored, like
 * Owlbear (#247, supersedes FR-DICEX-45): Flat and Off are the user's own choices.
 */
export function effectiveDisplay(setting: DisplaySetting, env: DisplayEnv): DisplaySetting {
  if (setting !== "screen" && setting !== "zone") return setting;
  return env.threeD ? setting : "flat";
}

/** Display modes that draw 3D dice (and so preload the chunk, FR-DICEX-37). */
export const is3dDisplay = (d: DisplaySetting) => d === "screen" || d === "zone";

export type SettingsBackend = Pick<Storage, "getItem" | "setItem">;

export interface SettingsStore {
  read(key: string): DiceSettings;
  write(key: string, s: DiceSettings): void;
  subscribe(fn: () => void): () => void;
}

/** Storage-backed settings with an in-memory fallback when storage throws or is missing. */
export function createSettingsStore(getBackend: () => SettingsBackend | undefined): SettingsStore {
  const memory = new Map<string, DiceSettings>();
  // useSyncExternalStore needs a stable snapshot per key: cache by the raw value.
  const cache = new Map<string, { raw: string | null; value: DiceSettings }>();
  const listeners = new Set<() => void>();
  const get = (key: string): string | null => {
    try {
      return getBackend()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const put = (key: string, s: DiceSettings): boolean => {
    try {
      const backend = getBackend();
      if (!backend) return false;
      backend.setItem(key, JSON.stringify(s));
      return true;
    } catch {
      return false;
    }
  };
  return {
    read(key) {
      const kept = memory.get(key);
      if (kept) return kept;
      const raw = get(key);
      const hit = cache.get(key);
      if (hit && hit.raw === raw) return hit.value;
      if (raw === null && key.startsWith(V2)) {
        // FR-DICEX-36: a v1 entry migrates once; the v2 write makes later reads skip it.
        const migrated = migrateV1(get(V1 + key.slice(V2.length)));
        if (migrated) {
          if (put(key, migrated)) {
            cache.set(key, { raw: JSON.stringify(migrated), value: migrated });
          } else memory.set(key, migrated);
          return migrated;
        }
      }
      const value = parseSettings(raw);
      cache.set(key, { raw, value });
      return value;
    },
    write(key, s) {
      if (put(key, s)) memory.delete(key);
      else memory.set(key, s);
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

const store = createSettingsStore(() => globalThis.localStorage);

/** This client's settings (defaults before the first snapshot) and a setter. */
export function useDiceSettings(): {
  settings: DiceSettings;
  /** What this device shows (FR-DICEX-32): no 3D → `flat`. */
  display: DisplaySetting;
  set(patch: Partial<DiceSettings>): void;
} {
  const you = useSync((s) => s.store.you);
  const key = you ? settingsKey(you.campaignId, you.role, you.playerId) : null;
  const settings = useSyncExternalStore(
    store.subscribe,
    () => (key ? store.read(key) : DEFAULT_SETTINGS),
    () => DEFAULT_SETTINGS,
  );
  const set = useCallback(
    (patch: Partial<DiceSettings>) => {
      if (key) store.write(key, { ...store.read(key), ...patch });
    },
    [key],
  );
  // 3D needs WebGL and a chunk that hasn't failed this session (FR-DICEX-22).
  const threeD = useThreeD().available;
  const display = effectiveDisplay(settings.display, { threeD });
  return { settings, display, set };
}
