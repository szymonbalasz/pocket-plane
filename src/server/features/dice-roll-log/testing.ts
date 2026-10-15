// Test support for dice-roll-log: in-memory services with one seeded context (FR-DICE-25),
// seeded like the `dice-log` bundle's prerequisites.

import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import { type CommandContext, manualClock, seededContext } from "../../commands/context";
import { openTestDb } from "../../db/testing";
import type { Actor } from "../../events/types";
import { silentLogger } from "../../log";
import { createServices, type Services } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import type { Viewer } from "../../ws/records";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";
import { createEntity } from "../entities/commands";
import { goblinBlock, miraBlock, testSource, thornBlock } from "../entities/testing";
import { createScene, placeToken } from "../scenes-map/commands";
import { addAsset } from "../scenes-map/testing";

export function diceServices(seed = "dice-test"): { s: Services; ctx: CommandContext } {
  const clock = manualClock();
  const ctx = seededContext({ disposable: true, key: seed, clock });
  const s = createServices({
    config: createTestServices().config,
    db: openTestDb(),
    log: silentLogger,
    clock,
    ctx: () => ctx,
  });
  return { s, ctx };
}

export function seedDice(s: Services) {
  const run = s.commands.run.bind(s.commands);
  const campaign = run(createCampaign, { name: "Fixture Campaign" }, { actor: DM_ACTOR });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: DM_ACTOR });
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: DM_ACTOR });
  const second = run(createCampaign, { name: "Second Campaign" }, { actor: DM_ACTOR });
  const dm: Actor = { ...DM_ACTOR, campaignId: campaign.id };
  const imported = run(
    "import.batch",
    {
      source: testSource,
      records: [
        { kind: "monster", sourceKey: "goblin", data: { name: "Goblin", statBlock: goblinBlock } },
      ],
    },
    { actor: dm },
  ) as { id: string }[];
  const mira = run(
    createEntity.name,
    { kind: "character", name: "Mira", ownerPlayerId: p1.id, statBlock: miraBlock },
    { actor: dm },
  ) as { id: string };
  const thorn = run(
    createEntity.name,
    { kind: "character", name: "Thorn", ownerPlayerId: p2.id, statBlock: thornBlock },
    { actor: dm },
  ) as { id: string };
  run(activateCampaign, { id: second.id }, { actor: DM_ACTOR });
  const otherChar = run(
    createEntity.name,
    {
      kind: "character",
      name: "Stranger",
      ownerPlayerId: run(addPlayer, { name: "Second Player" }, { actor: DM_ACTOR }).id,
      statBlock: miraBlock,
    },
    { actor: { ...DM_ACTOR, campaignId: second.id } },
  ) as { id: string };
  const dmSecond: Actor = { ...DM_ACTOR, campaignId: second.id };
  // A scene + goblin token in each campaign (token actors, FR-DICE-10).
  const tokenIn = (cid: string, actor: Actor) => {
    addAsset(s, `map-${cid}`, cid);
    const sc = run(createScene, { name: "Battle", mapAssetId: `map-${cid}` }, { actor });
    // FR-FOG-25 ripple: new scenes start fogged; reveal it.
    run(FOG_INTENTS.setAll, { sceneId: sc.id, fogged: false }, { actor });
    return run(
      placeToken,
      { sceneId: sc.id, definitionId: imported[0]?.id as string, col: 1, row: 1, name: "Boss" },
      { actor },
    ).tokenId;
  };
  const otherToken = tokenIn(second.id, dmSecond);
  run(activateCampaign, { id: campaign.id }, { actor: DM_ACTOR });
  const bossToken = tokenIn(campaign.id, dm);
  const player = (id: string): Actor => ({ role: "player", playerId: id, campaignId: campaign.id });
  const viewer = (role: "dm" | "player", playerId: string | null = null, cid = campaign.id) =>
    ({ connId: "test", campaignId: cid, role, playerId }) satisfies Viewer;
  const snapshot = (v: Viewer) => s.records.snapshot({ db: s.db, presence: { list: () => [] } }, v);
  return {
    campaignId: campaign.id,
    secondCampaignId: second.id,
    p1,
    p2,
    dm,
    p1Actor: player(p1.id),
    p2Actor: player(p2.id),
    goblinId: imported[0]?.id as string,
    miraId: mira.id,
    thornId: thorn.id,
    strangerId: otherChar.id,
    tokenId: bossToken,
    otherTokenId: otherToken,
    viewer,
    snapshot,
  };
}
