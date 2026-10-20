// Scene visibility hooks (ADR-0039, refined by ADR-0042; FR-FOG-24, protocol §35). APPEND-ONLY
// (AGENTS §9.9): a feature adds one import and one line to `sceneVisibilityHooks`; nothing else
// changes here.
//
// Members (all optional; run in list order; a throw rolls the command back):
// - `derive(read, obj) → {fogged?, seenBy?}`: runs in the writing command's transaction, before
//   the single write of a scene object (via `deriveSceneObject`): the server copies `fogged`
//   and `seenBy` (player ids, server only, FR-FOG-10). Read-only.
// - `hides(type, record, viewer) → boolean`: in every fog subject's visibility fn. Reads only the
//   record and the viewer (ADR-0021); per player since ADR-0042.
// - `dragAudience(read, token, at | null) → playerId[]`: the players a `map.drag` frame of a token
//   visible to players may reach (FR-FOG-15); `at` = the previewed top-left cell (FR-MAP-15
//   rounding), null on an `end` frame. Several hooks → the intersection. Read-only.
// - `rederive(env, change) → RecordChange[]`: after a subject write, its dependants (other
//   subjects' copies, vision, explored memory, FR-FOG-35). `change` = the write's
//   `{type, id, before, after}`: a token (place, move, update, hide / reveal, duplicate, delete,
//   size refresh; `before` null on place, `after` null on delete) or a `scene-structure` edit
//   (FR-SCN-39). Writes through `env.tx` only, never emits; the rows join the write's event.
// No line registered → no behaviour change.
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import type { CommandEnv } from "../../commands/commands";
import type { Db } from "../../db/client";
import type { RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { petPresenceVisibilityHook } from "../entities/pet-presence";
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
  /** Sample points in grid units (doors, FR-SCN-36); absent = the centres of `cells`. */
  points?: readonly (readonly [number, number])[];
  /** Tokens: the owner (owned tokens: owner + party rule, FR-FOG-34). */
  ownerPlayerId?: string | null;
  /** Templates: the placing player (player-placed templates are not fog subjects). */
  placedByPlayerId?: string | null;
  /** Tokens (#210, FR-FOG-46). */
  invisible?: boolean;
}

/** What `derive` adds to the write. `seenBy` null = no hook decided it. */
export interface SceneObjectCopies {
  fogged: boolean;
  seenBy: string[] | null;
}

export type SceneHookEnv = Pick<CommandEnv, "tx" | "ctx" | "actor">;

export interface SceneVisibilityHook {
  /** `<feature>.<what>`, unique. */
  name: string;
  derive?(read: SceneRead, obj: SceneObject): Partial<SceneObjectCopies>;
  hides?(type: string, record: object, viewer: Viewer): boolean;
  dragAudience?(
    read: SceneRead,
    token: TokenRecord,
    at: { col: number; row: number } | null,
  ): readonly string[];
  rederive?(env: SceneHookEnv, change: RecordChange): RecordChange[];
}

/** The registry. Append your feature's line; order = run order. */
export const sceneVisibilityHooks: readonly SceneVisibilityHook[] = [
  fogVisibilityHook, // fog-of-war (FR-FOG-10 derive, -11 / -12 hides, -15 dragAudience, -35 rederive)
  petPresenceVisibilityHook, // entities: a pet token's write re-derives `petPresent` (FR-ENT-37)
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
    const out: SceneObjectCopies = { fogged: false, seenBy: null };
    for (const h of this.list) {
      const r = h.derive?.(read, obj);
      if (r?.fogged !== undefined) out.fogged = r.fogged;
      if (r?.seenBy !== undefined) out.seenBy = r.seenBy;
    }
    return out;
  }

  hides(type: string, record: object, viewer: Viewer): boolean {
    return this.list.some((h) => h.hides?.(type, record, viewer) === true);
  }

  hasDragAudience(): boolean {
    return this.list.some((h) => h.dragAudience !== undefined);
  }

  /** The players every `dragAudience` hook allows (intersection, in the first hook's order). */
  dragAudience(
    read: SceneRead,
    token: TokenRecord,
    at: { col: number; row: number } | null,
  ): string[] | null {
    let out: string[] | null = null;
    for (const h of this.list) {
      if (!h.dragAudience) continue;
      const ids = h.dragAudience(read, token, at);
      out = out === null ? [...ids] : out.filter((p) => ids.includes(p));
    }
    return out;
  }

  rederive(env: SceneHookEnv, change: RecordChange): RecordChange[] {
    return this.list.flatMap((h) => h.rederive?.(env, change) ?? []);
  }
}

/**
 * The process's hook list. Visibility fns are pure (record + viewer, ADR-0021), so they can't
 * reach per-server services; hooks are stateless and read only what they are given.
 */
export const visibilityHooks = new SceneVisibilityHooks(sceneVisibilityHooks);

/** FR-FOG-10: the server copies for a scene object about to be written (`fogged`, `seenBy`). */
export function deriveSceneObject(read: SceneRead, obj: SceneObject): SceneObjectCopies {
  return visibilityHooks.derive(read, obj);
}

/** FR-FOG-12: any `hides` hook hides this record from this player (DM always `full`). */
export function hiddenByHooks(type: string, record: object, viewer: Viewer): boolean {
  return visibilityHooks.hides(type, record, viewer);
}

/** FR-FOG-35: a subject write's dependants (the rows join the write's event). */
export function rederiveDependants(env: SceneHookEnv, change: RecordChange): RecordChange[] {
  return visibilityHooks.rederive(env, change);
}

/**
 * FR-FOG-11: a token is hidden for player `playerId`: `hidden`, or any `hides` hook (fog:
 * not in `seenBy` and not their own token). `map.checkMove` / `map.moveToken` / `map.drag`
 * answer `not_found` for it, before ownership.
 */
export function tokenHiddenFor(t: TokenRecord, playerId: string | null, campaignId: string) {
  const v: Viewer = { connId: "", campaignId, role: "player", playerId };
  return t.hidden || hiddenByHooks(TOKEN_TYPE, t, v);
}

/**
 * FR-FOG-14 (ADR-0042, OQ-FOG-36 / -38): party-level hidden = `hidden`, or seen by no player
 * (`fogged` on an unowned token; an owned token's `fogged` is its static copy and its owner
 * always sees it, FR-FOG-10 / -34). Every combat hidden copy uses this.
 */
export function tokenHiddenForPlayers(t: TokenRecord): boolean {
  return t.hidden || (t.fogged === true && t.ownerPlayerId === null);
}
