// fog-of-war's lines in scenes-map's registries (ADR-0039, FR-FOG-24; protocol §35):
// - `visibility-hooks.ts` `derive`: a scene object's `fogged` = every footprint cell fogged
//   (FR-FOG-10) against the scene's stored mask; no row → clear; a corrupt row → fogged (fail
//   closed, FR-FOG-04).
// - `scene-hooks.ts` `duplicated` (the source's row, not its undo stack; no row → none,
//   FR-FOG-02) and `deleting` (the `fog` delete, so `SceneDeleted` lists it, FR-FOG-23).
// - `scene-hooks.ts` `created`: a new scene's fully fogged row (FR-FOG-02).
// Leaf module: it must not import scenes-map's commands or registries (they import it).
import { type FogRow, fogBox, footprintFogged, maskOf } from "@shared/fog-of-war/mask";
import { FOG_TYPE, type FogBox } from "@shared/fog-of-war/schemas";
import { eq } from "drizzle-orm";
import { sceneFog } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { SceneHook } from "../scenes-map/scene-hooks";
import type { SceneRead, SceneVisibilityHook } from "../scenes-map/visibility-hooks";
import { readFogRecord } from "./rows";

/** The scene's stored mask row, or null (every cell clear, FR-FOG-01). */
export function readFogRow(read: SceneRead, sceneId: string): FogRow | null {
  const r = read.select().from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get();
  return r ? { fill: r.fill, box: [r.col0, r.row0, r.cols, r.rows], runs: r.runs } : null;
}

const boxColumns = ([col0, row0, cols, rows]: FogBox) => ({ col0, row0, cols, rows });

/** FR-FOG-10: `derive` line. */
export const fogVisibilityHook: SceneVisibilityHook = {
  name: "fog-of-war.fogged",
  derive(read, obj) {
    const row = readFogRow(read, obj.sceneId);
    if (row === null) return { fogged: false };
    return { fogged: footprintFogged(maskOf(row).mask, obj.cells) };
  },
};

/** FR-FOG-02 (create, duplicate) / FR-FOG-23 (delete): lifecycle lines. */
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
        updatedAt: ctx.clock.iso(),
      })
      .run();
    return [{ type: FOG_TYPE, id: scene.id, before: null, after: readFogRecord(tx, scene.id) }];
  },
  duplicated({ tx, ctx }, source, copy): RecordChange[] {
    const src = tx.select().from(sceneFog).where(eq(sceneFog.sceneId, source.id)).get();
    if (!src) return [];
    tx.insert(sceneFog)
      .values({ ...src, sceneId: copy.id, campaignId: copy.campaignId, updatedAt: ctx.clock.iso() })
      .run();
    return [{ type: FOG_TYPE, id: copy.id, before: null, after: readFogRecord(tx, copy.id) }];
  },
  deleting({ tx }, scene): RecordChange[] {
    const before = readFogRecord(tx, scene.id);
    return before ? [{ type: FOG_TYPE, id: scene.id, before, after: null }] : [];
  },
};
