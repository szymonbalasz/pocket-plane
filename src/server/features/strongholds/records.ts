// Record types `stronghold` (lazy `"all"`, FR-HOLD-01, -08) and the derived snapshot type
// `stronghold-index` (≤ 8 rows, review ruling 6). DM full; a player never gets a DM-only
// stronghold (not even its index row); a shown one redacted inside (no DM-only rows / fields,
// no flags, `seq` or `updatedAt`).
import {
  redactIndex,
  redactStronghold,
  STRONGHOLD_INDEX_TYPE,
  STRONGHOLD_TYPE,
  StrongholdIndexRecord,
  StrongholdRecord,
  strongholdVisibility,
} from "@shared/strongholds/schemas";
import { defineRecordType } from "../../ws/records";
import { listIndex, listStrongholds } from "./rows";

export const strongholdType = defineRecordType<StrongholdRecord>({
  type: STRONGHOLD_TYPE,
  scope: "campaign",
  lazy: "all",
  schema: StrongholdRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => strongholdVisibility(r, v),
  redact: (r) => redactStronghold(r),
  snapshot: ({ db }, v) => listStrongholds(db, v.campaignId),
});

export const strongholdIndexType = defineRecordType<StrongholdIndexRecord>({
  type: STRONGHOLD_INDEX_TYPE,
  scope: "campaign",
  derived: true,
  schema: StrongholdIndexRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => strongholdVisibility(r, v),
  redact: (r) => redactIndex(r),
  snapshot: ({ db }, v) => listIndex(db, v.campaignId),
});
