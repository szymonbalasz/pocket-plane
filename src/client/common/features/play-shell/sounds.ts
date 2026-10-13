// Client sound list for alerts (FR-SHELL-26, ADR-0030). MVP ships `ping`, synthesised with Web
// Audio: no file, no licence, no download (OQ-SHELL-12). Tier A (design only): DM-added sounds
// become more entries here, backed by small audio assets; callers keep passing a sound id.

/** The Web Audio surface a sound uses; a test passes a stub. */
export type SoundContext = Pick<
  BaseAudioContext,
  "currentTime" | "destination" | "createOscillator" | "createGain"
>;

export interface Sound {
  id: string;
  label: string;
  /** Schedules the sound now. `gain` is the volume, 0–1. May throw (→ outcome `failed`). */
  play(ctx: SoundContext, gain: number): void;
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
}

/** Two short sine tones, rising; 0.33 s in total (≤ 400 ms, FR-SHELL-26). */
export const pingSound: Sound = {
  id: DEFAULT_SOUND_ID,
  label: "Ping",
  play(ctx, gain) {
    const t = ctx.currentTime;
    tone(ctx, gain, 880, t, 0.15);
    tone(ctx, gain, 1320, t + 0.13, 0.2);
  },
};

export const SOUNDS: readonly Sound[] = [pingSound];

/** The sound for `id`; unknown or missing → `ping` (FR-SHELL-26). */
export function resolveSound(id: string | undefined, sounds: readonly Sound[] = SOUNDS): Sound {
  return sounds.find((s) => s.id === id) ?? pingSound;
}
