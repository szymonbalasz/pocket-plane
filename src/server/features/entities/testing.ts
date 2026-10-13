// Test support for entities: services with a capturing logger, seeded like the `entities`
// bundle's prerequisites (two campaigns, players, imported goblin + wolf).
import type { Ability } from "@shared/entities/schemas";
import { manualClock, realContext } from "../../commands/context";
import { openTestDb } from "../../db/testing";
import type { Actor } from "../../events/types";
import { type Logger, silentLogger } from "../../log";
import { createServices, type Services } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import type { Viewer } from "../../ws/records";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";

// Same values as `fixtures/srd/monster/*` (server code may not import fixtures, AGENTS §9.1).
export const testSource = {
  key: "fixture",
  name: "Fixtures",
  licence: "CC BY 4.0",
  attribution: "SRD 5.1 by Wizards of the Coast, CC BY 4.0",
};
export const goblinBlock = {
  size: "small",
  ac: 15,
  hpMax: 7,
  initBonus: 2,
  speed: 30,
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
  cr: "1/4",
} as const;
export const wolfBlock = {
  size: "medium",
  ac: 13,
  hpMax: 11,
  initBonus: 2,
  speed: 40,
  abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
  attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", damageType: "piercing" }],
  cr: "1/4",
} as const;
export const miraBlock = {
  size: "medium",
  ac: 16,
  hpMax: 12,
  initBonus: 2,
  speed: 30,
  abilities: { str: 14, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
  saveProficiencies: ["str", "con"] as Ability[],
  attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" }],
  level: 1,
  className: "Fighter",
} as const;
export const thornBlock = {
  size: "medium",
  ac: 14,
  hpMax: 10,
  initBonus: 3,
  speed: 30,
  abilities: { str: 8, dex: 16, con: 14, int: 12, wis: 10, cha: 13 },
  saveProficiencies: ["dex", "int"] as Ability[],
  attacks: [{ name: "Dagger", toHit: 5, damage: "1d4+3", damageType: "piercing" }],
  level: 1,
  className: "Rogue",
} as const;

export function captureLogger() {
  const errors: string[] = [];
  const log: Logger = { ...silentLogger, error: (m) => errors.push(m) };
  return { log, errors };
}

export function entityServices(log: Logger = silentLogger): Services {
  const config = createTestServices().config;
  const clock = manualClock();
  return createServices({
    config,
    db: openTestDb(),
    log,
    clock,
    ctx: () => realContext(clock),
  });
}

export function seedEntities(s: Services) {
  const run = s.commands.run.bind(s.commands);
  const campaign = run(createCampaign, { name: "Fixture Campaign" }, { actor: DM_ACTOR });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: DM_ACTOR });
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: DM_ACTOR });
  const second = run(createCampaign, { name: "Second Campaign" }, { actor: DM_ACTOR });
  run(activateCampaign, { id: second.id }, { actor: DM_ACTOR });
  const p3 = run(addPlayer, { name: "Second Player" }, { actor: DM_ACTOR });
  run(activateCampaign, { id: campaign.id }, { actor: DM_ACTOR });
  const imported = run(
    "import.batch",
    {
      source: testSource,
      records: [
        { kind: "monster", sourceKey: "goblin", data: { name: "Goblin", statBlock: goblinBlock } },
        { kind: "monster", sourceKey: "wolf", data: { name: "Wolf", statBlock: wolfBlock } },
      ],
    },
    { actor: DM_ACTOR },
  ) as { id: string }[];
  const dm: Actor = { ...DM_ACTOR, campaignId: campaign.id };
  const dmSecond: Actor = { ...DM_ACTOR, campaignId: second.id };
  const viewer = (role: "dm" | "player", playerId: string | null = null, cid = campaign.id) =>
    ({ connId: "test", campaignId: cid, role, playerId }) satisfies Viewer;
  const snapshot = (v: Viewer) => s.records.snapshot({ db: s.db, presence: { list: () => [] } }, v);
  return {
    campaignId: campaign.id,
    secondCampaignId: second.id,
    p1,
    p2,
    p3,
    goblinId: imported[0]?.id as string,
    wolfId: imported[1]?.id as string,
    dm,
    dmSecond,
    viewer,
    snapshot,
  };
}
