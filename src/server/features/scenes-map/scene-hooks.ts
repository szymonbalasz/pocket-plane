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
// - `activated(env, scene)`: `map.activateScene`, after both `active` flags flip → `SceneActivated`
//   (ADR-0042: fog re-derives a `visionStale` scene, FR-FOG-35).
// - `mapChanged(env, scene)` (sprint 4, review A8): `map.setGrid` / `map.setSceneMap`, after the
//   scene row is written, only when the map rectangle moved (map size, cell size or offsets) →
//   `SceneUpdated` (fog re-derives the scene: the map edges bound sight, FR-FOG-33).
// - `deactivated(env, scene)` (ADR-0075, FR-OVW-44): `ovw.show`, after the scene went off and the
//   overview came on, only when a scene went off → `OverviewShown`. `map.activateScene` doesn't
//   run it: `activated` covers a switch.
// Hooks write through `env.tx` only and never emit. No line registered → no behaviour change.
import type { SceneRecord } from "@shared/scenes-map/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { RecordChange } from "../../events/types";
import { petPresenceSceneHook } from "../entities/pet-presence";
import { fogSceneHook } from "../fog-of-war/lifecycle";
import { overviewSceneHook } from "../overview-scenes/lifecycle";
import { scnSceneHook } from "../scene-tools/lifecycle";

export type SceneHookEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

export interface SceneHook {
  /** `<feature>.<what>`, unique. */
  name: string;
  created?(env: SceneHookEnv, scene: SceneRecord): RecordChange[];
  duplicated?(env: SceneHookEnv, source: SceneRecord, copy: SceneRecord): RecordChange[];
  deleting?(env: SceneHookEnv, scene: SceneRecord): RecordChange[];
  activated?(env: SceneHookEnv, scene: SceneRecord): RecordChange[];
  mapChanged?(env: SceneHookEnv, scene: SceneRecord): RecordChange[];
  deactivated?(env: SceneHookEnv, scene: SceneRecord): RecordChange[];
}

/** The registry. Append your feature's line; order = run order. */
export const sceneHooks: readonly SceneHook[] = [
  fogSceneHook, // fog-of-war (FR-FOG-02 created / duplicated, -23 deleting, -35 activated, -33 mapChanged)
  scnSceneHook, // scene-tools (FR-SCN-31)
  petPresenceSceneHook, // entities: scene switch / active-scene delete / scene off re-derive `petPresent` (FR-ENT-37, FR-OVW-44)
  overviewSceneHook, // overview scenes: a scene coming on takes a shown overview off (FR-OVW-06)
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

  activated(env: SceneHookEnv, scene: SceneRecord): RecordChange[] {
    return this.list.flatMap((h) => h.activated?.(env, scene) ?? []);
  }

  mapChanged(env: SceneHookEnv, scene: SceneRecord): RecordChange[] {
    return this.list.flatMap((h) => h.mapChanged?.(env, scene) ?? []);
  }

  deactivated(env: SceneHookEnv, scene: SceneRecord): RecordChange[] {
    return this.list.flatMap((h) => h.deactivated?.(env, scene) ?? []);
  }
}

/** The process's hook list (stateless hooks; one list like `tokenHooks`). */
export const lifecycleHooks = new SceneHooks(sceneHooks);
