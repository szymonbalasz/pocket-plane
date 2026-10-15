// Record type `effect-preset` (FR-MOD-22, protocol §34). Campaign scope; DM full; a player gets
// the rows they own (`ownerPlayerId`, their character presets) in full, every other row hidden.
// Snapshot: all rows of the campaign (≤ 40 campaign + 6 per character, FR-MOD-06/07).
//
// The one transport seam for presets (#190 D5 A): moving campaign presets to on-demand loading
// later changes this registration and the clients' preset store only.
import {
  EFFECT_PRESET_TYPE,
  EffectPresetRecord,
  type EffectPresetRecord as PresetRecord,
} from "@shared/effect-modifiers/schemas";
import { asc, eq } from "drizzle-orm";
import { effectPreset } from "../../db/schema";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import { toPresetRecord } from "./rows";

export const presetVisibility = (r: PresetRecord, v: Viewer): Visibility =>
  r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId ? "full" : "hidden";

export const effectPresetRecordType = defineRecordType<PresetRecord>({
  type: EFFECT_PRESET_TYPE,
  scope: "campaign",
  schema: EffectPresetRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: presetVisibility,
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.campaignId, v.campaignId))
      .orderBy(asc(effectPreset.seq))
      .all()
      .map(toPresetRecord),
});
