import { createEntity, UPDATE } from "@server/features/entities/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import {
  type CreateEntityBody,
  ENTITY_TYPE,
  type MonsterStatBlock,
} from "@shared/entities/schemas";

/** Our own numbers, not SRD (CBT §13.3). */
const drakeBlock = {
  size: "medium",
  ac: 15,
  hpMax: 22,
  initBonus: 1,
  speed: 40,
  attacks: [
    {
      name: "Bite",
      toHit: 6,
      damage: "1d6+4",
      damageType: "piercing",
      extraDamage: [{ damage: "1d6", type: "fire" }],
    },
  ],
  cr: "1/2",
  type: "dragon",
} satisfies MonsterStatBlock;

const drake = (r: Refs) => r.id("pet-drake", ENTITY_TYPE);

/**
 * CBT §13.3 `pet-drake` (sprint 6, FR-ENT-33): custom "Drake Companion" made Brakka's pet
 * (`in-owner-turn`) by the whole-replace `PUT` with `companionOf`; token beside Brakka (4, 8),
 * owned by `player-1` (FR-MAP-74).
 */
export default defineFixture({
  key: "pet-drake",
  kind: "setup",
  requires: ["char-brakka", "battlemap"],
  ownerSpec: "entities",
  steps: [
    step(
      createEntity,
      (): CreateEntityBody => ({ kind: "monster", name: "Drake Companion", statBlock: drakeBlock }),
    ),
    {
      command: UPDATE,
      input: (r: Refs) => ({
        id: drake(r),
        name: "Drake Companion",
        statBlock: drakeBlock,
        companionOf: r.id("char-brakka", ENTITY_TYPE),
        turnMode: "in-owner-turn",
      }),
    },
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: drake(r),
      col: 4,
      row: 8,
    })),
  ],
});
