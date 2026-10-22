// Alert audio (FR-SHELL-25, ADR-0030): one shared Web Audio context per page, unlocked by the
// first `pointerdown` / `keydown`. Browsers block audio before a user gesture, so the context is
// made (or resumed) inside that gesture; until then an alert is flash + Toast only.
// *(Sprint 8, FR-SHELL-130–133)* Alert keys resolve through the campaign's picks; picked sounds
// are fetched and decoded once per asset ID at idle (`decodeAudioData`), broken or not-ready ones
// play the ping; one sound at a time; a source stops at 5 s.
import { audioPath } from "@shared/assets-pipeline/audio";
import type {
  AlertKey,
  AlertSoundPick,
  AlertSounds,
} from "@shared/campaign-management/table-state";
import { isSilent, type SoundSettings } from "./sound-settings";
import {
  bufferSound,
  isAlertKey,
  type Playing,
  pickedAssetIds,
  pingSound,
  resolvePick,
  resolveSound,
  SOUNDS,
  type Sound,
  type SoundContext,
} from "./sounds";

/**
 * `<sound>:<outcome>` per alert (FR-SHELL-27, -134): `skipped` = another sound was playing,
 * `fallback` = the picked sound wasn't ready or didn't decode, so the ping played.
 */
export type SoundOutcome = "played" | "muted" | "locked" | "failed" | "skipped" | "fallback";

export interface AudioContextLike extends SoundContext {
  readonly state: AudioContextState;
  resume(): Promise<void>;
}

export interface SoundResult {
  /** The key, or the resolved sound id for a plain id. */
  sound: string;
  outcome: SoundOutcome;
}

export interface AudioEngine {
  /** True after the first interaction. */
  readonly unlocked: boolean;
  /** First `pointerdown` / `keydown` (or the Test button): makes / resumes the context. */
  unlock(): void;
  /**
   * Plays an alert key (via the picks) or a plain sound id (unknown → `ping`) at the settings'
   * volume; never throws. null = the key is silent (`none`, or pause / resume by default).
   * `replace` cuts the playing sound (a higher priority due at once, FR-SHELL-133); otherwise a
   * sound due while another plays is `skipped`. `force` (Test buttons) ignores the playing one.
   */
  play(
    sound: string,
    settings: SoundSettings,
    opts?: { replace?: boolean; force?: boolean },
  ): SoundResult | null;
  /** FR-SHELL-130, -131: the campaign's picks; new picked sounds preload at idle. */
  setPicks(picks: AlertSounds): void;
  /**
   * The DM's Test ▶ (FR-CAMP-49): plays `pick` for `key` now (loading it first if needed);
   * counts as an interaction. null = silent.
   */
  preview(
    key: AlertKey,
    pick: AlertSoundPick | "default",
    settings: SoundSettings,
  ): Promise<SoundOutcome | null>;
}

type Cached =
  | { state: "loading"; done: Promise<void> }
  | { state: "ready"; sound: Sound }
  | {
      state: "failed";
    };

export interface AudioEngineOptions {
  /** The shared context; null = no Web Audio. May throw (→ treated as no Web Audio). */
  create: () => AudioContextLike | null;
  warn?: (msg: string, err?: unknown) => void;
  sounds?: readonly Sound[];
  /** A picked sound's bytes (`GET /api/assets/:id/audio`). */
  fetchSound?: (assetId: string) => Promise<ArrayBuffer>;
  /** `decodeAudioData`, usable before the context exists (an offline context). */
  decode?: (data: ArrayBuffer) => Promise<AudioBuffer>;
  /** Runs `fn` when the page is idle (preload, FR-SHELL-131). */
  idle?: (fn: () => void) => void;
}

