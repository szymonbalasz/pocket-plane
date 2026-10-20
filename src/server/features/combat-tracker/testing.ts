// Test support for combat-tracker: the scenes seed (two campaigns, players, goblin + wolf, Mira,
// Thorn) plus "Elite Goblin Warrior" and a battlemap like CBT §13's `combat` bundle: Mira,
// Goblin, Goblin 2 visible; Wolf, Elite hidden; Thorn.
import {
  type CombatantRecord,
  DamageCardPayload,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import { asc, eq } from "drizzle-orm";
import { combatant } from "../../db/schema";
import { createEntity } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { createScene, placeToken } from "../scenes-map/commands";
import { scenesSetup } from "../scenes-map/testing";
import { createEncounter } from "./encounters";
import { toCombatantRecord } from "./rows";

/**
 * FR-CBT-94 (sprint 5): the card's damage `rollId` as `cbt.applyCard` must name it (null = none
 * yet), from a card row or a client store's notification record.
 */
export const damageRollIdOf = (card: unknown): string | null =>
  DamageCardPayload.parse((card as { payload?: unknown } | undefined)?.payload).damage?.rollId ??
  null;

/** Record IDs (UUIDs, real or seeded) anywhere; tokens / asset IDs as whole JSON strings. */
const ID_SHAPES =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|"[A-Za-z0-9_-]{22}"/gi;

/**
 * BL-33: the leak strings found in `text` (raw frames / JSON), IDs masked first so a random ID
 * that happens to spell a short leak (e.g. "2d6" in a hex UUID) is not a false hit.
 */
export const leaksIn = (text: string, leaks: readonly string[]): string[] => {
  const masked = text.replace(ID_SHAPES, "<id>");
  return leaks.filter((leak) => masked.includes(leak));
};

export const eliteBlock = {
  ...goblinBlock,
  ac: 16,
  hpMax: 15,
  attacks: [{ name: "Scimitar", toHit: 5, damage: "1d6+3", damageType: "slashing" }],
  cr: "1/2",
  saveProficiencies: ["dex"],
} as const;

export function combatSetup() {
  const t = scenesSetup();
  const { run, h } = t;
  const elite = run<{ id: string }>(createEntity.name, {
    kind: "monster",
    name: "Elite Goblin Warrior",
    derivedFromId: h.goblinId,
    portraitAssetId: "art-elite",
    statBlock: eliteBlock,
  });
  const scene = run<{ id: string }>(createScene.name, {
    name: "Goblin Ambush",
    mapAssetId: "map-battle",
  });
  // FR-FOG-25 ripple: new scenes start fogged; this battlemap is revealed (as the fixture).
  run(FOG_INTENTS.setAll, { sceneId: scene.id, fogged: false });
  const place = (definitionId: string, col: number, row: number, hidden = false) =>
    run<{ tokenId: string }>(placeToken.name, {
      sceneId: scene.id,
      definitionId,
      col,
      row,
      hidden,
    }).tokenId;
  const tokens = {
    mira: place(t.miraId, 2, 7),
    goblin: place(h.goblinId, 12, 6),
    wolf: place(h.wolfId, 14, 4, true),
    elite: place(elite.id, 15, 8, true),
    goblin2: place(h.goblinId, 12, 8),
    thorn: place(t.thornId, 2, 9),
  };
  const createAmbush = () =>
    run<EncounterRecord>(createEncounter.name, {
      name: "Ambush at the Ford",
      partyCharacterIds: null,
      entries: [
        { definitionId: h.goblinId, quantity: 2 },
        { definitionId: h.wolfId, quantity: 1 },
        { definitionId: elite.id, quantity: 1 },
      ],
    });
  const combatants = (encounterId: string): CombatantRecord[] =>
    t.s.db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, encounterId))
      .orderBy(asc(combatant.seq))
      .all()
      .map(toCombatantRecord);
  const byName = (encounterId: string) =>
    Object.fromEntries(combatants(encounterId).map((c) => [c.name, c])) as Record<
      string,
      CombatantRecord
    >;
  const p1 = t.player(h.p1);
  const p2 = t.player(h.p2);
  return {
    ...t,
    eliteId: elite.id,
    sceneId: scene.id,
    tokens,
    createAmbush,
    combatants,
    byName,
    p1,
    p2,
  };
}

export type CombatSetup = ReturnType<typeof combatSetup>;
