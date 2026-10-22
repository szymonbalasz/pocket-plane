// Client sound list for alerts (FR-SHELL-26, ADR-0030). `ping` is synthesised with Web Audio: no
// file, no licence, no download (OQ-SHELL-12). *(Sprint 8, FR-SHELL-130)* Alerts play by **key**
// (`turn`, `request`, `pause`, `resume`), resolved through the campaign's picks: a DM-added sound
// (an audio asset, decoded once per page) or the key's default.
import {
  ALERT_DEFAULTS,
  ALERT_KEYS,
  type AlertKey,
  type AlertSoundPick,
  type AlertSounds,
} from "@shared/campaign-management/table-state";

/** The Web Audio surface a sound uses; a test passes a stub. */
export type SoundContext = Pick<
  BaseAudioContext,
  "currentTime" | "destination" | "createOscillator" | "createGain" | "createBufferSource"
>;

/** A started sound: its length (s) and a way to cut it short. */
export interface Playing {
  duration: number;
  stop(): void;
}

export interface Sound {
  id: string;
  label: string;
  /** Schedules the sound now. `gain` is the volume, 0–1. May throw (→ outcome `failed`). */
  play(ctx: SoundContext, gain: number): Playing;
}

export const DEFAULT_SOUND_ID = "ping";

/** Peak level of a full-volume ping; keeps it a short UI cue, not a chime. */
const PING_PEAK = 0.35;

/** One sine tone with a fast attack and an exponential decay. */
function tone(ctx: SoundContext, gain: number, freq: number, start: number, length: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, PING_PEAK * gain), start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env);
  env.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length);
  return osc;
}

/** Two short sine tones, rising; 0.33 s in total (≤ 400 ms, FR-SHELL-26). */
export const pingSound: Sound = {
  id: DEFAULT_SOUND_ID,
  label: "Ping",
  play(ctx, gain) {
    const t = ctx.currentTime;
    const oscs = [tone(ctx, gain, 880, t, 0.15), tone(ctx, gain, 1320, t + 0.13, 0.2)];
    return { duration: 0.33, stop: () => oscs.forEach(stopQuietly) };
  },
};

export const SOUNDS: readonly Sound[] = [pingSound];

/** The sound for `id`; unknown or missing → `ping` (FR-SHELL-26). */
export function resolveSound(id: string | undefined, sounds: readonly Sound[] = SOUNDS): Sound {
  return sounds.find((s) => s.id === id) ?? pingSound;
}

/** FR-SHELL-133: the client stops any source after 5 s (a lying header can't play longer). */
export const MAX_SOUND_S = 5;

/**
 * A decoded DM-added sound (FR-SHELL-131): buffer → its own gain (the volume) → destination,
 * stopped at 5 s at the latest.
 */
export function bufferSound(id: string, buffer: AudioBuffer): Sound {
  return {
    id,
    label: id,
    play(ctx, gain) {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      src.buffer = buffer;
      g.gain.setValueAtTime(gain, t);
      src.connect(g);
      g.connect(ctx.destination);
      src.start(t);
      src.stop(t + MAX_SOUND_S);
      return { duration: Math.min(buffer.duration, MAX_SOUND_S), stop: () => stopQuietly(src) };
    },
  };
}

function stopQuietly(node: { stop(): void }) {
  try {
    node.stop();
  } catch {
    // Already stopped.
  }
}

/** FR-SHELL-133: several due at once → one, by priority turn > request > resume > pause. */
const PRIORITY: readonly AlertKey[] = ["turn", "request", "resume", "pause"];

/** Higher wins; a plain sound id (e.g. the test window's `ping`) ranks below every key. */
export const soundPriority = (key: string): number => {
  const i = PRIORITY.indexOf(key as AlertKey);
  return i < 0 ? 0 : PRIORITY.length - i;
};

export const isAlertKey = (s: string): s is AlertKey =>
  (ALERT_KEYS as readonly string[]).includes(s);

/** What a key plays (FR-SHELL-130): its pick, else the default (turn / request ping, others none). */
export function resolvePick(key: AlertKey, picks: AlertSounds): AlertSoundPick | "ping" {
  return picks[key] ?? ALERT_DEFAULTS[key];
}

/** The picked asset IDs (to preload, FR-SHELL-131). */
export const pickedAssetIds = (picks: AlertSounds): string[] => [
  ...new Set(
    ALERT_KEYS.map((k) => picks[k]).filter((p): p is string => p !== undefined && p !== "none"),
  ),
];

/** Labels for the key Selects (players' Sound section, the DM's Alert sounds rows). */
export const ALERT_LABELS: Record<AlertKey, string> = {
  turn: "Your turn",
  request: "Roll request",
  pause: "Pause",
  resume: "Resume",
};
