// Domain events of campaign-management (CAMP §9). Payloads never hold a link token or the DM secret.
import { PaletteKey } from "@shared/campaign-management/colors";
import { AlertKey } from "@shared/campaign-management/table-state";
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

/**
 * FR-CAMP-47 (sprint 8, TT4): `camp.pause` (a new pause or an update of the card) /
 * `camp.resume`: a `campaign` upsert to every connection, no forced resync. Logged, not undoable.
 */
export const CampaignPaused = defineEvent({
  type: "CampaignPaused",
  payload: z.object({ campaignId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

export const CampaignResumed = defineEvent({
  type: "CampaignResumed",
  payload: z.object({ campaignId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/**
 * FR-CAMP-48 (sprint 8, TT3): `camp.setAlertSound`: a `campaign` upsert to every connection
 * (players need the picked IDs; the library stays DM only). Logged, not undoable.
 */
export const AlertSoundSet = defineEvent({
  type: "AlertSoundSet",
  payload: z.object({ alert: AlertKey }).strict(),
  logged: true,
  undoable: false,
});
