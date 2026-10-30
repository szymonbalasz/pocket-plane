// Player visibility per record type (FR-OVW-39, -40). Reads record + viewer only. The scene gate
// runs before these: a player only reaches them for the shown overview.
import type {
  OverviewItemRecord,
  OverviewRecord,
  PlayerOverviewItemRecord,
  PlayerOverviewRecord,
} from "@shared/overview-scenes/schemas";
import type { Visibility } from "../../ws/records";

export const overviewVisibility = (): Visibility => "redacted";

export const redactOverview = (r: OverviewRecord): PlayerOverviewRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  active: r.active,
});

/** Reveal = `upsert`, hide = `delete` (the transition matrix). */
export const itemVisibility = (r: OverviewItemRecord): Visibility =>
  r.hidden ? "hidden" : "redacted";

export function redactItem(r: OverviewItemRecord): PlayerOverviewItemRecord {
  const { locked: _locked, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = r;
  return rest;
}
