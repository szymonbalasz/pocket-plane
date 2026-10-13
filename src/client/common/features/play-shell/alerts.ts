// Alert surface (FR-SHELL-22–27): flash + Toast + sound + title mark, client-side only. Features
// call `useShellAlert()` (ShellContext) in reaction to events the client already received; the
// shell adds no event, intent or record. Pure controller with injected browser parts.
import { createStore, type StoreApi } from "zustand";
import type { AudioEngine, SoundOutcome } from "./audio";
import {
  DEFAULT_SOUND_SETTINGS,
  isSilent,
  type SoundSettings,
  type SoundSettingsStorage,
} from "./sound-settings";
import { DEFAULT_SOUND_ID } from "./sounds";

export interface ShellAlert {
  /** Same id while its flash runs → the flash restarts; no stacking. */
  id: string;
  title: string;
  detail?: string;
  /** Sound id (FR-SHELL-26); omitted → no sound. Unknown → `ping`. */
  sound?: string;
}

export type SpeakerState = "on" | "muted" | "locked";

export interface AlertState {
  /** The running flash; `key` changes on every alert so the animation restarts. */
  flash: { id: string; key: number } | null;
  /** FR-SHELL-27 `<sound>:<outcome>:<n>`; "" before the first alert with a sound. */
  lastSound: string;
  /** Alerts with a sound so far (the `n` above). */
  soundCount: number;
  settings: SoundSettings;
  unlocked: boolean;
}

export interface AlertController {
  store: StoreApi<AlertState>;
  alert(a: ShellAlert): void;
  /** The flash with `key` finished; a newer one is left alone. */
  flashEnded(key: number): void;
  /** First `pointerdown` / `keydown` anywhere on the page (FR-SHELL-25). */
  unlock(): void;
  /** Sound settings owner: the player's key, or null (DM: defaults, in memory). */
  setOwner(key: string | null): void;
  setSettings(patch: Partial<SoundSettings>): void;
  /** The speaker's Test button: counts as an interaction, plays `ping`. */
  test(): SoundOutcome;
}

/** Speaker state (FR-SHELL-24/25): muted or volume 0 first, then locked until an interaction. */
export function speakerState(s: Pick<AlertState, "settings" | "unlocked">): SpeakerState {
  if (isSilent(s.settings)) return "muted";
  return s.unlocked ? "on" : "locked";
}

/** Toast text "‹title› — ‹detail›" (FR-SHELL-22). */
export const alertText = (a: Pick<ShellAlert, "title" | "detail">) =>
  a.detail ? `${a.title} — ${a.detail}` : a.title;

export interface TitleDoc {
  readonly hidden: boolean;
  title: string;
}

/**
 * FR-SHELL-23: while the page is hidden an alert prefixes the title with "● ‹title› — "; a later
 * alert replaces the mark; `visible()` restores the original title.
 */
export function createTitleMarker(doc: TitleDoc) {
  let base: string | null = null;
  return {
    mark(alertTitle: string) {
      if (!doc.hidden) return;
      if (base === null) base = doc.title;
      doc.title = `● ${alertTitle} — ${base}`;
    },
    visible() {
      if (base === null) return;
      doc.title = base;
      base = null;
    },
  };
}
export type TitleMarker = ReturnType<typeof createTitleMarker>;

export function createAlertController(deps: {
  audio: AudioEngine;
  storage: SoundSettingsStorage;
  toast: (a: ShellAlert) => void;
  title: TitleMarker;
}): AlertController {
  const { audio, storage } = deps;
  const store = createStore<AlertState>()(() => ({
    flash: null,
    lastSound: "",
    soundCount: 0,
    settings: DEFAULT_SOUND_SETTINGS,
    unlocked: audio.unlocked,
  }));
  let owner: string | null = null;
  let flashKey = 0;
  const unlock = () => {
    audio.unlock();
    if (!store.getState().unlocked) store.setState({ unlocked: true });
  };
  return {
    store,
    alert(a) {
      flashKey += 1;
      const patch: Partial<AlertState> = { flash: { id: a.id, key: flashKey } };
      if (a.sound !== undefined) {
        const s = store.getState();
        const r = audio.play(a.sound, s.settings);
        const n = s.soundCount + 1;
        patch.soundCount = n;
        patch.lastSound = `${r.sound}:${r.outcome}:${n}`;
      }
      store.setState(patch);
      deps.toast(a);
      deps.title.mark(a.title);
    },
    flashEnded(key) {
      if (store.getState().flash?.key === key) store.setState({ flash: null });
    },
    unlock,
    setOwner(key) {
      if (key === owner) return;
      owner = key;
      store.setState({ settings: key ? storage.read(key) : DEFAULT_SOUND_SETTINGS });
    },
    setSettings(patch) {
      const settings = { ...store.getState().settings, ...patch };
      store.setState({ settings });
      if (owner) storage.write(owner, settings);
    },
    test() {
      unlock();
      return audio.play(DEFAULT_SOUND_ID, store.getState().settings).outcome;
    },
  };
}

export const FLASH_PULSE_MS = 1200;
export const FLASH_GLOW_MS = 1500;

/**
 * FR-SHELL-22 flash: two pulses over 1.2 s (≤ 3 flashes/s); `prefers-reduced-motion` → one
 * steady 1.5 s frame glow (short fades only, no flashing).
 */
export function flashAnimation(reducedMotion: boolean): {
  variant: "pulse" | "glow";
  keyframes: Keyframe[];
  duration: number;
} {
  if (reducedMotion) {
    return {
      variant: "glow",
      keyframes: [
        { opacity: 0 },
        { opacity: 1, offset: 0.1 },
        { opacity: 1, offset: 0.85 },
        { opacity: 0 },
      ],
      duration: FLASH_GLOW_MS,
    };
  }
  return {
    variant: "pulse",
    keyframes: [
      { opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { opacity: 0, offset: 0.45 },
      { opacity: 1, offset: 0.6 },
      { opacity: 0 },
    ],
    duration: FLASH_PULSE_MS,
  };
}

/** FR-SHELL-27: `data-test-last-sound` on `ui-topbar`, test mode only. */
export const testSoundAttr = (testMode: boolean, lastSound: string) =>
  testMode ? { "data-test-last-sound": lastSound } : {};
