// `camp.pause` / `camp.resume` (FR-CAMP-47, sprint 8 TT4): the pause card on the campaign row.
// Every connection of the campaign gets the `campaign` upsert (players draw the card from
// `campaign.pause`); no forced resync. The input block and the suppression are client only
// (OQ-SHELL-70 A): the server accepts player intents as before.
import {
  backAtFrom,
  type CampaignPause,
  PAUSE_INTENT,
  PauseInput,
  RESUME_INTENT,
  ResumeInput,
} from "@shared/campaign-management/table-state";
import { CampaignPaused, CampaignResumed } from "@shared/events/campaign-management";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import { campaign } from "../../db/schema";
import { requireAsset } from "../assets-pipeline/commands";
import { actorCampaign } from "./features";
import { toCampaignRecord } from "./records";

const samePause = (a: CampaignPause | null, b: CampaignPause | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.message === b.message &&
    a.imageAssetId === b.imageAssetId &&
    a.backAt === b.backAt);

/** Writes `pause` and emits `type` with the `campaign` upsert (every connection; logged). */
function writePause(
  env: CommandEnv,
  camp: NonNullable<ReturnType<typeof actorCampaign>>,
  pause: CampaignPause | null,
  type: typeof CampaignPaused.type | typeof CampaignResumed.type,
) {
  env.tx
    .update(campaign)
    .set({ pause, updatedAt: env.ctx.clock.iso() })
    .where(eq(campaign.id, camp.id))
    .run();
  env.emit({
    type,
    campaignId: camp.id,
    payload: { campaignId: camp.id },
    changes: [
      {
        type: "campaign",
        id: camp.id,
        before: toCampaignRecord(camp),
        after: toCampaignRecord({ ...camp, pause }),
      },
    ],
  });
}

/**
 * `camp.pause {message?, imageAssetId?, backInMin?}` (DM): a new pause, or an update of the card
 * while paused (`startedAt` kept; a field left out keeps its value). The image via
 * `assets.require` (kind image). Same values → no-op, no event. Two DM tabs: last wins.
 */
export const pauseCampaign = defineCommand({
  name: PAUSE_INTENT,
  input: PauseInput,
  execute(input, env) {
    const camp = actorCampaign(env);
    if (!camp) throw notFound("Campaign not found");
    const was = camp.pause;
    const imageAssetId =
      input.imageAssetId === undefined ? (was?.imageAssetId ?? null) : input.imageAssetId;
    if (imageAssetId !== null && imageAssetId !== was?.imageAssetId) {
      requireAsset(env, imageAssetId, { kind: "image" });
    }
    const backAt =
      input.backInMin === undefined
        ? (was?.backAt ?? null)
        : input.backInMin === null
          ? null
          : backAtFrom(env.ctx.clock.now(), input.backInMin);
    const pause: CampaignPause = {
      message: input.message === undefined ? (was?.message ?? null) : input.message,
      imageAssetId,
      backAt,
      startedAt: was?.startedAt ?? env.ctx.clock.iso(),
    };
    if (samePause(was, pause)) return {};
    writePause(env, camp, pause, CampaignPaused.type);
    return {};
  },
});

/** `camp.resume {}` (DM): running already → no-op, no event. */
export const resumeCampaign = defineCommand({
  name: RESUME_INTENT,
  input: ResumeInput,
  execute(_input, env) {
    const camp = actorCampaign(env);
    if (!camp) throw notFound("Campaign not found");
    if (camp.pause === null) return {};
    writePause(env, camp, null, CampaignResumed.type);
    return {};
  },
});
