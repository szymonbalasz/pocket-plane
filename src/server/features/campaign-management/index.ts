import { CampaignActivated } from "@shared/events/campaign-management";
import { CloseCode } from "@shared/protocol/codes";
import { eq } from "drizzle-orm";
import { player } from "../../db/schema";
import type { Feature } from "../../services";
import { createResolvers, DmSecretChecker } from "./auth";
import {
  activateCampaign,
  addPlayer,
  createCampaign,
  renameCampaign,
  renamePlayer,
} from "./commands";
import { campaignRecordType, playerRecordType } from "./records";

export const campaignManagement: Feature = {
  name: "campaign-management",
  register(r) {
    const s = r.services;
    // No WS intents (CAMP §9): REST + fixtures only.
    r.command(createCampaign);
    r.command(renameCampaign);
    r.command(activateCampaign);
    r.command(addPlayer);
    r.command(renamePlayer);
    r.recordType(campaignRecordType);
    r.recordType(playerRecordType);
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
