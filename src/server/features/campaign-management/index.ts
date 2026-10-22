import { CampaignActivated, CampaignFeatureSet } from "@shared/events/campaign-management";
import { CloseCode } from "@shared/protocol/codes";
import { eq } from "drizzle-orm";
import { player } from "../../db/schema";
import type { Feature } from "../../services";
import { setAlertSound } from "./alert-sounds";
import { createResolvers, DmSecretChecker } from "./auth";
import { migratePlayerColors, setColor } from "./colors";
import {
  activateCampaign,
  addPlayer,
  createCampaign,
  renameCampaign,
  renamePlayer,
} from "./commands";
import { campaignFeatures, setFeature } from "./features";
import { pauseCampaign, resumeCampaign } from "./pause";
import { campaignRecordType, playerRecordType } from "./records";

export const campaignManagement: Feature = {
  name: "campaign-management",
  register(r) {
    const s = r.services;
    // REST + fixtures only (CAMP §9).
    r.command(createCampaign);
    r.command(renameCampaign);
    r.command(activateCampaign);
    r.command(addPlayer);
    r.command(renamePlayer);
    // Sprint 5: the one WS intent (FR-CAMP-25).
    r.command(setColor, { intent: true });
    // Sprint 7 (ADR-0058, FR-CAMP-39): feature switches.
    r.command(setFeature, { intent: true });
    // Sprint 8 (FR-CAMP-48, TT3): the DM's alert-sound picks.
    r.command(setAlertSound, { intent: true });
    // Sprint 8 (FR-CAMP-47, TT4): the pause card.
    r.command(pauseCampaign, { intent: true });
    r.command(resumeCampaign, { intent: true });
    r.recordType(campaignRecordType);
    r.recordType(playerRecordType);
    // FR-CAMP-23 / -34: keys → hex, then fill, before the server listens (no snapshot carries a
    // null or a key).
    r.onStart("campaign-management.color-backfill", (sv) => {
      const { normalised, filled } = migratePlayerColors(sv.db);
      if (normalised + filled > 0) {
        sv.log.info(
          `campaign-management: ${normalised} colour(s) to hex, ${filled} default(s) filled (FR-CAMP-34)`,
        );
      }
    });
    r.provideAuth(createResolvers(s.db, new DmSecretChecker(s.config.dmSecret, s.clock)));
    // FR-FOG-43: `sync.loadScene {viewAs}` accepts only a player of the DM's campaign.
    s.records.providePlayerCampaign(
      (playerId) =>
        s.db
          .select({ campaignId: player.campaignId })
          .from(player)
          .where(eq(player.id, playerId))
          .get()?.campaignId ?? null,
    );
    // ADR-0058: the hub reads a campaign's switches whenever it builds a snapshot.
    s.records.provideCampaignFeatures((campaignId) => campaignFeatures(s.db, campaignId));
    // FR-CAMP-40: after a switch commits, every connection of the campaign (DM tabs and players)
    // gets a fresh snapshot with the new viewer `features` (client-only UI state is kept).
    r.listener("feature-switch", ({ event }) => {
      if (event.type !== CampaignFeatureSet.type || event.campaignId === null) return;
      const campaignId = event.campaignId;
      s.hub?.resync((c) => c.campaignId === campaignId);
    });
    // FR-CAMP-09 / FR-SYNC-07: after an activation commits, close every connection of another
    // campaign with 4409 campaign-inactive (DM reconnects, players wait).
    r.listener("campaign-switch", ({ event }) => {
      if (event.type !== CampaignActivated.type) return;
      const { campaignId } = CampaignActivated.payload.parse(event.payload);
      s.hub?.disconnect(
        (c) => c.campaignId !== null && c.campaignId !== campaignId,
        CloseCode.campaignInactive,
      );
    });
  },
};
