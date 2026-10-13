import { describe, expect, test } from "bun:test";
import {
  createAlertController,
  createTitleMarker,
  flashAnimation,
  type ShellAlert,
  speakerState,
  testSoundAttr,
  toastRegion,
} from "./alerts";
import { type AudioContextLike, createAudioEngine } from "./audio";
import {
  createSoundSettingsStorage,
  DEFAULT_SOUND_SETTINGS,
  type SoundSettings,
  soundKey,
} from "./sound-settings";
import { resolveSound } from "./sounds";
import type { StorageBackend } from "./storage";

/** Stub AudioContext: records oscillator starts; `fail` makes node creation throw. */
function stubAudio(opts: { state?: AudioContextState; fail?: boolean } = {}) {
  const starts: number[] = [];
  let resumed = 0;
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const node = { connect() {} };
  const ctx = {
    state: opts.state ?? "suspended",
    currentTime: 0,
    destination: {},
    resume: async () => {
      resumed += 1;
    },
    createOscillator() {
      if (opts.fail) throw new Error("no audio device");
      return {
        ...node,
        type: "sine",
        frequency: param,
        start: (t: number) => starts.push(t),
        stop() {},
      };
    },
    createGain: () => ({ ...node, gain: param }),
  };
  // Structural stub for the Web Audio surface the sound uses; not a full AudioContext.
  return { ctx: ctx as unknown as AudioContextLike, starts, resumed: () => resumed };
}

function memoryBackend(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const backend: StorageBackend = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
  return { data, backend };
}

function setup(
  over: { create?: () => AudioContextLike | null; backend?: StorageBackend; hidden?: boolean } = {},
) {
  const warnings: string[] = [];
  const toasts: ShellAlert[] = [];
  const audio = createAudioEngine({
    create: over.create ?? (() => stubAudio().ctx),
    warn: (m) => warnings.push(m),
  });
  const storage = createSoundSettingsStorage(
    () => over.backend ?? memoryBackend().backend,
    (m) => warnings.push(m),
  );
  const doc = { hidden: over.hidden ?? false, title: "Pocket Plane" };
  const c = createAlertController({
    audio,
    storage,
    toast: (a) => toasts.push(a),
    title: createTitleMarker(doc),
  });
  return { c, warnings, toasts, doc };
}

const PING: ShellAlert = { id: "shell.test", title: "Test alert", sound: "ping" };

