// FR-FOG-49 (sprint 4, ADR party vision): the campaign's fog settings. `fog_settings` holds one
// row per campaign (no row = party vision off); the `fog-settings` record (campaign scope, id =
// campaignId, wire `{id, partyVision}`) reaches every viewer, in the snapshot (one record per
// campaign even without a row, so clients always hold the switch's state).
import {
  FOG_SETTINGS_TYPE,
  FogSettingsRecord,
  type FogSettingsRecord as FogSettingsWire,
} from "@shared/fog-of-war/schemas";
import { eq } from "drizzle-orm";
import { fogSettings } from "../../db/schema";
import { defineRecordType } from "../../ws/records";
import type { SceneRead } from "../scenes-map/visibility-hooks";

/** FR-FOG-49: party vision on for the campaign (no row = off). */
export function partyVisionOn(read: SceneRead, campaignId: string): boolean {
  return (
    read
      .select({ on: fogSettings.partyVision })
      .from(fogSettings)
      .where(eq(fogSettings.campaignId, campaignId))
      .get()?.on === true
  );
}

/** The campaign's `fog-settings` record (a row or the defaults). */
export function readFogSettings(read: SceneRead, campaignId: string): FogSettingsWire {
  return { id: campaignId, partyVision: partyVisionOn(read, campaignId) };
}

export const fogSettingsRecordType = defineRecordType<FogSettingsWire>({
  type: FOG_SETTINGS_TYPE,
  scope: "campaign",
  schema: FogSettingsRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.id,
  visibility: () => "full",
  snapshot: ({ db }, v) => [readFogSettings(db, v.campaignId)],
});
