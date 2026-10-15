// fog-of-war's lines in scenes-map's registries (ADR-0039, FR-FOG-24; protocol §35):
// - `visibility-hooks.ts` `derive`: a scene object's `fogged` = every footprint cell fogged
//   (FR-FOG-10) against the scene's stored mask; no row → clear; a corrupt row → fogged (fail
//   closed, FR-FOG-04). `hides` = fog-hidden (FR-FOG-11, pure, the record only). `dragToDm`: a
//   position frame whose previewed footprint is wholly fogged, for a non-exempt token (FR-FOG-15).
// - `scene-hooks.ts` `duplicated` (the source's row, not its undo stack; no row → none,
//   FR-FOG-02) and `deleting` (the `fog` delete, so `SceneDeleted` lists it, FR-FOG-23).
// - `scene-hooks.ts` `created`: a new scene's fully fogged row (FR-FOG-02).
// Leaf module: it must not import scenes-map's commands or registries (they import it).
import { type FogRow, fogBox, footprintFogged, maskOf } from "@shared/fog-of-war/mask";
import { FOG_TYPE, type FogBox } from "@shared/fog-of-war/schemas";
import { type FogSubject, fogHidden } from "@shared/fog-of-war/visibility";
import { footprint } from "@shared/scenes-map/geometry";
import { eq } from "drizzle-orm";
import { sceneFog } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { SceneHook } from "../scenes-map/scene-hooks";
import type { SceneCells, SceneRead, SceneVisibilityHook } from "../scenes-map/visibility-hooks";
import { readFogRecord } from "./rows";

/** The scene's stored mask row, or null (every cell clear, FR-FOG-01). */
export function readFogRow(read: SceneRead, sceneId: string): FogRow | null {
  const r = read.select().from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get();
  return r ? { fill: r.fill, box: [r.col0, r.row0, r.cols, r.rows], runs: r.runs } : null;
}

const boxColumns = ([col0, row0, cols, rows]: FogBox) => ({ col0, row0, cols, rows });

/** Every cell of `cells` fogged in the scene's stored mask (no row → clear). */
function whollyFogged(read: SceneRead, sceneId: string, cells: SceneCells): boolean {
  const row = readFogRow(read, sceneId);
  return row !== null && footprintFogged(maskOf(row).mask, cells);
}

/** FR-FOG-10 / -11 / -15: the visibility line. */
export const fogVisibilityHook: SceneVisibilityHook = {
  name: "fog-of-war.fogged",
  derive: (read, obj) => ({ fogged: whollyFogged(read, obj.sceneId, obj.cells) }),
  hides: (type, record) => fogHidden(type, record as FogSubject),
  /**
   * A position frame → `"dm"` iff the token is not exempt (no owner) and its footprint at the
   * previewed cell is wholly fogged; an `end` frame (`at` null) adds nothing: scenes-map routes
   * it by the stored state (hidden for players → `"dm"`).
   */
  dragToDm(read, token, at) {
    if (at === null || token.ownerPlayerId !== null) return false;
    const n = footprint(token.size);
    return whollyFogged(read, token.sceneId, { ...at, w: n, h: n });
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
