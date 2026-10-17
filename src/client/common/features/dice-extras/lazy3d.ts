// FR-DICEX-22 / -37: whether this device can draw 3D, and the lazy 3D chunk. The chunk (three,
// cannon-es, meshes, the renderer) loads by dynamic import at idle after the first snapshot when
// the display draws 3D (`screen` / `zone`); `flat` / `off` never load it. A throw arriving while
// it loads waits ≤ 1.5 s. A load failure → `flat` for the session + one console warning.
import { useSyncExternalStore } from "react";
import { type DisplaySetting, is3dDisplay } from "./settings";
import { CHUNK_WAIT_MS, IDLE_FALLBACK_MS } from "./timing";

export type Dice3DModule = typeof import("./dice3d/index");
export type ChunkState = "idle" | "loading" | "ready" | "failed";

export interface ChunkLoader<M = Dice3DModule> {
  state(): ChunkState;
  module(): M | null;
  /** Start loading (no-op unless idle). */
  load(): void;
  subscribe(fn: () => void): () => void;
}

export function createChunkLoader<M = Dice3DModule>(
  importer: () => Promise<M>,
  warn: (msg: string, err: unknown) => void = (m, e) => console.warn(m, e),
): ChunkLoader<M> {
  let state: ChunkState = "idle";
  let mod: M | null = null;
  const listeners = new Set<() => void>();
  const set = (s: ChunkState) => {
    state = s;
    for (const fn of [...listeners]) fn();
  };
  return {
    state: () => state,
    module: () => mod,
    load() {
      if (state !== "idle") return;
      set("loading");
      importer().then(
        (m) => {
          mod = m;
          set("ready");
        },
        (err: unknown) => {
          warn("Dice: 3D dice failed to load; showing flat dice this session.", err);
          set("failed");
        },
      );
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The page's one loader. */
export const dice3d = createChunkLoader(() => import("./dice3d/index"));

export function useChunk3d(): ChunkState {
  return useSyncExternalStore(dice3d.subscribe, dice3d.state, dice3d.state);
}

let webgl: boolean | null = null;

/** WebGL can start here (probed once; the probe context is released). */
export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = globalThis.document?.createElement("canvas");
    const gl = c ? (c.getContext("webgl2") ?? c.getContext("webgl")) : null;
    webgl = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

/** Why 3D can't be picked on this device, or null when it can (DICEX §7 "States"). */
export function threeDUnavailable(chunk: ChunkState, gl: boolean): "no-webgl" | "failed" | null {
  if (!gl) return "no-webgl";
  return chunk === "failed" ? "failed" : null;
}

/** This device's 3D availability (the settings' `threeD` input and the popover's hint). */
export function useThreeD(): { available: boolean; reason: "no-webgl" | "failed" | null } {
  const chunk = useChunk3d();
  const reason = threeDUnavailable(chunk, webglAvailable());
  return { available: reason === null, reason };
}

/**
 * How one throw draws, given the effective display and the chunk: 3D only once the chunk is
 * ready; else flat (DICEX §7 "States").
 */
export function throwDraw(display: DisplaySetting, chunk: ChunkState): "3d" | "flat" {
  return is3dDisplay(display) && chunk === "ready" ? "3d" : "flat";
}

export interface IdleEnv {
  requestIdleCallback?: (fn: () => void) => number;
  cancelIdleCallback?: (h: number) => void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const browserIdle = (): IdleEnv => ({
  requestIdleCallback: globalThis.requestIdleCallback?.bind(globalThis),
  cancelIdleCallback: globalThis.cancelIdleCallback?.bind(globalThis),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

/**
 * FR-DICEX-37: once there is a snapshot and the display draws 3D, load the chunk at idle
 * (`requestIdleCallback`, else after 2 s). Returns a cancel.
 */
export function preloadAtIdle(
  loader: Pick<ChunkLoader<unknown>, "state" | "load">,
  display: DisplaySetting,
  env: IdleEnv = browserIdle(),
): () => void {
  return is3dDisplay(display) ? loadAtIdle(loader, env) : () => {};
}

/** Load `loader` at idle (`requestIdleCallback`, else after 2 s). Returns a cancel. */
export function loadAtIdle(
  loader: Pick<ChunkLoader<unknown>, "state" | "load">,
  env: IdleEnv = browserIdle(),
): () => void {
  if (loader.state() !== "idle") return () => {};
  if (env.requestIdleCallback) {
    const h = env.requestIdleCallback(() => loader.load());
    return () => env.cancelIdleCallback?.(h);
  }
  const h = env.setTimeout(() => loader.load(), IDLE_FALLBACK_MS);
  return () => env.clearTimeout(h);
}

/**
 * FR-DICEX-37: call `done(ready)` once the chunk is ready (at once when it is) or after
 * `CHUNK_WAIT_MS` (false, or as soon as it fails). Starts the load if it hasn't. Returns a cancel.
 */
export function whenChunk(
  loader: ChunkLoader,
  done: (ready: boolean) => void,
  timers: Pick<IdleEnv, "setTimeout" | "clearTimeout"> = browserIdle(),
): () => void {
  if (loader.state() === "ready") {
    done(true);
    return () => {};
  }
  loader.load();
  let settled = false;
  const finish = (ready: boolean) => {
    if (settled) return;
    settled = true;
    unsub();
    timers.clearTimeout(timer);
    done(ready);
  };
  const unsub = loader.subscribe(() => {
    const s = loader.state();
    if (s === "ready") finish(true);
    else if (s === "failed") finish(false);
  });
  const timer = timers.setTimeout(() => finish(loader.state() === "ready"), CHUNK_WAIT_MS);
  if (loader.state() === "failed") finish(false);
  return () => {
    settled = true;
    unsub();
    timers.clearTimeout(timer);
  };
}
