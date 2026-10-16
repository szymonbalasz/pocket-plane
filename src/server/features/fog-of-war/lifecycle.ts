// fog-of-war's lifecycle lines (ADR-0039 / ADR-0042, FR-FOG-24; protocol §35):
// - scenes-map `scene-hooks.ts`: `created` (a fully fogged row, FR-FOG-02), `duplicated` (the
//   source's row, not its undo stack, memory or `visionStale`), `deleting` (the `fog` delete and
//   every `fog-explored` row, FR-FOG-23), `activated` (a `visionStale` scene re-derives inside the
//   activation, FR-FOG-35).
// - campaign-management `player-hooks.ts`: `added` (OQ-FOG-39: the new player joins `seenBy` on
//   the active scene; other scenes are marked `visionStale`).
import { fogBox } from "@shared/fog-of-war/mask";
import { FOG_EXPLORED_TYPE, FOG_TYPE, type FogBox } from "@shared/fog-of-war/schemas";
import { eq } from "drizzle-orm";
import { sceneFog } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { PlayerHook } from "../campaign-management/player-hooks";
import type { SceneHook } from "../scenes-map/scene-hooks";
import { markScenesStale, rederiveScene } from "./rederive";
import { readFogRecord, sceneExploredRecords } from "./rows";

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
  /** FR-FOG-02: shapes, darkness, setting; not the undo stack, memory or `visionStale`. */
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
