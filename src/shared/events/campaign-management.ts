// Domain events of campaign-management (CAMP §9). Payloads never hold a link token or the DM secret.
import { PaletteKey } from "@shared/campaign-management/colors";
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

/**
 * FR-CAMP-25, -37: `playerId` null = the DM colour (a `campaign` upsert). `color` is a lowercase
 * `#rrggbb` (sprint 6); sprint-5 log rows keep their palette key and still parse.
 */
export const PlayerColorSet = defineEvent({
  type: "PlayerColorSet",
  payload: z
    .object({
      playerId: z.string().nullable(),
      color: z.union([z.string().regex(/^#[0-9a-f]{6}$/), PaletteKey]),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/**
 * FR-CAMP-39 (ADR-0058): a feature switched on / off (a `campaign` upsert); every connection of
 * the campaign resyncs after the commit (FR-CAMP-40). Logged, not undoable.
 */
export const CampaignFeatureSet = defineEvent({
  type: "CampaignFeatureSet",
  payload: z.object({ feature: z.string(), on: z.boolean() }).strict(),
  logged: true,
  undoable: false,
});