describe("alerts", () => {
  test("FR-SHELL-22 alert → flash + Toast; same id while flashing restarts it, no stacking", () => {
    const { c, toasts } = setup();
    c.alert({ id: "cbt.turn", title: "Your turn", detail: "Mira" });
    const first = c.store.getState().flash;
    expect(first?.id).toBe("cbt.turn");
    c.alert({ id: "cbt.turn", title: "Your turn", detail: "Mira" });
    const second = c.store.getState().flash;
    expect(second?.id).toBe("cbt.turn");
    expect(second?.key).not.toBe(first?.key); // new key → animation restarts
    expect(toasts.map((t) => t.title)).toEqual(["Your turn", "Your turn"]);
    // The old flash's end doesn't clear the restarted one; its own end does.
    c.flashEnded(first?.key ?? -1);
    expect(c.store.getState().flash).toEqual(second);
    c.flashEnded(second?.key ?? -1);
    expect(c.store.getState().flash).toBeNull();
  });

  test("FR-SHELL-22 flash: two pulses over 1.2 s (≤ 3/s); reduced motion → one steady 1.5 s glow", () => {
    const pulse = flashAnimation(false);
    expect(pulse.variant).toBe("pulse");
    expect(pulse.duration).toBe(1200);
    const peaks = pulse.keyframes.filter((k) => k.opacity === 1).length;
    expect(peaks).toBe(2);
    expect(peaks / (pulse.duration / 1000)).toBeLessThanOrEqual(3);
    const glow = flashAnimation(true);
    expect(glow.variant).toBe("glow");
    expect(glow.duration).toBe(1500);
    // Steady: once up, it never dips until the final fade.
    const ops = glow.keyframes.map((k) => k.opacity);
    expect(ops).toEqual([0, 1, 1, 0]);
  });

  test("FR-SHELL-23 hidden page → title mark; a later alert replaces it; visible → original", () => {
    const { c, doc } = setup({ hidden: true });
    c.alert({ id: "a", title: "Your turn" });
    expect(doc.title).toBe("● Your turn — Pocket Plane");
    c.alert({ id: "b", title: "Again" });
    expect(doc.title).toBe("● Again — Pocket Plane");
  });

  test("FR-SHELL-23 visible page → no title mark; visible() restores the original", () => {
    const doc = { hidden: false, title: "Pocket Plane" };
    const m = createTitleMarker(doc);
    m.mark("Your turn");
    expect(doc.title).toBe("Pocket Plane");
    const hiddenDoc = { hidden: true, title: "Pocket Plane" };
    const m2 = createTitleMarker(hiddenDoc);
    m2.mark("Your turn");
    expect(hiddenDoc.title).toBe("● Your turn — Pocket Plane");
    m2.visible();
    expect(hiddenDoc.title).toBe("Pocket Plane");
    m2.visible(); // idempotent
    expect(hiddenDoc.title).toBe("Pocket Plane");
  });

  test("FR-SHELL-25 locked before the first interaction (flash + Toast only), then played", () => {
    const audio = stubAudio({ state: "suspended" });
    const { c, toasts } = setup({ create: () => audio.ctx });
    expect(speakerState(c.store.getState())).toBe("locked");
    c.alert(PING);
    expect(c.store.getState().lastSound).toBe("ping:locked:1");
    expect(c.store.getState().flash).not.toBeNull();
    expect(toasts).toHaveLength(1);
    expect(audio.starts).toHaveLength(0);
    c.unlock(); // first pointerdown / keydown
    expect(audio.resumed()).toBe(1);
    expect(speakerState(c.store.getState())).toBe("on");
    c.alert(PING);
    expect(c.store.getState().lastSound).toBe("ping:played:2");
    expect(audio.starts).toHaveLength(2); // two tones
    c.unlock(); // only the first interaction counts
    expect(audio.resumed()).toBe(1);
  });

  test("FR-SHELL-25 muted or volume 0 → no sound; speaker shows muted", () => {
    const audio = stubAudio();
    const { c } = setup({ create: () => audio.ctx });
    c.unlock();
    c.setSettings({ muted: true });
    expect(speakerState(c.store.getState())).toBe("muted");
    c.alert(PING);
    expect(c.store.getState().lastSound).toBe("ping:muted:1");
    c.setSettings({ muted: false, volume: 0 });
    expect(speakerState(c.store.getState())).toBe("muted");
    c.alert(PING);
    expect(c.store.getState().lastSound).toBe("ping:muted:2");
    expect(audio.starts).toHaveLength(0);
  });

  test("FR-SHELL-25 throwing sound or no Web Audio → failed, flash + Toast, one console warning", () => {
    const broken = setup({ create: () => stubAudio({ fail: true }).ctx });
    broken.c.unlock();
    broken.c.alert(PING);
    broken.c.alert(PING);
    expect(broken.c.store.getState().lastSound).toBe("ping:failed:2");
    expect(broken.c.store.getState().flash).not.toBeNull();
    expect(broken.toasts).toHaveLength(2);
    expect(broken.warnings).toHaveLength(1);

    const none = setup({ create: () => null });
    none.c.unlock();
    none.c.alert(PING);
    expect(none.c.store.getState().lastSound).toBe("ping:failed:1");
    const throwing = setup({
      create: () => {
        throw new Error("blocked");
      },
    });
    throwing.c.unlock();
    throwing.c.alert(PING);
    throwing.c.alert(PING);
    expect(throwing.c.store.getState().lastSound).toBe("ping:failed:2");
    expect(throwing.warnings).toHaveLength(1);
  });

  test("FR-SHELL-26 unknown sound id → ping; no sound id → no sound, n unchanged", () => {
    expect(resolveSound("fanfare").id).toBe("ping");
    expect(resolveSound(undefined).id).toBe("ping");
    const audio = stubAudio();
    const { c } = setup({ create: () => audio.ctx });
    c.unlock();
    c.alert({ id: "x", title: "X", sound: "fanfare" });
    expect(c.store.getState().lastSound).toBe("ping:played:1");
    c.alert({ id: "y", title: "Y" });
    expect(c.store.getState().lastSound).toBe("ping:played:1");
    expect(c.store.getState().soundCount).toBe(1);
  });

  test("FR-SHELL-26 ping: two short tones, ≤ 400 ms", () => {
    const audio = stubAudio();
    const stops: number[] = [];
    const ctx = {
      ...audio.ctx,
      currentTime: 0,
      createGain: audio.ctx.createGain,
      destination: audio.ctx.destination,
      createOscillator: () => ({
        ...audio.ctx.createOscillator(),
        stop: (t: number) => stops.push(t),
      }),
    } as unknown as AudioContextLike; // structural stub, as above
    resolveSound("ping").play(ctx, 0.7);
    expect(stops).toHaveLength(2);
    expect(Math.max(...stops)).toBeLessThanOrEqual(0.4);
  });

  test("FR-SHELL-24 Test button counts as an interaction and plays ping (no alert counted)", () => {
    const audio = stubAudio();
    const { c } = setup({ create: () => audio.ctx });
    expect(c.test()).toBe("played");
    expect(c.store.getState().unlocked).toBe(true);
    expect(c.store.getState().lastSound).toBe("");
    c.setSettings({ muted: true });
    expect(c.test()).toBe("muted");
  });

  test("FR-SHELL-27 data-test-last-sound only in test mode", () => {
    expect(testSoundAttr(true, "ping:played:1")).toEqual({
      "data-test-last-sound": "ping:played:1",
    });
    expect(testSoundAttr(false, "ping:played:1")).toEqual({});
  });

  test("FR-SHELL-01 toast region: DM top-centre below the top bar, player bottom-right", () => {
    expect(toastRegion("dm", 48, 12)).toEqual({ position: "top-center", top: 60 });
    expect(toastRegion("player", 48, 12)).toEqual({ position: "bottom-right" });
  });
});

