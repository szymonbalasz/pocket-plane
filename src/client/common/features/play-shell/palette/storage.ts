// Browser-only palette state (FR-SHELL-193, -194; #121: never sent): recent picks per campaign and
// owner, `pp.palette.v1.<campaignId>.<dm | playerId>` (≤ 8 keys), and the device-wide Keyboard
// setting `pp.keys.v1` ({singleKey}, default on). zod-parsed on read; a bad entry → the default
// and one console warning; storage that throws → memory only (FR-SHELL-17's rule).
import { z } from "zod";
import { createStore, useStore } from "zustand";
import { GROUP_MAX } from "./types";

export interface Backend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserBackend = (): Backend | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function read<T>(backend: Backend | null, key: string, schema: z.ZodType<T>): T | null {
  let raw: string | null = null;
  try {
    raw = backend?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const r = schema.safeParse(parsed);
  if (r.success) return r.data;
  console.warn(`palette: invalid "${key}"; using the default`);
  return null;
}

function write(backend: Backend | null, key: string, value: unknown): void {
  try {
    backend?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the setting lives for this page only.
  }
}

// ---- recent picks (FR-SHELL-194) ----

export const RECENT_MAX = GROUP_MAX;

export const recentKey = (campaignId: string, owner: { role: "dm" } | { playerId: string }) =>
  `pp.palette.v1.${campaignId}.${"playerId" in owner ? owner.playerId : "dm"}`;

/** ≤ 8 row keys (`c:` / `w:` / `i:` + id); longer lists are cut, not rejected. */
export const RecentPicks = z
  .array(z.string().min(1).max(200))
  .transform((ids) => [...new Set(ids)].slice(0, RECENT_MAX));

/** The stored picks, newest first; unknown or bad entries → []. */
export function readRecent(key: string, backend: Backend | null = browserBackend()): string[] {
  return read(backend, key, RecentPicks) ?? [];
}

/** `pick` goes first; the list keeps ≤ 8. Returns the new list. */
export function pushRecent(
  key: string,
  pick: string,
  backend: Backend | null = browserBackend(),
): string[] {
  const next = [pick, ...readRecent(key, backend).filter((k) => k !== pick)].slice(0, RECENT_MAX);
  write(backend, key, next);
  return next;
}

// ---- Keyboard setting (FR-SHELL-193) ----

export const KEYS_KEY = "pp.keys.v1";

export const KeysSetting = z.strictObject({ singleKey: z.boolean() });
export type KeysSetting = z.infer<typeof KeysSetting>;

export const DEFAULT_KEYS: KeysSetting = { singleKey: true };

export function readKeys(backend: Backend | null = browserBackend()): KeysSetting {
  return read(backend, KEYS_KEY, KeysSetting) ?? DEFAULT_KEYS;
}

/** The page's Keyboard setting: read once, written through on change. */
export const keysSetting = createStore<KeysSetting>(() =>
  typeof window === "undefined" ? DEFAULT_KEYS : readKeys(),
);

export function setSingleKey(on: boolean, backend: Backend | null = browserBackend()): void {
  const next = { singleKey: on };
  keysSetting.setState(next);
  write(backend, KEYS_KEY, next);
}

export const useSingleKey = (): boolean => useStore(keysSetting, (s) => s.singleKey);
