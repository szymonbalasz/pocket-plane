// Record types `handout`, `handout-body` (one table) and `party-item` (FR-PARTY-01, FR-PARTY-17):
// campaign scope, **lazy** (ADR-0045): never in a snapshot, loaded with `sync.load`. Handout
// visibility is the shared pure fn (FR-PARTY-07); party items are full for the campaign.
import {
  HANDOUT_BODY_TYPE,
  HANDOUT_TYPE,
  HandoutBodyRecord,
  HandoutRecord,
  PARTY_ITEM_TYPE,
  PartyItemRecord,
} from "@shared/party-board/schemas";
import {
  handoutVisibility,
  redactHandout,
  redactHandoutBody,
} from "@shared/party-board/visibility";
import { defineRecordType, type Visibility } from "../../ws/records";
import { handoutBodiesByIds, listHandouts, listPartyItems } from "./rows";

/** FR-PARTY-01 header: lazy `"all"` (the board loads every visible header). */
export const handoutType = defineRecordType<HandoutRecord>({
  type: HANDOUT_TYPE,
  scope: "campaign",
  lazy: "all",
  schema: HandoutRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => handoutVisibility(r, v),
  redact: (r) => redactHandout(r),
  snapshot: ({ db }, v) => listHandouts(db, v.campaignId),
});

/** FR-PARTY-01 body: lazy `"ids"` (a viewer loads one body by id). */
export const handoutBodyType = defineRecordType<HandoutBodyRecord>({
  type: HANDOUT_BODY_TYPE,
  scope: "campaign",
  lazy: "ids",
  schema: HandoutBodyRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => handoutVisibility(r, v),
  redact: (r) => redactHandoutBody(r),
  // Unused for an `"ids"` type's loads (byIds answers them); kept total for the registry.
  snapshot: ({ db }, v) =>
    handoutBodiesByIds(
      db,
      listHandouts(db, v.campaignId).map((h) => h.id),
    ),
  byIds: ({ db }, _v, ids) => handoutBodiesByIds(db, ids),
});

/** FR-PARTY-17: no DM-only field (as LOOT-10); the scope gate keeps other campaigns out. */
export const partyItemVisibility = (): Visibility => "full";

/** FR-PARTY-17: lazy `"all"`. */
export const partyItemType = defineRecordType<PartyItemRecord>({
  type: PARTY_ITEM_TYPE,
  scope: "campaign",
  lazy: "all",
  schema: PartyItemRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: partyItemVisibility,
  snapshot: ({ db }, v) => listPartyItems(db, v.campaignId),
});
