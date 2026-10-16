// FR-DICEX-21: per-device render settings, per browser `pp.dicex.v1.<campaignId>.<dm | playerId>`
// = {render, others}, zod-parsed. Invalid / unavailable storage → defaults, kept in memory.
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";
import { useSync } from "../../sync/store";

export const RenderSetting = z.enum(["3d", "flat", "off"]);
export type RenderSetting = z.infer<typeof RenderSetting>;

export const DiceSettings = z.object({ render: RenderSetting, others: z.boolean() });
export type DiceSettings = z.infer<typeof DiceSettings>;

export const DEFAULT_SETTINGS: DiceSettings = { render: "3d", others: true };

/**
 * 3D dice are slice D3 (lazy `three` chunk, ADR-0044). Until then a `3d` setting draws flat, as a
 * throw does while the chunk loads (DICEX §7 "States").
 */
export const THREE_D_AVAILABLE = false;

export function settingsKey(campaignId: string, role: "dm" | "player", playerId: string | null) {
  return `pp.dicex.v1.${campaignId}.${role === "dm" ? "dm" : playerId}`;
}

/** Stored JSON → settings; anything invalid → the defaults. */
export function parseSettings(raw: string | null | undefined): DiceSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const r = DiceSettings.safeParse(JSON.parse(raw));
    return r.success ? r.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface RenderEnv {
  reducedMotion: boolean;
  /** WebGL and the 3D code are usable here. */
  threeD: boolean;
}

/** What a throw draws: `3d` only with WebGL and no reduced-motion preference, else `flat`. */
export function effectiveRender(setting: RenderSetting, env: RenderEnv): RenderSetting {
  if (setting !== "3d") return setting;
  return env.reducedMotion || !env.threeD ? "flat" : "3d";
}

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
  return {
    read(key) {
      const kept = memory.get(key);
      if (kept) return kept;
      let raw: string | null = null;
      try {
        raw = getBackend()?.getItem(key) ?? null;
      } catch {
        raw = null;
      }
      const hit = cache.get(key);
      if (hit && hit.raw === raw) return hit.value;
      const value = parseSettings(raw);
      cache.set(key, { raw, value });
      return value;
    },
    write(key, s) {
      try {
        const backend = getBackend();
        if (!backend) throw new Error("no storage");
        backend.setItem(key, JSON.stringify(s));
        memory.delete(key);
      } catch {
        memory.set(key, s);
      }
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

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/** This client's settings (defaults before the first snapshot) and a setter. */
export function useDiceSettings(): {
  settings: DiceSettings;
  render: RenderSetting;
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
  const render = effectiveRender(settings.render, {
    reducedMotion: prefersReducedMotion(),
    threeD: THREE_D_AVAILABLE,
  });
  return { settings, render, set };
}