describe("sound settings", () => {
  const KEY = soundKey("c1", "p1");

  test("FR-SHELL-24 key per (campaign, player); defaults unmuted, 70; changes written", () => {
    expect(KEY).toBe("pp.sound.v1.c1.p1");
    const { data, backend } = memoryBackend();
    const { c } = setup({ backend });
    c.setOwner(KEY);
    expect(c.store.getState().settings).toEqual({ muted: false, volume: 70 });
    c.setSettings({ volume: 40 });
    c.setSettings({ muted: true });
    expect(JSON.parse(data.get(KEY) ?? "")).toEqual({ muted: true, volume: 40 });
    // Another player's entry is separate.
    c.setOwner(soundKey("c1", "p2"));
    expect(c.store.getState().settings).toEqual(DEFAULT_SOUND_SETTINGS);
    c.setOwner(KEY);
    expect(c.store.getState().settings).toEqual({ muted: true, volume: 40 });
  });

  test("FR-SHELL-24 DM (no owner): defaults in memory, nothing written", () => {
    const { data, backend } = memoryBackend();
    const { c } = setup({ backend });
    c.setOwner(null);
    c.setSettings({ volume: 10 });
    expect(c.store.getState().settings.volume).toBe(10);
    expect(data.size).toBe(0);
  });

  test("FR-SHELL-24 bad JSON or volume 101 → defaults + warning", () => {
    const cases: string[] = [
      "{not json",
      JSON.stringify({ muted: false, volume: 101 }),
      JSON.stringify({ muted: "no", volume: 40 }),
      JSON.stringify({ volume: 40 }),
    ];
    for (const text of cases) {
      const warnings: string[] = [];
      const s = createSoundSettingsStorage(
        () => memoryBackend({ [KEY]: text }).backend,
        (m) => warnings.push(m),
      );
      expect(s.read(KEY)).toEqual(DEFAULT_SOUND_SETTINGS);
      expect(warnings).toHaveLength(1);
    }
  });

  test("FR-SHELL-24 throwing storage → settings kept in memory, one warning", () => {
    const warnings: string[] = [];
    const s = createSoundSettingsStorage(
      () => {
        throw new Error("SecurityError");
      },
      (m) => warnings.push(m),
    );
    expect(s.read(KEY)).toEqual(DEFAULT_SOUND_SETTINGS);
    const muted: SoundSettings = { muted: true, volume: 40 };
    s.write(KEY, muted);
    expect(s.read(KEY)).toEqual(muted);
    expect(warnings).toHaveLength(1);
  });
});
