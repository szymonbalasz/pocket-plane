// Alert surface (FR-SHELL-22–27): flash + Toast + sound + title mark, client-side only. Features
// call `useShellAlert()` (ShellContext) in reaction to events the client already received; the
// shell adds no event, intent or record. Pure controller with injected browser parts.
// *(Sprint 8, FR-SHELL-130–134)* Sounds play by alert key through the campaign's picks; one at a
// time, several due at once → the highest priority (turn > request > resume > pause).
import type {
  AlertKey,
  AlertSoundPick,
  AlertSounds,
} from "@shared/campaign-management/table-state";
import { createStore, type StoreApi } from "zustand";
import type { AudioEngine, SoundOutcome } from "./audio";
import {
  DEFAULT_SOUND_SETTINGS,
  isSilent,
  type SoundSettings,
  type SoundSettingsStorage,
} from "./sound-settings";
import { soundPriority } from "./sounds";

export interface ShellAlert {
  /** Same id while its flash runs → the flash restarts; no stacking. */
  id: string;
  title: string;
  detail?: string;
  /**
   * Alert key (FR-SHELL-130: `turn`, `request`, `pause`, `resume`) or a plain sound id
   * (FR-SHELL-26, unknown → `ping`); omitted → no sound.
   */
  sound?: AlertKey | (string & {});
  /** FR-SHELL-134: false = no flash (Toast and sound only). Default true. */
  flash?: boolean;
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
  /** FR-SHELL-134: the sound alone (no flash, Toast or title mark), e.g. a prompt at resume. */
  alertSound(key: AlertKey | (string & {})): void;
  /** FR-SHELL-130, -131: the campaign's picks (`campaign.alertSounds`); preloads new ones. */
  setPicks(picks: AlertSounds): void;
  /** The flash with `key` finished; a newer one is left alone. */
  flashEnded(key: number): void;
  /** First `pointerdown` / `keydown` anywhere on the page (FR-SHELL-25). */
  unlock(): void;
  /** Sound settings owner: the player's key, or null (DM: defaults, in memory). */
  setOwner(key: string | null): void;
  setSettings(patch: Partial<SoundSettings>): void;
  /**
   * The Sound section's Test (FR-SHELL-132): counts as an interaction, plays `key`'s sound (default
   * `turn`) as an alert would, but not counted. null = the key is silent.
   */
  test(key?: AlertKey): SoundOutcome | null;
  /** The DM's Test ▶ (FR-CAMP-49): `pick` for `key`, loaded first if needed. null = silent. */
  preview(key: AlertKey, pick: AlertSoundPick | "default"): Promise<SoundOutcome | null>;
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
  /** The sound that won this task (FR-SHELL-133 "due at once"); cleared in a microtask. */
  let winner: string | null = null;
  const unlock = () => {
    audio.unlock();
    if (!store.getState().unlocked) store.setState({ unlocked: true });
  };
  /**
   * FR-SHELL-133: a sound due while another plays → `skipped`; several in one task → the highest
   * priority (a later, higher one cuts the earlier; a lower one is dropped and not recorded, so
   * `lastSound` shows the winner). Silent keys record nothing.
   */
  const sound = (key: string) => {
    const s = store.getState();
    const sameTask = winner !== null;
    if (sameTask && soundPriority(key) <= soundPriority(winner as string)) return;
    const r = audio.play(key, s.settings, { replace: sameTask });
    if (!r) return;
    const n = s.soundCount + 1;
    store.setState({ soundCount: n, lastSound: `${r.sound}:${r.outcome}:${n}` });
    if (r.outcome === "played" || r.outcome === "fallback") {
      if (winner === null) queueMicrotask(() => (winner = null));
      winner = key;
    }
  };
  return {
    store,
    alert(a) {
      if (a.flash !== false) {
        flashKey += 1;
        store.setState({ flash: { id: a.id, key: flashKey } });
      }
      if (a.sound !== undefined) sound(a.sound);
      deps.toast(a);
      deps.title.mark(a.title);
    },
    alertSound: sound,
    setPicks: (picks) => audio.setPicks(picks),
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
    test(key = "turn") {
      unlock();
      return audio.play(key, store.getState().settings, { force: true })?.outcome ?? null;
    },
    preview(key, pick) {
      unlock();
      return audio.preview(key, pick, store.getState().settings);
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
