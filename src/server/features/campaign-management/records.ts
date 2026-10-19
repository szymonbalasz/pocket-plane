// Record types `campaign` and `player` (CAMP §9). Scope campaign; full for own campaign (sprint 5:
// with `dmColor` / `color`, FR-CAMP-29).
import { CampaignRecord, PlayerRecord } from "@shared/campaign-management/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { campaign, player } from "../../db/schema";
import { defineRecordType } from "../../ws/records";

export const toCampaignRecord = (row: {
  id: string;
  name: string;
  dmColor: string;
}): CampaignRecord => ({ id: row.id, name: row.name, dmColor: row.dmColor });

/**
 * The only mapping from a player row to anything synced: the token is dropped here. A null
 * colour can't reach the wire: the boot backfill fills every row first (FR-CAMP-23).
 */
export const toPlayerRecord = (row: {
  id: string;
  campaignId: string;
  name: string;
  color: string | null;
}): PlayerRecord => {
  if (row.color === null) throw new Error(`player ${row.id} has no colour (backfill not run)`);
  return { id: row.id, campaignId: row.campaignId, name: row.name, color: row.color };
};

export const campaignRecordType = defineRecordType<CampaignRecord>({
  type: "campaign",
  scope: "campaign",
  schema: CampaignRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.id,
  visibility: () => "full",
  snapshot: ({ db }, v) =>
    db
      .select({ id: campaign.id, name: campaign.name, dmColor: campaign.dmColor })
      .from(campaign)
      .where(eq(campaign.id, v.campaignId))
      .all()
      .map(toCampaignRecord),
});

export const playerRecordType = defineRecordType<PlayerRecord>({
  type: "player",
  scope: "campaign",
  schema: PlayerRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  // OQ-CAMP-13 (proposed): players see {id, name} of every player in their campaign; FR-CAMP-29:
  // and every colour (not secret).
  visibility: () => "full",
  snapshot: ({ db }, v) =>
    db
      .select({
        id: player.id,
        campaignId: player.campaignId,
        name: player.name,
        color: player.color,
      })
      .from(player)
      .where(eq(player.campaignId, v.campaignId))
      .orderBy(asc(player.createdAt), asc(sql`rowid`))
      .all()
      .map(toPlayerRecord),
});
