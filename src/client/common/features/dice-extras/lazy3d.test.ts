// FR-DICEX-22 / -37 / -45: the 3D chunk preloads at idle after the first snapshot when the display
// draws 3D; flat / off / reduced motion never load it; a throw during the load waits ≤ 1.5 s
// then 3D, else flat; a load failure → flat for the session with one warning.
import { describe, expect, test } from "bun:test";
import {
  createChunkLoader,
  type Dice3DModule,
  type IdleEnv,
  preloadAtIdle,
  threeDUnavailable,
  throwDraw,
  whenChunk,
} from "./lazy3d";
import { effectiveDisplay } from "./settings";
import { CHUNK_WAIT_MS, IDLE_FALLBACK_MS } from "./timing";

/** A loader whose import resolves only when `resolve()` / `reject()` is called. */
function manualLoader() {
  let resolve: (m: Dice3DModule) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  let imports = 0;
  const warnings: string[] = [];
  const loader = createChunkLoader(
    () => {
      imports += 1;
      return new Promise<Dice3DModule>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    },
    (m) => warnings.push(m),
  );
  return {
    loader,
    imports: () => imports,
    warnings,
    resolve: () => resolve({} as Dice3DModule),
    reject: () => reject(new Error("chunk 404")),
  };
}

/** Idle callbacks and timers fired by hand. */
function idleEnv(withIdle: boolean) {
  const idle: (() => void)[] = [];
  const timers = new Map<number, { ms: number; fn: () => void }>();
  let id = 0;
  const env: IdleEnv = {
    ...(withIdle && {
      requestIdleCallback: (fn: () => void) => {
        idle.push(fn);
        return idle.length;
      },
      cancelIdleCallback: (h: number) => {
        idle[h - 1] = () => {};
      },
    }),
    setTimeout: (fn, ms) => {
      timers.set(++id, { ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  };
  return {
    env,
    idle,
    timers,
    fireTimers() {
      for (const [k, t] of [...timers]) {
        timers.delete(k);
        t.fn();
      }
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("FR-DICEX-37 preload", () => {
  test("FR-DICEX-37 preload: screen / zone → the chunk import at idle after the first snapshot", () => {
    for (const display of ["screen", "zone"] as const) {
      const m = manualLoader();
      const e = idleEnv(true);
      preloadAtIdle(m.loader, display, e.env);
      expect(m.imports()).toBe(0); // not before idle
      for (const fn of e.idle) fn();
      expect(m.imports()).toBe(1);
      expect(m.loader.state()).toBe("loading");
    }
    // No requestIdleCallback → after 2 s.
    const m = manualLoader();
    const e = idleEnv(false);
    preloadAtIdle(m.loader, "screen", e.env);
    expect([...e.timers.values()].map((t) => t.ms)).toEqual([IDLE_FALLBACK_MS]);
    e.fireTimers();
    expect(m.imports()).toBe(1);
  });

  test("FR-DICEX-37 preload: flat / off never load the chunk; a cancel before idle loads nothing", () => {
    for (const display of ["flat", "off"] as const) {
      const m = manualLoader();
      const e = idleEnv(true);
      preloadAtIdle(m.loader, display, e.env);
      expect(e.idle).toHaveLength(0);
      expect(m.imports()).toBe(0);
    }
    const m = manualLoader();
    const e = idleEnv(true);
    const cancel = preloadAtIdle(m.loader, "screen", e.env);
    cancel();
    for (const fn of e.idle) fn();
    expect(m.imports()).toBe(0);
  });

  test("FR-DICEX-45 reduced motion: effective flat, so no preload and no chunk import", () => {
    const display = effectiveDisplay("screen", { reducedMotion: true, threeD: true });
    expect(display).toBe("flat");
    const m = manualLoader();
    const e = idleEnv(true);
    preloadAtIdle(m.loader, display, e.env);
    expect(e.idle).toHaveLength(0);
    expect(m.imports()).toBe(0);
  });

  test("FR-DICEX-37 preload: a throw during the load waits ≤ 1.5 s, then 3D", async () => {
    const m = manualLoader();
    const e = idleEnv(true);
    m.loader.load();
    const got: boolean[] = [];
    whenChunk(m.loader, (ready) => got.push(ready), e.env);
    expect(got).toEqual([]);
    expect([...e.timers.values()].map((t) => t.ms)).toEqual([CHUNK_WAIT_MS]);
    m.resolve();
    await tick();
    expect(got).toEqual([true]);
    expect(e.timers.size).toBe(0);
    expect(throwDraw("screen", m.loader.state())).toBe("3d");
    // Ready already → at once.
    whenChunk(m.loader, (ready) => got.push(ready), e.env);
    expect(got).toEqual([true, true]);
  });

  test("FR-DICEX-37 preload: still loading after 1.5 s → that throw flat; the next one 3D", async () => {
    const m = manualLoader();
    const e = idleEnv(true);
    const got: boolean[] = [];
    whenChunk(m.loader, (ready) => got.push(ready), e.env); // starts the load (preload missed)
    expect(m.imports()).toBe(1);
    e.fireTimers();
    expect(got).toEqual([false]);
    expect(throwDraw("screen", m.loader.state())).toBe("flat");
    m.resolve();
    await tick();
    expect(got).toEqual([false]); // called once
    expect(throwDraw("screen", m.loader.state())).toBe("3d");
  });

  test("FR-DICEX-22 load failure → flat for the session + one console warning", async () => {
    const m = manualLoader();
    const e = idleEnv(true);
    const got: boolean[] = [];
    whenChunk(m.loader, (ready) => got.push(ready), e.env);
    m.reject();
    await tick();
    expect(got).toEqual([false]);
    m.loader.load();
    await tick();
    expect(m.loader.state()).toBe("failed");
    expect(m.imports()).toBe(1);
    expect(m.warnings).toHaveLength(1);
    whenChunk(m.loader, (ready) => got.push(ready), e.env);
    expect(got).toEqual([false, false]);
    expect(threeDUnavailable(m.loader.state(), true)).toBe("failed");
    expect(threeDUnavailable("ready", false)).toBe("no-webgl");
    expect(threeDUnavailable("idle", true)).toBeNull();
    // `threeD` false → the stored `screen` shows flat.
    expect(effectiveDisplay("screen", { reducedMotion: false, threeD: false })).toBe("flat");
  });

  test("FR-DICEX-22 throwDraw: 3D only for screen / zone with the chunk ready", () => {
    expect(throwDraw("screen", "ready")).toBe("3d");
    expect(throwDraw("zone", "ready")).toBe("3d");
    expect(throwDraw("flat", "ready")).toBe("flat");
    expect(throwDraw("screen", "loading")).toBe("flat");
  });
});
