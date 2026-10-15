// Player visibility per record type (FR-MAP-26, protocol §12). Reads record + viewer only.
// The scene gate (CON-22) runs before these: a player only reaches them for the active scene.
import type {
  PlayerSceneRecord,
  PlayerTokenRecord,
  SceneRecord,
  TokenRecord,
} from "@shared/scenes-map/schemas";
import type { Viewer, Visibility } from "../../ws/records";

/** `scene`: redacted for players (no name, folder, lock, `seq`) *(proposed, OQ-MAP-17)*. */
export const sceneVisibility = (): Visibility => "redacted";

export function redactScene(r: SceneRecord): PlayerSceneRecord {
  return {
    id: r.id,
    mapAssetId: r.mapAssetId,
    mapWidth: r.mapWidth,
    mapHeight: r.mapHeight,
    gridCellSize: r.gridCellSize,
    gridOffsetX: r.gridOffsetX,
    gridOffsetY: r.gridOffsetY,
    gridVisible: r.gridVisible,
    gridColor: r.gridColor,
    gridOpacity: r.gridOpacity,
    active: r.active,
  };
}

/** `scene-folder`: DM only. */
export const folderVisibility = (): Visibility => "hidden";

/**
 * `token`: hidden while `hidden`; else every field but `definitionId`, and `speed` only on the
 * viewer's own tokens (FR-MAP-36: a monster's speed is a stat, #120). `characterId` stays: set
 * only on character tokens, whose entity every player sees redacted (FR-MAP-26, FR-MAP-50).
 */
export function tokenVisibility(r: TokenRecord, _v: Viewer): Visibility {
  return r.hidden ? "hidden" : "redacted";
}

export function redactToken(r: TokenRecord, v: Viewer): PlayerTokenRecord {
  const { definitionId: _definitionId, speed, ...rest } = r;
  return r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId ? { ...rest, speed } : rest;
}
