// Sprint 8 TT3: alert keys, picks, preload, mute, one sound at a time (FR-SHELL-130–134).
import { describe, expect, test } from "bun:test";
import type { AlertSounds } from "@shared/campaign-management/table-state";
import { renderToStaticMarkup } from "react-dom/server";
import { SoundControls } from "./AlertLayer";
import { createAlertController, createTitleMarker, type ShellAlert } from "./alerts";
import { type AudioContextLike, createAudioEngine } from "./audio";
import { createSoundSettingsStorage } from "./sound-settings";
import { MAX_SOUND_S } from "./sounds";

const CHIME = "C".repeat(22);
const GONG = "G".repeat(22);

/** Structural Web Audio stub: a settable clock; records what started and stopped. */
function stubCtx() {
  const log: string[] = [];
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const ctx = {
    state: "running" as AudioContextState,
    currentTime: 0,
    destination: {},
    resume: async () => {},
    createGain: () => ({ connect() {}, gain: param }),
    createOscillator: () => ({
      connect() {},
      type: "sine",
      frequency: param,
      start: () => log.push("osc"),
      stop: (t?: number) => {
        if (t === undefined) log.push("osc-cut");
      },
    }),
    createBufferSource() {
      const src = {
        buffer: null as { label?: string } | null,
        connect() {},
        start: () => log.push(`buffer:${src.buffer?.label}`),
        stop: (t?: number) => log.push(t === undefined ? "buffer-cut" : `buffer-stop@${t}`),
      };
      return src;
    },
  };
  return { ctx, log };
}

