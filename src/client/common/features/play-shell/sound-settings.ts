// Player sound settings (FR-SHELL-24): one browser-storage entry per (campaign, player), zod-
// parsed on read. Never sent to the server. Same failure rules as the layout (FR-SHELL-17).
import { z } from "zod";
import type { StorageBackend } from "./storage";

export const SoundSettings = z.object({
  muted: z.boolean(),
  volume: z.number().int().min(0).max(100),
});
export type SoundSettings = z.infer<typeof SoundSettings>;

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { muted: false, volume: 70 };

/** `pp.sound.v1.<campaignId>.<playerId>` (FR-SHELL-24). No secret in the key. */
export const soundKey = (campaignId: string, playerId: string) =>
  `pp.sound.v1.${campaignId}.${playerId}`;

/** Muted or volume 0 → no sound (FR-SHELL-25). */
export const isSilent = (s: SoundSettings) => s.muted || s.volume === 0;

export interface SoundSettingsStorage {
  /** The settings for `key`; missing → defaults; invalid → defaults + warning. Never throws. */
  read(key: string): SoundSettings;
  /** Synchronous write. Never throws. */
  write(key: string, settings: SoundSettings): void;
}

/**
 * `getBackend` may itself throw (storage blocked). Any failure → settings live in memory only
 * for this page, with one console warning and no error UI.
 */
export function createSoundSettingsStorage(
  getBackend: () => StorageBackend,
  warn: (msg: string, err?: unknown) => void = (m, e) => console.warn(m, e),
): SoundSettingsStorage {
  const memory = new Map<string, SoundSettings>();
  let failed = false;
  const fail = (what: string, err: unknown) => {
    if (!failed)
      warn(`play-shell: sound settings storage ${what} failed; keeping them in memory`, err);
    failed = true;
  };
  const parse = (text: string | null): SoundSettings => {
    if (text === null) return DEFAULT_SOUND_SETTINGS;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const r = SoundSettings.safeParse(json);
    if (r.success) return r.data;
    warn("play-shell: invalid sound settings; using the defaults");
    return DEFAULT_SOUND_SETTINGS;
  };
  return {
    read(key) {
      const kept = memory.get(key);
      if (failed) return kept ?? DEFAULT_SOUND_SETTINGS;
      try {
        return parse(getBackend().getItem(key));
      } catch (err) {
        fail("read", err);
        return kept ?? DEFAULT_SOUND_SETTINGS;
      }
    },
    write(key, settings) {
      memory.set(key, settings);
      if (failed) return;
      try {
        getBackend().setItem(key, JSON.stringify(settings));
      } catch (err) {
        fail("write", err);
      }
    },
  };
}

/** The browser's localStorage, looked up lazily (access itself can throw). */
export const browserSoundSettingsStorage = (): SoundSettingsStorage =>
  createSoundSettingsStorage(() => window.localStorage);
