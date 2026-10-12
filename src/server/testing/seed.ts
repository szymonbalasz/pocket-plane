// Test seed equal in content to the `sync-probe` bundle, via the same commands.
import {
  activateCampaign,
  addPlayer,
  createCampaign,
} from "../features/campaign-management/commands";
import { probeSet } from "../features/live-sync/probe";
import type { Services } from "../services";
import { DM_ACTOR } from "./services";

export function seedSyncProbe(s: Services) {
  const run = s.commands.run.bind(s.commands);
  const campaign = run(createCampaign, { name: "Fixture Campaign" }, { actor: DM_ACTOR });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: DM_ACTOR });
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: DM_ACTOR });
  const second = run(createCampaign, { name: "Second Campaign" }, { actor: DM_ACTOR });
  run(activateCampaign, { id: second.id }, { actor: DM_ACTOR });
  const p3 = run(addPlayer, { name: "Second Player" }, { actor: DM_ACTOR });
  run(activateCampaign, { id: campaign.id }, { actor: DM_ACTOR });
  const dm = { ...DM_ACTOR, campaignId: campaign.id };
  const pub = run(probeSet, { text: "public", hidden: false }, { actor: dm });
  const secret = run(probeSet, { text: "SECRET-PROBE", hidden: true }, { actor: dm });
  const mine = run(probeSet, { text: "mine", hidden: false, ownerPlayerId: p1.id }, { actor: dm });
  return {
    campaignId: campaign.id,
    secondCampaignId: second.id,
    p1,
    p2,
    p3,
    probes: { public: pub.id, secret: secret.id, mine: mine.id },
  };
}