function setup(o: { decodeFails?: boolean; fetchHangs?: boolean } = {}) {
  const { ctx, log } = stubCtx();
  const fetched: string[] = [];
  const warnings: string[] = [];
  const toasts: ShellAlert[] = [];
  const idle: (() => void)[] = [];
  const audio = createAudioEngine({
    // Structural stub, not a full AudioContext.
    create: () => ctx as unknown as AudioContextLike,
    warn: (m) => warnings.push(m),
    fetchSound: (id) => {
      fetched.push(id);
      return o.fetchHangs
        ? new Promise(() => {})
        : Promise.resolve(new TextEncoder().encode(id).buffer as ArrayBuffer);
    },
    decode: (data) =>
      o.decodeFails
        ? Promise.reject(new Error("EncodingError"))
        : Promise.resolve({
            duration: 0.4,
            label: new TextDecoder().decode(data).slice(0, 1),
          } as unknown as AudioBuffer),
    idle: (fn) => idle.push(fn),
  });
  const c = createAlertController({
    audio,
    storage: createSoundSettingsStorage(
      () => {
        throw new Error("no storage in tests");
      },
      () => {},
    ),
    toast: (a) => toasts.push(a),
    title: createTitleMarker({ hidden: false, title: "" }),
  });
  const runIdle = async () => {
    for (const fn of idle.splice(0)) fn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const last = () => c.store.getState().lastSound;
  const tick = () => new Promise<void>((r) => queueMicrotask(r));
  return { c, ctx, log, fetched, warnings, toasts, runIdle, last, tick };
}

describe("alert sounds (FR-SHELL-130–134)", () => {
  test("FR-SHELL-130 alert keys: defaults turn / request ping, pause / resume silent; a pick plays its sound; none is silent", async () => {
    const t = setup();
    t.c.unlock();
    t.c.alertSound("turn");
    expect(t.last()).toBe("turn:played:1");
    expect(t.log).toEqual(["osc", "osc"]);
    await t.tick(); // a later task (same-task sounds compete, FR-SHELL-133)
    t.ctx.currentTime = 10;
    t.c.alertSound("request");
    expect(t.last()).toBe("request:played:2");
    for (const k of ["pause", "resume"] as const) t.c.alertSound(k);
    expect([t.last(), t.c.store.getState().soundCount]).toEqual(["request:played:2", 2]);

    const picks: AlertSounds = { turn: CHIME, request: "none", pause: GONG };
    t.c.setPicks(picks);
    await t.runIdle();
    t.log.length = 0;
    await t.tick();
    t.ctx.currentTime = 20;
    t.c.alertSound("turn");
    expect([t.last(), t.log]).toEqual([
      "turn:played:3",
      ["buffer:C", `buffer-stop@${20 + MAX_SOUND_S}`],
    ]);
    await t.tick();
    t.ctx.currentTime = 30;
    t.c.alertSound("request"); // none → silent, nothing recorded
    t.c.alertSound("pause");
    expect(t.last()).toBe("pause:played:4");
    expect(t.log.at(-2)).toBe("buffer:G");
  });

  test("FR-SHELL-131 preload: each pick fetched and decoded once at idle; not ready or undecodable → ping + one warning", async () => {
    const t = setup();
    t.c.unlock();
    t.c.setPicks({ turn: CHIME, request: CHIME });
    expect(t.fetched).toEqual([]); // waits for idle
    await t.runIdle();
    t.c.setPicks({ turn: CHIME, request: CHIME, resume: "none" });
    await t.runIdle();
    expect(t.fetched).toEqual([CHIME]);
    // A new pick preloads; until it's ready the ping plays (`fallback`).
    t.c.setPicks({ turn: GONG });
    t.c.alertSound("turn");
    expect(t.last()).toBe("turn:fallback:1");
    expect(t.log).toEqual(["osc", "osc"]);
    await t.runIdle();
    expect(t.fetched).toEqual([CHIME, GONG]);

    const hang = setup({ fetchHangs: true });
    hang.c.unlock();
    hang.c.setPicks({ request: CHIME });
    await hang.runIdle();
    hang.c.alertSound("request");
    expect(hang.last()).toBe("request:fallback:1");

    const broken = setup({ decodeFails: true });
    broken.c.unlock();
    broken.c.setPicks({ turn: CHIME, request: GONG });
    await broken.runIdle();
    broken.c.alertSound("turn");
    expect(broken.last()).toBe("turn:fallback:1");
    expect(broken.warnings).toHaveLength(1);
    expect(broken.warnings[0]).not.toContain(CHIME); // the ID is a capability
  });

  test("FR-SHELL-132 mute wins: muted, volume 0 or locked → nothing plays for any key; Test plays the chosen key", async () => {
    const t = setup();
    t.c.setPicks({ turn: CHIME, pause: CHIME });
    await t.runIdle();
    t.c.alertSound("turn");
    expect(t.last()).toBe("turn:locked:1");
    t.c.unlock();
    t.c.setSettings({ muted: true });
    for (const k of ["turn", "request", "pause"] as const) t.c.alertSound(k);
    expect(t.last()).toBe("pause:muted:4");
    t.c.setSettings({ muted: false, volume: 0 });
    t.c.alertSound("request");
    expect(t.last()).toBe("request:muted:5");
    expect(t.log).toEqual([]);
    expect(t.c.test("pause")).toBe("muted");
    t.c.setSettings({ volume: 60 });
    expect(t.c.test("pause")).toBe("played");
    expect(t.c.test("resume")).toBeNull(); // silent by default
    expect(t.log).toEqual(["buffer:C", `buffer-stop@${MAX_SOUND_S}`]);
    expect(t.c.store.getState().soundCount).toBe(5); // tests aren't counted
    const html = renderToStaticMarkup(
      <SoundControls settings={{ muted: false, volume: 60 }} state="on" controller={t.c} />,
    );
    expect(html).toContain('data-testid="ui-sound-test-key"');
    expect(html).toContain('data-value="turn"');
  });

  test("FR-SHELL-133 one at a time: a sound due while another plays is skipped; due at once → turn > request > resume > pause", async () => {
    const t = setup();
    t.c.unlock();
    t.c.alertSound("request");
    t.c.alertSound("pause"); // same task, lower → dropped
    expect(t.last()).toBe("request:played:1");
    t.c.alertSound("turn"); // same task, higher → cuts the request
    expect(t.last()).toBe("turn:played:2");
    expect(t.log).toEqual(["osc", "osc", "osc-cut", "osc-cut", "osc", "osc"]);
    await t.tick();
    t.ctx.currentTime = 0.2; // the turn ping still plays
    t.c.alertSound("turn");
    expect(t.last()).toBe("turn:skipped:3");
    t.ctx.currentTime = 1;
    t.c.alertSound("resume");
    expect(t.last()).toBe("turn:skipped:3"); // resume is silent by default
    t.c.setPicks({ resume: CHIME, pause: GONG });
    await t.runIdle();
    // At resume (FR-SHELL-127): turn, request and resume all due → only turn.
    t.ctx.currentTime = 5;
    t.c.alertSound("resume");
    t.c.alertSound("request");
    t.c.alertSound("turn");
    await t.tick();
    expect(t.last()).toBe("turn:played:6");
    // Flash and Toast are unaffected by a skipped sound.
    t.c.alert({ id: "cbt.turn", title: "Your turn", sound: "turn" });
    expect([t.last(), t.toasts.length, t.c.store.getState().flash?.id]).toEqual([
      "turn:skipped:7",
      1,
      "cbt.turn",
    ]);
  });

  test("FR-SHELL-134 alert API: alert({sound: key, flash}), alertSound(key) alone, `<key>:<outcome>:<n>`", async () => {
    const t = setup();
    t.c.alert({ id: "dicex.request", title: "Roll request", sound: "request", flash: false });
    expect(t.c.store.getState().flash).toBeNull();
    expect([t.toasts.length, t.last()]).toEqual([1, "request:locked:1"]);
    t.c.unlock();
    t.c.alertSound("turn");
    expect(t.toasts).toHaveLength(1);
    expect(t.c.store.getState().flash).toBeNull();
    expect(t.last()).toMatch(/^turn:played:2$/);
    // A plain sound id keeps FR-SHELL-27's `<sound>` (the test window's ping).
    await t.tick();
    t.ctx.currentTime = 9;
    t.c.alert({ id: "shell.test", title: "Test alert", sound: "fanfare" });
    expect(t.last()).toBe("ping:played:3");
  });
});
