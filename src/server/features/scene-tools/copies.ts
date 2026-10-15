// Fog seam call sites (FR-SCN-35, -36; ADR-0039). Every prop or template write that sets or moves
// a footprint, and `scn.addDoor`, asks scenes-map's `deriveSceneObject` for the server copies
// **before** its single write. Footprints: `propCells`, uncut `templateCells`, `doorCells`.
// No visibility hook registered → never fogged.

import { doorCells, propCells, templateCells } from "@shared/scene-tools/geometry";
import {
  AOE_TEMPLATE_TYPE,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
  type Segment,
  type TemplateGeometry,
} from "@shared/scene-tools/schemas";
import type { MapRect } from "@shared/scenes-map/geometry";
import { deriveSceneObject, type SceneRead } from "../scenes-map/visibility-hooks";

/** FR-SCN-35: a prop's `fogged` at `w × h` cells from `(col, row)`. */
export function propFogged(
  read: SceneRead,
  sceneId: string,
  p: { col: number; row: number; w: number; h: number },
): boolean {
  return deriveSceneObject(read, { type: SCENE_PROP_TYPE, sceneId, cells: propCells(p) }).fogged;
}

/** FR-SCN-35: a template's `fogged` over its **uncut** cells (survives a map change, FR-SCN-21). */
export function templateFogged(
  read: SceneRead,
  scene: MapRect & { id: string },
  t: TemplateGeometry,
): boolean {
  const cells = templateCells(t, scene, { cut: false });
  return deriveSceneObject(read, { type: AOE_TEMPLATE_TYPE, sceneId: scene.id, cells }).fogged;
}

/** FR-SCN-36: a door's fog flag `f` (1 iff every `doorCells` cell is fogged). */
export function doorFogFlag(read: SceneRead, sceneId: string, segment: Segment): 0 | 1 {
  const cells = doorCells(segment);
  return deriveSceneObject(read, { type: SCENE_STRUCTURE_TYPE, sceneId, cells }).fogged ? 1 : 0;
}
