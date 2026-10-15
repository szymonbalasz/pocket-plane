// Scene visibility hooks (ADR-0039, FR-FOG-24, protocol §35). APPEND-ONLY (AGENTS §9.9): a
// feature adds one import and one line to `sceneVisibilityHooks`; nothing else changes here.
//
// Members (all optional, all read-only; run in list order; a throw rolls the command back):
// - `derive(read, obj) → {fogged?}`: runs in the writing command's transaction, before the single
//   write of a scene object (via `deriveSceneObject`); also in SCN's `scn.template` audience.
// - `hides(type, record) → boolean`: in every fog subject's visibility fn. Reads only the record;
//   the same answer for every player (ADR-0021).
// - `dragToDm(read, token, at | null) → boolean`: in `map.drag`'s audience; `at` = the previewed
//   top-left cell (FR-MAP-15 rounding), null on an `end` frame.
// No line registered → no behaviour change.
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import type { Db } from "../../db/client";
import { fogVisibilityHook } from "../fog-of-war/hooks";

/** Read-only DB access: a command's `tx` or a signal audience's `read.db`. */
export type SceneRead = Pick<Db, "select">;

/** A footprint: a square block (tokens) or a list of `[col, row]` cells (SCN's uncut cells). */
export type SceneCells =
  | { col: number; row: number; w: number; h: number }
  | readonly (readonly [number, number])[];

/** An object on a scene about to be written (FR-FOG-10). */
export interface SceneObject {
  type: string;
  sceneId: string;
  cells: SceneCells;
}

/** What `derive` adds to the write. */
export interface SceneObjectCopies {
  fogged: boolean;
}

export interface SceneVisibilityHook {
  /** `<feature>.<what>`, unique. */
  name: string;
  derive?(read: SceneRead, obj: SceneObject): Partial<SceneObjectCopies>;
  hides?(type: string, record: object): boolean;
  dragToDm?(read: SceneRead, token: TokenRecord, at: { col: number; row: number } | null): boolean;
}

/** The registry. Append your feature's line; order = run order. */
export const sceneVisibilityHooks: readonly SceneVisibilityHook[] = [
  fogVisibilityHook, // fog-of-war (FR-FOG-10 derive, FR-FOG-11/12 hides, FR-FOG-15 dragToDm)
];

/** Live hook list, seeded from the registry; tests may add hooks via `register`. */
export class SceneVisibilityHooks {
  private list: SceneVisibilityHook[] = [];

  constructor(initial: readonly SceneVisibilityHook[] = []) {
    for (const h of initial) this.register(h);
  }

  register(hook: SceneVisibilityHook): void {
    if (this.list.some((h) => h.name === hook.name)) {
      throw new Error(`Scene visibility hook "${hook.name}" registered twice`);
    }
    this.list.push(hook);
  }

  /** Test support: remove a hook registered by a test. */
  unregister(name: string): void {
    this.list = this.list.filter((h) => h.name !== name);
  }

  derive(read: SceneRead, obj: SceneObject): SceneObjectCopies {
    const out: SceneObjectCopies = { fogged: false };
    for (const h of this.list) {
      const r = h.derive?.(read, obj);
      if (r?.fogged !== undefined) out.fogged = r.fogged;
    }
    return out;
  }

  hides(type: string, record: object): boolean {
    return this.list.some((h) => h.hides?.(type, record) === true);
  }

  hasDragToDm(): boolean {
    return this.list.some((h) => h.dragToDm !== undefined);
  }

  dragToDm(read: SceneRead, token: TokenRecord, at: { col: number; row: number } | null) {
    return this.list.some((h) => h.dragToDm?.(read, token, at) === true);
  }
}

/**
 * The process's hook list. Visibility fns are pure (record + viewer, ADR-0021), so they can't
 * reach per-server services; hooks are stateless and read only what they are given.
 */
export const visibilityHooks = new SceneVisibilityHooks(sceneVisibilityHooks);

/** FR-FOG-10: the server copies for a scene object about to be written (`fogged`). */
export function deriveSceneObject(read: SceneRead, obj: SceneObject): SceneObjectCopies {
  return visibilityHooks.derive(read, obj);
}

/** FR-FOG-12: any `hides` hook hides this record from players (DM always `full`). */
export function hiddenByHooks(type: string, record: object): boolean {
  return visibilityHooks.hides(type, record);
}

/** FR-FOG-14 (ADR-0039): `hidden` or any `hides`; every combat hidden copy uses this. */
export function tokenHiddenForPlayers(t: TokenRecord): boolean {
  return t.hidden || hiddenByHooks(TOKEN_TYPE, t);
}
