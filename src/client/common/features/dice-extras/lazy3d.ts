// FR-DICEX-21 / -22: whether this device can draw 3D, and the lazy 3D chunk. The chunk (three,
// cannon-es, meshes, the renderer) loads by dynamic import on the first 3D throw; `flat` / `off`
// never load it. A load failure → `flat` for the session + one console warning.
import { useSyncExternalStore } from "react";
import type { RenderSetting } from "./settings";

export type Dice3DModule = typeof import("./dice3d/index");
export type ChunkState = "idle" | "loading" | "ready" | "failed";

export interface ChunkLoader {
  state(): ChunkState;
  module(): Dice3DModule | null;
  /** Start loading (no-op unless idle). */
  load(): void;
  subscribe(fn: () => void): () => void;
}

export function createChunkLoader(
  importer: () => Promise<Dice3DModule>,
  warn: (msg: string, err: unknown) => void = (m, e) => console.warn(m, e),
): ChunkLoader {
  let state: ChunkState = "idle";
  let mod: Dice3DModule | null = null;
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
 * How one throw draws, given the effective render and the chunk: 3D only once the chunk is
 * ready; while it loads that throw is flat (DICEX §7 "States").
 */
export function throwDraw(render: RenderSetting, chunk: ChunkState): "3d" | "flat" {
  return render === "3d" && chunk === "ready" ? "3d" : "flat";
}
