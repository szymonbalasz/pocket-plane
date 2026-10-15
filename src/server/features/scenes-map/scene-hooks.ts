// Scene lifecycle hooks (ADR-0039, FR-FOG-24, protocol §35). APPEND-ONLY (AGENTS §9.9): a feature
// adds one import and one line to `sceneHooks`; nothing else changes here.
//
// Members (all optional; run in list order inside the scene command's transaction; each returns
// the rows it wrote, listed in the scene event's `changes`; a throw rolls the command back):
// - `created(env, scene)`: `map.createScene`, after the scene insert → `SceneCreated`.
// - `duplicated(env, source, copy)`: `map.duplicateScene`, after the copy's insert and before its
//   tokens are copied (so their `derive` reads the copy's state) → `SceneDuplicated`.
// - `deleting(env, scene)`: `map.deleteScene`, **before** any row is deleted (token hooks and
//   the FK cascade come after) → `SceneDeleted`.
// Hooks write through `env.tx` only and never emit. No line registered → no behaviour change.
import type { SceneRecord } from "@shared/scenes-map/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";
import { fogSceneHook } from "../fog-of-war/hooks";
import { scnSceneHook } from "../scene-tools/lifecycle";

export type SceneHookEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

export interface SceneHook {
  /** `<feature>.<what>`, unique. */
  name: string;
  created?(env: SceneHookEnv, scene: SceneRecord): RecordChange[];
  duplicated?(env: SceneHookEnv, source: SceneRecord, copy: SceneRecord): RecordChange[];
  deleting?(env: SceneHookEnv, scene: SceneRecord): RecordChange[];
}

/** The registry. Append your feature's line; order = run order. */
export const sceneHooks: readonly SceneHook[] = [
  fogSceneHook, // fog-of-war (FR-FOG-02 created / duplicated, FR-FOG-23 deleting)
  scnSceneHook, // scene-tools (FR-SCN-31)
];

/** Live hook list, seeded from the registry; tests may add hooks via `register`. */
export class SceneHooks {
  private list: SceneHook[] = [];

  constructor(initial: readonly SceneHook[] = []) {
    for (const h of initial) this.register(h);
  }

  register(hook: SceneHook): void {
    if (this.list.some((h) => h.name === hook.name)) {
      throw new Error(`Scene hook "${hook.name}" registered twice`);
    }
    this.list.push(hook);
  }

  /** Test support: remove a hook registered by a test. */
  unregister(name: string): void {
    this.list = this.list.filter((h) => h.name !== name);
  }

  created(env: SceneHookEnv, scene: SceneRecord): RecordChange[] {
    return this.list.flatMap((h) => h.created?.(env, scene) ?? []);
  }

  duplicated(env: SceneHookEnv, source: SceneRecord, copy: SceneRecord): RecordChange[] {
    return this.list.flatMap((h) => h.duplicated?.(env, source, copy) ?? []);
  }

  deleting(env: SceneHookEnv, scene: SceneRecord): RecordChange[] {
    return this.list.flatMap((h) => h.deleting?.(env, scene) ?? []);
  }
}

/** The process's hook list (stateless hooks; one list like `tokenHooks`). */
export const lifecycleHooks = new SceneHooks(sceneHooks);
