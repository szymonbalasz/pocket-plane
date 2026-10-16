// Record type `dice-look` (FR-DICEX-25): campaign scope, full to the DM and every player, always
// in the snapshot (not lazy: a throw draws the roller's look in the frame its entry arrives).
import { DICE_LOOK_TYPE, DiceLookRecord } from "@shared/dice-extras/looks";
import { defineRecordType, type Visibility } from "../../ws/records";
import { listLooks } from "./rows";

/** FR-DICEX-25: everyone in the campaign; the scope gate keeps other campaigns out. */
export const lookVisibility = (): Visibility => "full";

export const diceLookType = defineRecordType<DiceLookRecord>({
  type: DICE_LOOK_TYPE,
  scope: "campaign",
  schema: DiceLookRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: lookVisibility,
  snapshot: ({ db }, v) => listLooks(db, v.campaignId),
});
