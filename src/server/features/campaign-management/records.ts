// Record types `campaign` and `player` (CAMP §9). Scope campaign; full for own campaign (sprint 5:
// with `dmColor` / `color`, FR-CAMP-29).
import { CampaignRecord, PlayerRecord } from "@shared/campaign-management/schemas";
import {
  type AlertSounds,
  type CampaignPause,
  noAlertSounds,
} from "@shared/campaign-management/table-state";
import { asc, eq, sql } from "drizzle-orm";
import { campaign, player } from "../../db/schema";
import { defineRecordType } from "../../ws/records";

/**
 * The only mapping from a campaign row to the wire. FR-CAMP-38: `features` only when some feature
 * is on (all off = no key, 0 B). *(Sprint 8)* FR-CAMP-46, -48: `pause` only while paused,
 * `alertSounds` only when some alert has a pick. Callers pass the whole row, so an upsert from any
 * command (rename, colour, switch) keeps both.
 */
export const toCampaignRecord = (row: {
  id: string;
  name: string;
  dmColor: string;
  features: readonly string[];
  pause: CampaignPause | null;
  alertSounds: AlertSounds;
}): CampaignRecord => {
  const rec: CampaignRecord = { id: row.id, name: row.name, dmColor: row.dmColor };
  if (row.features.length > 0) rec.features = [...row.features];
  if (row.pause !== null) rec.pause = { ...row.pause };
  if (!noAlertSounds(row.alertSounds)) rec.alertSounds = { ...row.alertSounds };
  return rec;
};

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
      .select({
        id: campaign.id,
        name: campaign.name,
        dmColor: campaign.dmColor,
        features: campaign.features,
        pause: campaign.pause,
        alertSounds: campaign.alertSounds,
      })
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
