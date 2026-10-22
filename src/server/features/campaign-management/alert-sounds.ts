// `camp.setAlertSound` (FR-CAMP-48, sprint 8 TT3): the DM's alert-sound picks on the campaign row.
// Players need the picked IDs (they fetch only those sounds' capability URLs); the library itself
// stays DM only (`audio-asset`, FR-ASSET-57).
import {
  type AlertSounds,
  SET_ALERT_SOUND_INTENT,
  SetAlertSoundInput,
} from "@shared/campaign-management/table-state";
import { AlertSoundSet } from "@shared/events/campaign-management";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import { campaign } from "../../db/schema";
import { requireAsset } from "../assets-pipeline/commands";
import { actorCampaign } from "./features";
import { toCampaignRecord } from "./records";

/**
 * `camp.setAlertSound {alert, sound}` (DM): `default` removes the key, `none` silences, else an
 * audio asset of the campaign (`assets.require` kind audio: unknown → `not_found`, an image →
 * `invalid`). Same value → no-op, no event. Else `AlertSoundSet {alert}` with the `campaign`
 * upsert (every connection; logged, not undoable). Two DM tabs: last wins.
 */
export const setAlertSound = defineCommand({
  name: SET_ALERT_SOUND_INTENT,
  input: SetAlertSoundInput,
  execute({ alert, sound }, env) {
    const camp = actorCampaign(env);
    if (!camp) throw notFound("Campaign not found");
    if (sound !== "default" && sound !== "none") requireAsset(env, sound, { kind: "audio" });
    const current = camp.alertSounds[alert];
    if ((sound === "default" ? undefined : sound) === current) return {};
    const alertSounds: AlertSounds = Object.fromEntries(
      Object.entries(camp.alertSounds).filter(([k]) => k !== alert),
    );
    if (sound !== "default") alertSounds[alert] = sound;
    env.tx
      .update(campaign)
      .set({ alertSounds, updatedAt: env.ctx.clock.iso() })
      .where(eq(campaign.id, camp.id))
      .run();
    env.emit({
      type: AlertSoundSet.type,
      campaignId: camp.id,
      payload: { alert },
      changes: [
        {
          type: "campaign",
          id: camp.id,
          before: toCampaignRecord(camp),
          after: toCampaignRecord({ ...camp, alertSounds }),
        },
      ],
    });
    return {};
  },
});
