// Record type `character-gems` (FR-GEM-06, -10): campaign scope, tagged with the `gems` feature
// (ADR-0058: off → hidden for every viewer, DM too). On: DM and every player full (counts only,
// OQ-GEM-01 A).
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { CHARACTER_GEMS_TYPE, CharacterGemsRecord } from "@shared/gems/schemas";
import { defineRecordType, type Visibility } from "../../ws/records";
import { listGems } from "./rows";

/** FR-GEM-10 (OQ-GEM-01 A): every player of the campaign sees every character's counts. */
export const gemsVisibility = (): Visibility => "full";

export const characterGemsType = defineRecordType<CharacterGemsRecord>({
  type: CHARACTER_GEMS_TYPE,
  scope: "campaign",
  feature: GEMS_FEATURE,
  schema: CharacterGemsRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: gemsVisibility,
  snapshot: ({ db }, v) => listGems(db, v.campaignId),
});
