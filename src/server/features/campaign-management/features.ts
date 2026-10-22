// Campaign feature switches (FR-CAMP-38–41, -44; ADR-0058): `camp.setFeature` (DM, WS) and the
// `featureOn` check every command of an optional feature runs first. The hub's "off" rule lives
// in `ws/records.ts`; this file only stores and switches.
import { FEATURES, featureDef, hasFeature } from "@shared/campaign-management/features";
import { SetFeatureInput } from "@shared/campaign-management/schemas";
import { CampaignFeatureSet } from "@shared/events/campaign-management";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { forbidden, notFound } from "../../commands/errors";
import type { Db, Tx } from "../../db/client";
import { campaign } from "../../db/schema";
import { activeCampaign } from "./commands";
import { toCampaignRecord } from "./records";

export const SET_FEATURE_INTENT = "camp.setFeature";

/** The actor's campaign row (WS: the connection's; REST / system: the active one). */
export function actorCampaign(env: Pick<CommandEnv, "tx" | "actor">) {
  const id = env.actor.campaignId;
  return id === null
    ? activeCampaign(env.tx)
    : (env.tx.select().from(campaign).where(eq(campaign.id, id)).get() ?? null);
}

/** FR-CAMP-44: is `key` on in the actor's campaign (inside the command's transaction)? */
export function featureOn(env: Pick<CommandEnv, "tx" | "actor">, key: string): boolean {
  return hasFeature(actorCampaign(env)?.features, key);
}

/**
 * FR-CAMP-44: a feature's commands call this first: off → `forbidden` "‹label› is off in this
 * campaign" (or the feature's own wording), nothing written.
 */
export function assertFeatureOn(
  env: Pick<CommandEnv, "tx" | "actor">,
  key: string,
  message = `${featureDef(key)?.label ?? key} is off in this campaign`,
): void {
  if (!featureOn(env, key)) throw forbidden(message);
}

/** The hub's resolver (ADR-0058): a campaign's enabled keys, `[]` for an unknown campaign. */
export function campaignFeatures(db: Db | Tx, campaignId: string): readonly string[] {
  return (
    db
      .select({ features: campaign.features })
      .from(campaign)
      .where(eq(campaign.id, campaignId))
      .get()?.features ?? []
  );
}

/**
 * FR-CAMP-39: `camp.setFeature {feature, on}` (DM only). Unknown key → `invalid` (zod); same value
 * → no-op, no event; else the list in registry order + `CampaignFeatureSet` (a `campaign` upsert).
 * The resync of every connection follows the commit (FR-CAMP-40, the campaign-management listener).
 */
export const setFeature = defineCommand({
  name: SET_FEATURE_INTENT,
  input: SetFeatureInput,
  execute({ feature, on }, env) {
    const camp = actorCampaign(env);
    if (!camp) throw notFound("Campaign not found");
    if (hasFeature(camp.features, feature) === on) return {};
    const want = new Set(camp.features.filter((k) => k !== feature));
    if (on) want.add(feature);
    const features = FEATURES.map((f) => f.key).filter((k) => want.has(k));
    env.tx
      .update(campaign)
      .set({ features, updatedAt: env.ctx.clock.iso() })
      .where(eq(campaign.id, camp.id))
      .run();
    env.emit({
      type: CampaignFeatureSet.type,
      campaignId: camp.id,
      payload: { feature, on },
      changes: [
        {
          type: "campaign",
          id: camp.id,
          before: toCampaignRecord(camp),
          after: toCampaignRecord({ ...camp, features }),
        },
      ],
    });
    return {};
  },
});
