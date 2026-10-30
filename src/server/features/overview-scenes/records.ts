// Record types `overview`, `overview-item` (FR-OVW-07, -08, ADR-0075 Decision 2): `scope: "scene"`
// with `sceneOf` = the overview's ID. Items are windowed for the DM: the snapshot holds the shown
// overview's, others load with `sync.loadScene`.
import {
  OVERVIEW_ITEM_TYPE,
  OVERVIEW_TYPE,
  OverviewItemRecord,
  OverviewRecord,
} from "@shared/overview-scenes/schemas";
import { defineRecordType } from "../../ws/records";
import { campaignItems, campaignOverviews } from "./rows";
import { itemVisibility, overviewVisibility, redactItem, redactOverview } from "./visibility";

export const overviewRecordTypes = [
  defineRecordType<OverviewRecord>({
    type: OVERVIEW_TYPE,
    scope: "scene",
    schema: OverviewRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.id,
    visibility: overviewVisibility,
    redact: redactOverview,
    // ≤ 50 per campaign (FR-OVW-01).
    snapshot: ({ db }, v) => campaignOverviews(db, v.campaignId),
  }),
  defineRecordType<OverviewItemRecord>({
    type: OVERVIEW_ITEM_TYPE,
    scope: "scene",
    schema: OverviewItemRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    sceneOf: (r) => r.overviewId,
    visibility: itemVisibility,
    redact: redactItem,
    dmWindow: "active-scene",
    // ≤ 3,000 per campaign (FR-OVW-15).
    snapshot: ({ db }, v, scope) => campaignItems(db, v.campaignId, scope),
  }),
] as const;
