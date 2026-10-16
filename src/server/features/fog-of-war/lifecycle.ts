// fog-of-war's lifecycle lines (ADR-0039 / ADR-0042, FR-FOG-24; protocol §35):
// - scenes-map `scene-hooks.ts`: `created` (a fully fogged row, FR-FOG-02), `duplicated` (the
//   source's row, not its undo stack, memory or `visionStale`), `deleting` (the `fog` delete and
//   every `fog-explored` row, FR-FOG-23), `activated` (a `visionStale` scene re-derives inside the
//   activation, FR-FOG-35).
// - campaign-management `player-hooks.ts`: `added` (OQ-FOG-39: the new player joins `seenBy` on
//   the active scene; other scenes are marked `visionStale`).
// - entities' definition-changed hooks: `fogSensesHook` (FR-FOG-35: a senses edit re-derives the
//   active scene for the definition's source tokens; their other scenes → `visionStale`).
// - scenes-map `visibility-hooks.ts` `rederive` (bound into `hooks.ts`, FR-FOG-35): a vision
//   source written (placed, moved, resized, hidden / revealed, re-owned, duplicated, deleted)
//   re-derives its scene(s); a structure edit (FR-SCN-39) and a scene copy (#216) re-derive that
//   scene; any other token write needs only its own `derive`.
import type { EntityRecord } from "@shared/entities/schemas";
import { fogBox } from "@shared/fog-of-war/mask";
import { FOG_EXPLORED_TYPE, FOG_TYPE, type FogBox } from "@shared/fog-of-war/schemas";
import { SCENE_STRUCTURE_TYPE } from "@shared/scene-tools/schemas";
import { SCENE_TYPE, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { sceneFog, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { PlayerHook } from "../campaign-management/player-hooks";
import type { HookEnv } from "../entities/definition-hooks";
import type { SceneHook } from "../scenes-map/scene-hooks";
import type { SceneHookEnv } from "../scenes-map/visibility-hooks";
import { loadSceneStatic } from "./derive";
import { bindFogRederive } from "./hooks";
import { markScenesStale, mergeChanges, rederiveDarkness, rederiveScene } from "./rederive";
import { readFogRecord, sceneExploredRecords } from "./rows";
import { isSource } from "./sight";

const boxColumns = ([col0, row0, cols, rows]: FogBox) => ({ col0, row0, cols, rows });

/** FR-FOG-02 (create, duplicate) / FR-FOG-23 (delete) / FR-FOG-35 (activate): lifecycle lines. */
export const fogSceneHook: SceneHook = {
  name: "fog-of-war.fog-row",
  /** FR-FOG-02: a new scene starts fully fogged (`{fill: fog, runs: ""}`), no undo entry. */
  created({ tx, ctx }, scene): RecordChange[] {
    tx.insert(sceneFog)
      .values({
        sceneId: scene.id,
        campaignId: scene.campaignId,
        fill: "fog",
        ...boxColumns(fogBox(scene)),
        runs: "",
        shapes: [],
        darkness: [],
        explored: false,
        updatedAt: ctx.clock.iso(),
      })
      .run();
    return [{ type: FOG_TYPE, id: scene.id, before: null, after: readFogRecord(tx, scene.id) }];
  },
  /**
   * FR-FOG-02: shapes, darkness, setting; not the undo stack, memory or `visionStale`. Darkness
   * `seenBy` is re-derived for the copy (it has no memory, FR-FOG-44).
   */
  duplicated({ tx, ctx }, source, copy): RecordChange[] {
    const src = tx.select().from(sceneFog).where(eq(sceneFog.sceneId, source.id)).get();
    if (!src) return [];
    tx.insert(sceneFog)
      .values({
        ...src,
        sceneId: copy.id,
        campaignId: copy.campaignId,
        rev: 0,
        visionStale: false,
        updatedAt: ctx.clock.iso(),
      })
      .run();
    const st = loadSceneStatic(tx, copy.id);
    if (st) rederiveDarkness({ tx }, st);
    return [{ type: FOG_TYPE, id: copy.id, before: null, after: readFogRecord(tx, copy.id) }];
  },
  /** FR-FOG-23: the `fog` delete and every `fog-explored` row (the FK cascade removes them). */
  deleting({ tx }, scene): RecordChange[] {
    const before = readFogRecord(tx, scene.id);
    const explored: RecordChange[] = sceneExploredRecords(tx, scene.id).map((r) => ({
      type: FOG_EXPLORED_TYPE,
      id: r.id,
      before: r,
      after: null,
    }));
    return [
      ...(before ? [{ type: FOG_TYPE, id: scene.id, before, after: null }] : []),
      ...explored,
    ];
  },
  /** FR-FOG-35: a `visionStale` scene re-derives inside the activation and clears the flag. */
  activated(env, scene): RecordChange[] {
    const row = env.tx
      .select({ stale: sceneFog.visionStale })
      .from(sceneFog)
      .where(eq(sceneFog.sceneId, scene.id))
      .get();
    if (!row?.stale) return [];
    env.tx.update(sceneFog).set({ visionStale: false }).where(eq(sceneFog.sceneId, scene.id)).run();
    return rederiveScene(env, scene.id);
  },
};

/**
 * FR-FOG-35 / OQ-FOG-39: a new player joins `seenBy` (and `doorSeen`) on the active scene in
 * the add transaction; the campaign's other scenes are marked `visionStale` and re-derive when
 * activated. Keeps sprint 2's "a new player sees what is revealed" with per-player copies.
 */
export const fogPlayerHook: PlayerHook = {
  name: "fog-of-war.player-membership",
  added(env, p): RecordChange[] {
    return markScenesStale(env, p.campaignId).flatMap((id) => rederiveScene(env, id));
  },
};

/** Same source on the same place (FR-FOG-32): nothing a sight depends on changed. */
const sameSource = (a: TokenRecord, b: TokenRecord) =>
  a.sceneId === b.sceneId &&
  a.ownerPlayerId === b.ownerPlayerId &&
  a.col === b.col &&
  a.row === b.row &&
  a.size === b.size;

/** FR-FOG-35: the dependants of a token, structure or scene-copy write (re-derive triggers). */
export function fogRederive(env: SceneHookEnv, change: RecordChange): RecordChange[] {
  if (change.type === TOKEN_TYPE) {
    const b = change.before as TokenRecord | null;
    const a = change.after as TokenRecord | null;
    const was = isSource(b);
    const is = isSource(a);
    if (!was && !is) return [];
    if (was && is && sameSource(b as TokenRecord, a as TokenRecord)) return [];
    const scenes = new Set<string>();
    if (was) scenes.add((b as TokenRecord).sceneId);
    if (is) scenes.add((a as TokenRecord).sceneId);
    const owners = [b?.ownerPlayerId, a?.ownerPlayerId].filter((p): p is string => !!p);
    return mergeChanges(
      [...scenes].flatMap((id) =>
        rederiveScene(env, id, { sourceChange: { before: b, after: a }, memoryOf: owners }),
      ),
    );
  }
  if (change.type === SCENE_STRUCTURE_TYPE) return rederiveScene(env, change.id);
  // #216: a scene copy re-derives once its tokens and SCN rows are copied.
  if (change.type === SCENE_TYPE && change.before === null) return rederiveScene(env, change.id);
  return [];
}

bindFogRederive(fogRederive);

const sensesKey = (e: EntityRecord) => {
  const s = (e.statBlock as { senses?: Record<string, unknown> } | null)?.senses;
  return s
    ? `${s.visionFt},${s.darkvisionFt},${s.seesMagicalDarkness === true},${s.seesInvisible === true}`
    : "0,0,false,false";
};

/**
 * FR-FOG-35 (definition-changed hook): a senses edit (incl. Sees invisible) re-derives the active
 * scene if it holds a source token of the definition; the definition's other source scenes are
 * marked `visionStale` (re-derived on activation). No source token → nothing.
 */
export function fogSensesHook(env: HookEnv, before: EntityRecord, after: EntityRecord) {
  if (sensesKey(before) === sensesKey(after)) return [];
  const rows = env.tx
    .select({ sceneId: token.sceneId, campaignId: token.campaignId })
    .from(token)
    .where(
      and(
        eq(token.definitionId, after.id),
        isNotNull(token.ownerPlayerId),
        eq(token.hidden, false),
      ),
    )
    .orderBy(asc(token.seq))
    .all();
  const first = rows[0];
  if (!first) return [];
  const scenes = [...new Set(rows.map((r) => r.sceneId))];
  return mergeChanges(
    markScenesStale(env, first.campaignId, scenes).flatMap((id) => rederiveScene(env, id)),
  );
}
