// `presence` record type: DM only, never sent to players (FR-SYNC-23, CON-07).
import { PresenceRecord } from "@shared/live-sync/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { player } from "../../db/schema";
import { defineRecordType } from "../../ws/records";

export const presenceRecordType = defineRecordType<PresenceRecord>({
  type: "presence",
  scope: "campaign",
  audience: "dm",
  schema: PresenceRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "hidden",
  snapshot({ db, presence }, v) {
    if (v.role !== "dm") return [];
    const online = new Set(
      presence
        .list(v.campaignId)
        .filter((p) => p.online)
        .map((p) => p.playerId),
    );
    return db
      .select({ id: player.id })
      .from(player)
      .where(eq(player.campaignId, v.campaignId))
      .orderBy(asc(player.createdAt), asc(sql`rowid`))
      .all()
      .map((p) => ({
        id: p.id,
        playerId: p.id,
        campaignId: v.campaignId,
        online: online.has(p.id),
      }));
  },
});
