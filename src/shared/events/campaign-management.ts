// Domain events of campaign-management (CAMP §9). Payloads never hold a link token or the DM secret.
import { PlayerColor } from "@shared/campaign-management/colors";
import { z } from "zod";
import { defineEvent } from "./types";

export const CampaignCreated = defineEvent({
  type: "CampaignCreated",
  payload: z.object({ campaignId: z.string(), name: z.string() }),
  logged: true,
  undoable: false,
});

export const CampaignRenamed = defineEvent({
  type: "CampaignRenamed",
  payload: z.object({ campaignId: z.string(), name: z.string() }),
  logged: true,
  undoable: false,
});

/** Also emitted by create when none is active, with previousCampaignId null (CON-10). */
export const CampaignActivated = defineEvent({
  type: "CampaignActivated",
  payload: z.object({ campaignId: z.string(), previousCampaignId: z.string().nullable() }),
  logged: true,
  undoable: false,
});

export const PlayerAdded = defineEvent({
  type: "PlayerAdded",
  payload: z.object({ playerId: z.string(), campaignId: z.string(), name: z.string() }).strict(),
  logged: true,
  undoable: false,
});

export const PlayerRenamed = defineEvent({
  type: "PlayerRenamed",
  payload: z.object({ playerId: z.string(), campaignId: z.string(), name: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/** FR-CAMP-25 (sprint 5): `playerId` null = the DM colour (a `campaign` upsert). */
export const PlayerColorSet = defineEvent({
  type: "PlayerColorSet",
  payload: z.object({ playerId: z.string().nullable(), color: PlayerColor }).strict(),
  logged: true,
  undoable: false,
});
