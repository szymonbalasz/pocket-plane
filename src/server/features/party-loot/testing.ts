// Test support for party-loot: in-memory services seeded like the `party-loot` bundle's
// prerequisites (two players, Mira + Thorn, a second campaign with its own character).
import type { Endpoint } from "@shared/party-loot/schemas";
import type { Actor, DispatchedEvent } from "../../events/types";
import type { Services } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import type { Viewer } from "../../ws/records";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";
import { createEntity } from "../entities/commands";
import { miraBlock, thornBlock } from "../entities/testing";

export function seedLoot(s: Services = createTestServices()) {
  const run = s.commands.run.bind(s.commands);
  const campaign = run(createCampaign, { name: "Fixture Campaign" }, { actor: DM_ACTOR });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: DM_ACTOR });
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: DM_ACTOR });
  const dm: Actor = { ...DM_ACTOR, campaignId: campaign.id };
  const character = (name: string, ownerPlayerId: string, actor: Actor) =>
    (
      run(
        createEntity.name,
        {
          kind: "character",
          name,
          ownerPlayerId,
          statBlock: name === "Thorn" ? thornBlock : miraBlock,
        },
        { actor },
      ) as { id: string }
    ).id;
  const miraId = character("Mira", p1.id, dm);
  const thornId = character("Thorn", p2.id, dm);
  const second = run(createCampaign, { name: "Second Campaign" }, { actor: DM_ACTOR });
  run(activateCampaign, { id: second.id }, { actor: DM_ACTOR });
  const dmSecond: Actor = { ...DM_ACTOR, campaignId: second.id };
  const p3 = run(addPlayer, { name: "Second Player" }, { actor: dmSecond });
  const strangerId = character("Stranger", p3.id, dmSecond);
  run(activateCampaign, { id: campaign.id }, { actor: DM_ACTOR });

  const player = (id: string): Actor => ({ role: "player", playerId: id, campaignId: campaign.id });
  const viewer = (role: "dm" | "player", playerId: string | null = null, cid = campaign.id) =>
    ({ connId: "test", campaignId: cid, role, playerId }) satisfies Viewer;
  const snapshot = (v: Viewer) => s.records.snapshot({ db: s.db, presence: { list: () => [] } }, v);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("loot-test-collect", (e) => events.push(e));
  const char = (characterId: string): Endpoint => ({ kind: "character", characterId });
  return {
    s,
    run,
    campaignId: campaign.id,
    secondCampaignId: second.id,
    p1,
    p2,
    dm,
    dmSecond,
    p1Actor: player(p1.id),
    p2Actor: player(p2.id),
    miraId,
    thornId,
    strangerId,
    mira: char(miraId),
    thorn: char(thornId),
    stranger: char(strangerId),
    party: { kind: "party" } as Endpoint,
    world: { kind: "world" } as Endpoint,
    viewer,
    snapshot,
    events,
  };
}
