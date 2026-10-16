// Player visibility per SCN record type (SCN §9, FR-SCN-14, -19, -27; protocol §36). Reads record
// + viewer only (ADR-0021); fog-hidden comes from the scene visibility hooks' `hides` (ADR-0039).
// The scene gate (CON-22) runs first: players only reach these for the active scene.

import { doorSeenBy } from "@shared/fog-of-war/visibility";
import {
  AOE_TEMPLATE_TYPE,
  type AoeTemplateRecord,
  DOOR_OPEN,
  type PlayerAoeTemplateRecord,
  type PlayerScenePropRecord,
  type PlayerSceneStructureRecord,
  SCENE_PROP_TYPE,
  type ScenePropRecord,
  type SceneStructureRecord,
} from "@shared/scene-tools/schemas";
import type { Viewer, Visibility } from "../../ws/records";
import { hiddenByHooks } from "../scenes-map/visibility-hooks";

/** `scene-structure`: always redacted for players (doors only). */
export const structureVisibility = (): Visibility => "redacted";

/**
 * FR-SCN-14 / -36 (per player, ADR-0042): no walls; each door as `[n, x1, y1, x2, y2, open]` with
 * locked sent as closed; a door reaches the viewer iff they are in its `doorSeen` entry (null =
 * pre-v2: none). Never `doorSeen` or `f`. Pure.
 */
export function redactStructure(r: SceneStructureRecord, v: Viewer): PlayerSceneStructureRecord {
  return {
    id: r.id,
    doors: r.doors
      .filter((d) => doorSeenBy(r.doorSeen, d[0], v.playerId))
      .map(([n, x1, y1, x2, y2, state]) => [n, x1, y1, x2, y2, state === DOOR_OPEN ? 1 : 0]),
  };
}

/** FR-SCN-19: `hidden` or fog-hidden → hidden; else redacted (no `locked`, no campaign). */
export function propVisibility(r: ScenePropRecord, v: Viewer): Visibility {
  return r.hidden || hiddenByHooks(SCENE_PROP_TYPE, r, v) ? "hidden" : "redacted";
}

export function redactProp(r: ScenePropRecord): PlayerScenePropRecord {
  const { campaignId: _campaignId, locked: _locked, seenBy: _seenBy, ...rest } = r;
  return rest;
}

/**
 * FR-SCN-27: `hidden` or fog-hidden → hidden; else every field (incl. `placedByPlayerId`) but
 * `campaignId`, which only the DM wire keeps (SCN §8 compact wire). Fog's `hides` exempts
 * player-placed templates (FR-FOG-11); their `fogged` copy stays DM-only too (FOG §13: no player
 * record carries `fogged: true` but the viewer's own tokens).
 */
export function templateVisibility(r: AoeTemplateRecord, v: Viewer): Visibility {
  return r.hidden || hiddenByHooks(AOE_TEMPLATE_TYPE, r, v) ? "hidden" : "redacted";
}

export function redactTemplate(r: AoeTemplateRecord): PlayerAoeTemplateRecord {
  const { campaignId: _campaignId, fogged: _fogged, seenBy: _seenBy, ...rest } = r;
  return rest;
}

/** `map-settings`: everyone (FR-SCN-29). */
export const settingsVisibility = (): Visibility => "full";
