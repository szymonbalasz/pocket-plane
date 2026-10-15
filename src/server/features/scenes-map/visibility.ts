// Player visibility per record type (FR-MAP-26, protocol §12). Reads record + viewer only.
// The scene gate (CON-22) runs before these: a player only reaches them for the active scene.
import type {
  PlayerSceneRecord,
  PlayerTokenRecord,
  SceneRecord,
  TokenRecord,
} from "@shared/scenes-map/schemas";
import type { Viewer, Visibility } from "../../ws/records";
import { tokenHiddenForPlayers } from "./visibility-hooks";

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
 * `token`: hidden while `hidden` or any scene visibility hook `hides` it (FR-FOG-12, ADR-0039:
 * reads only the record); else every field but `definitionId`, and `speed` only on the viewer's
 * own tokens (FR-MAP-36: a monster's speed is a stat, #120), `fogged` likewise (FOG §9).
 * `characterId` stays: set only on
 * character tokens, whose entity every player sees redacted (FR-MAP-26, FR-MAP-50).
 */
export function tokenVisibility(r: TokenRecord, _v: Viewer): Visibility {
  return tokenHiddenForPlayers(r) ? "hidden" : "redacted";
}

export function redactToken(r: TokenRecord, v: Viewer): PlayerTokenRecord {
  const { definitionId: _definitionId, speed, fogged, ...rest } = r;
  // FOG §9: `fogged` reaches a player only on their own tokens (as `speed`).
  return r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId
    ? { ...rest, speed, ...(fogged ? { fogged } : {}) }
    : rest;
}
