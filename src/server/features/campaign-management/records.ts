// Record types `campaign` and `player` (CAMP §9). Scope campaign; full for own campaign.
import { CampaignRecord, PlayerRecord } from "@shared/campaign-management/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { campaign, player } from "../../db/schema";
import { defineRecordType } from "../../ws/records";

export const toCampaignRecord = (row: { id: string; name: string }): CampaignRecord => ({
  id: row.id,
  name: row.name,
});

/** The only mapping from a player row to anything synced: the token is dropped here. */
export const toPlayerRecord = (row: {
  id: string;
  campaignId: string;
  name: string;
}): PlayerRecord => ({ id: row.id, campaignId: row.campaignId, name: row.name });

export const campaignRecordType = defineRecordType<CampaignRecord>({
  type: "campaign",
  scope: "campaign",
  schema: CampaignRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.id,
  visibility: () => "full",
  snapshot: ({ db }, v) =>
    db
      .select({ id: campaign.id, name: campaign.name })
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
  // OQ-CAMP-13 (proposed): players see {id, name} of every player in their campaign.
  visibility: () => "full",
  snapshot: ({ db }, v) =>
    db
      .select({ id: player.id, campaignId: player.campaignId, name: player.name })
      .from(player)
      .where(eq(player.campaignId, v.campaignId))
      .orderBy(asc(player.createdAt), asc(sql`rowid`))
      .all()
      .map(toPlayerRecord),
});
