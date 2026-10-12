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
  },
};