export function createAudioEngine(opts: AudioEngineOptions): AudioEngine {
  const warnFn = opts.warn ?? ((m, e) => console.warn(m, e));
  let warned = false;
  // One console warning per page, however often audio fails (FR-SHELL-25).
  const warn = (msg: string, err?: unknown) => {
    if (!warned) warnFn(`play-shell: ${msg}; alerts show without sound`, err);
    warned = true;
  };
  let loadWarned = false;
  // One warning per page for picked sounds that won't load (FR-SHELL-131); never the ID.
  const warnLoad = (err: unknown) => {
    if (!loadWarned)
      warnFn("play-shell: an alert sound failed to load; the ping plays instead", err);
    loadWarned = true;
  };
  const fetchSound = opts.fetchSound ?? browserFetchSound;
  const decode = opts.decode ?? browserDecode;
  const idle = opts.idle ?? browserIdle;
  let unlocked = false;
  let ctx: AudioContextLike | null = null;
  let picks: AlertSounds = {};
  const cache = new Map<string, Cached>();
  let current: { playing: Playing; endsAt: number } | null = null;

  function load(id: string): Promise<void> {
    const hit = cache.get(id);
    if (hit?.state === "loading") return hit.done;
    if (hit?.state === "ready") return Promise.resolve();
    const done = fetchSound(id)
      .then(decode)
      .then(
        (buffer) => {
          cache.set(id, { state: "ready", sound: bufferSound(id, buffer) });
        },
        (err: unknown) => {
          cache.set(id, { state: "failed" });
          warnLoad(err);
        },
      );
    cache.set(id, { state: "loading", done });
    return done;
  }

  /** The sound a key / plain id plays now, or null (silent); `fallback` when the pick isn't ready. */
  function resolve(sound: string): { sound: Sound; fallback: boolean } | null {
    if (!isAlertKey(sound))
      return { sound: resolveSound(sound, opts.sounds ?? SOUNDS), fallback: false };
    return resolvePickNow(resolvePick(sound, picks));
  }

  function resolvePickNow(
    pick: AlertSoundPick | "ping",
  ): { sound: Sound; fallback: boolean } | null {
    if (pick === "none") return null;
    if (pick === "ping") return { sound: pingSound, fallback: false };
    const hit = cache.get(pick);
    if (hit?.state === "ready") return { sound: hit.sound, fallback: false };
    if (!hit) void load(pick); // a pick we haven't seen: load it for next time
    return { sound: pingSound, fallback: true };
  }

  const busy = () => current !== null && ctx !== null && ctx.currentTime < current.endsAt;

  function start(s: Sound, settings: SoundSettings): Playing {
    const c = ctx as AudioContextLike;
    const playing = s.play(c, settings.volume / 100);
    current = { playing, endsAt: c.currentTime + playing.duration };
    return playing;
  }

  function unlock() {
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
  }

  return {
    get unlocked() {
      return unlocked;
    },
    unlock,
    play(sound, settings, o = {}) {
      const r = resolve(sound);
      if (!r) return null;
      const name = isAlertKey(sound) ? sound : r.sound.id;
      const out = (outcome: SoundOutcome) => ({ sound: name, outcome });
      if (isSilent(settings)) return out("muted");
      if (!unlocked) return out("locked");
      if (!ctx) {
        warn("Web Audio unavailable");
        return out("failed");
      }
      if (busy()) {
        if (!o.replace && !o.force) return out("skipped");
        current?.playing.stop();
      }
      try {
        start(r.sound, settings);
        return out(r.fallback ? "fallback" : "played");
      } catch (err) {
        warn(`sound "${r.sound.id}" failed`, err);
        return out("failed");
      }
    },
    setPicks(next) {
      picks = next;
      const ids = pickedAssetIds(next).filter((id) => {
        const hit = cache.get(id);
        return !hit || hit.state === "failed";
      });
      for (const id of ids) cache.delete(id);
      if (ids.length > 0) idle(() => ids.forEach((id) => void load(id)));
    },
    async preview(key, pick, settings) {
      unlock();
      const p = pick === "default" ? resolvePick(key, {}) : pick;
      if (p !== "none" && p !== "ping") {
        if (cache.get(p)?.state === "failed") cache.delete(p);
        await load(p);
      }
      const r = resolvePickNow(p);
      if (!r) return null;
      if (isSilent(settings)) return "muted";
      if (!ctx) {
        warn("Web Audio unavailable");
        return "failed";
      }
      current?.playing.stop();
      try {
        start(r.sound, settings);
        return r.fallback ? "fallback" : "played";
      } catch (err) {
        warn(`sound "${r.sound.id}" failed`, err);
        return "failed";
      }
    },
  };
}

/** The page's `AudioContext`, or null where Web Audio is missing. */
export const browserAudioContext = (): AudioContextLike | null =>
  typeof AudioContext === "undefined" ? null : new AudioContext();

/** The capability URL (ADR-0023): no credential; players learn the ID only as a pick. */
async function browserFetchSound(assetId: string): Promise<ArrayBuffer> {
  const res = await fetch(audioPath(assetId));
  if (!res.ok) throw new Error(`sound fetch ${res.status}`);
  return res.arrayBuffer();
}

let offline: OfflineAudioContext | null = null;

/** Decodes without the page's context (it may not exist before the first interaction). */
function browserDecode(data: ArrayBuffer): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === "undefined") {
    return Promise.reject(new Error("Web Audio unavailable"));
  }
  offline ??= new OfflineAudioContext(1, 1, 44_100);
  return offline.decodeAudioData(data);
}

function browserIdle(fn: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn());
  else setTimeout(fn, 1);
}
