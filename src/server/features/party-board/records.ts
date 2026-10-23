// Record types `handout`, `handout-body` (one table) and `party-item` (FR-PARTY-01, FR-PARTY-17):
// campaign scope, **lazy** (ADR-0045): never in a snapshot, loaded with `sync.load`. Handout
// visibility is the shared pure fn (FR-PARTY-07); party items are full for the campaign.
// *(S5)* `handout-present` (FR-PARTY-31) is **in the snapshot**: own row per player.
import {
  HANDOUT_BODY_TYPE,
  HANDOUT_PRESENT_TYPE,
  HANDOUT_TYPE,
  HandoutBodyRecord,
  HandoutPresentRecord,
  HandoutRecord,
  PARTY_ITEM_TYPE,
  PartyItemRecord,
} from "@shared/party-board/schemas";
import {
  handoutVisibility,
  presentVisibility,
  redactHandout,
  redactHandoutBody,
} from "@shared/party-board/visibility";
import { partyItemVisibility } from "@shared/party-loot/visibility";
import { defineRecordType } from "../../ws/records";
import { handoutBodiesByIds, listHandouts, listPartyItems, listPresents } from "./rows";

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

/**
 * FR-PARTY-17: lazy `"all"`; full for the campaign (as LOOT-10). *(S9)* Rows of a hidden Stores and
 * DM-only Stores items are hidden from players (FR-LOOT-32, -36).
 */
export const partyItemType = defineRecordType<PartyItemRecord>({
  type: PARTY_ITEM_TYPE,
  scope: "campaign",
  lazy: "all",
  schema: PartyItemRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => partyItemVisibility(r, v),
  snapshot: ({ db }, v) => listPartyItems(db, v.campaignId),
});

/**
 * FR-PARTY-31 (S5): not lazy (it must reach a player who never opens the board): ≤ 20 rows for
 * the DM, ≤ 1 for a player (the provider reads only the viewer's row; the filter is the rule).
 */
export const handoutPresentType = defineRecordType<HandoutPresentRecord>({
  type: HANDOUT_PRESENT_TYPE,
  scope: "campaign",
  schema: HandoutPresentRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => presentVisibility(r, v),
  snapshot: ({ db }, v) =>
    v.role === "dm"
      ? listPresents(db, v.campaignId)
      : v.playerId === null
        ? []
        : listPresents(db, v.campaignId, v.playerId),
});
