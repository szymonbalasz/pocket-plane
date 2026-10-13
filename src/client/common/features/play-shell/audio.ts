// Alert audio (FR-SHELL-25, ADR-0030): one shared Web Audio context per page, unlocked by the
// first `pointerdown` / `keydown`. Browsers block audio before a user gesture, so the context is
// made (or resumed) inside that gesture; until then an alert is flash + Toast only.
import { isSilent, type SoundSettings } from "./sound-settings";
import { resolveSound, SOUNDS, type Sound, type SoundContext } from "./sounds";

/** `<sound>:<outcome>` per alert (FR-SHELL-27). */
export type SoundOutcome = "played" | "muted" | "locked" | "failed";

export interface AudioContextLike extends SoundContext {
  readonly state: AudioContextState;
  resume(): Promise<void>;
}

export interface AudioEngine {
  /** True after the first interaction. */
  readonly unlocked: boolean;
  /** First `pointerdown` / `keydown` (or the Test button): makes / resumes the context. */
  unlock(): void;
  /** Plays `soundId` (unknown → `ping`) at the settings' volume; never throws. */
  play(
    soundId: string | undefined,
    settings: SoundSettings,
  ): { sound: string; outcome: SoundOutcome };
}

export function createAudioEngine(opts: {
  /** The shared context; null = no Web Audio. May throw (→ treated as no Web Audio). */
  create: () => AudioContextLike | null;
  warn?: (msg: string, err?: unknown) => void;
  sounds?: readonly Sound[];
}): AudioEngine {
  const warnFn = opts.warn ?? ((m, e) => console.warn(m, e));
  let warned = false;
  // One console warning per page, however often audio fails (FR-SHELL-25).
  const warn = (msg: string, err?: unknown) => {
    if (!warned) warnFn(`play-shell: ${msg}; alerts show without sound`, err);
    warned = true;
  };
  let unlocked = false;
  let ctx: AudioContextLike | null = null;
  return {
    get unlocked() {
      return unlocked;
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      try {
        ctx = opts.create();
      } catch (err) {
        warn("Web Audio unavailable", err);
        return;
      }
      if (ctx?.state === "suspended") {
        ctx.resume().catch((err: unknown) => warn("audio resume failed", err));
      }
    },
    play(soundId, settings) {
      const sound = resolveSound(soundId, opts.sounds ?? SOUNDS);
      const out = (outcome: SoundOutcome) => ({ sound: sound.id, outcome });
      if (isSilent(settings)) return out("muted");
      if (!unlocked) return out("locked");
      if (!ctx) {
        warn("Web Audio unavailable");
        return out("failed");
      }
      try {
        sound.play(ctx, settings.volume / 100);
        return out("played");
      } catch (err) {
        warn(`sound "${sound.id}" failed`, err);
        return out("failed");
      }
    },
  };
}

/** The page's `AudioContext`, or null where Web Audio is missing. */
export const browserAudioContext = (): AudioContextLike | null =>
  typeof AudioContext === "undefined" ? null : new AudioContext();
