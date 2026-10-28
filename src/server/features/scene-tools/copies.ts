// Fog seam call sites (FR-SCN-35, -36; ADR-0039 / ADR-0042). Every prop or template write that
// sets or moves a footprint, and `scn.addDoor`, asks scenes-map's `deriveSceneObject` for the
// server copies (`fogged`, per-player `seenBy`) **before** its single write. Footprints:
// `propCells`, uncut `templateCells`; doors: FR-SCN-36's sample points (`doorSamplePoints`).
// No visibility hook registered → never fogged, `seenBy` null.

import {
  doorCells,
  doorSamplePoints,
  propCells,
  templateCells,
} from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  type DiagonalRule,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
  type Segment,
  type TemplateGeometry,
} from "@shared/scene-tools/schemas";
import type { MapRect } from "@shared/scenes-map/geometry";
import {
  deriveSceneObject,
  type SceneObjectCopies,
  type SceneRead,
} from "../scenes-map/visibility-hooks";
import { diagonalRuleOf } from "./rows";

/** FR-SCN-35: a prop's copies at `w × h` cells from `(col, row)`. */
export function propCopies(
  read: SceneRead,
  sceneId: string,
  p: { col: number; row: number; w: number; h: number },
): SceneObjectCopies {
  return deriveSceneObject(read, { type: SCENE_PROP_TYPE, sceneId, cells: propCells(p) });
}

/**
 * FR-SCN-35: a template's copies over its **uncut** cells (survives a map change, FR-SCN-21); a
 * snapped sphere's cells follow the campaign's diagonal rule (#377, FR-SCN-30).
 */
export function templateCopies(
  read: SceneRead,
  scene: MapRect & { id: string; campaignId: string },
  t: TemplateGeometry,
  placedByPlayerId: string | null,
  rule: DiagonalRule = diagonalRuleOf(read, scene.campaignId),
): SceneObjectCopies {
  const cells = templateCells(t, scene, { cut: false, rule });
  return deriveSceneObject(read, {
    type: AOE_TEMPLATE_TYPE,
    sceneId: scene.id,
    cells,
    placedByPlayerId,
  });
}

/** FR-SCN-35 / FR-FOG-15: a DM template there would be seen by nobody (`scn.template` routing). */
export function templateFogged(
  read: SceneRead,
  scene: MapRect & { id: string; campaignId: string },
  t: TemplateGeometry,
): boolean {
  return templateCopies(read, scene, t, null).fogged;
}

/** FR-SCN-36: a door's fog flag `f` (1 iff seen by nobody) and its `doorSeen` entry. */
export function doorCopies(
  read: SceneRead,
  sceneId: string,
  segment: Segment,
): { f: 0 | 1; seenBy: string[] | null } {
  const c = deriveSceneObject(read, {
    type: SCENE_STRUCTURE_TYPE,
    sceneId,
    cells: doorCells(segment),
    points: doorSamplePoints(segment),
  });
  return { f: c.fogged ? 1 : 0, seenBy: c.seenBy };
}
