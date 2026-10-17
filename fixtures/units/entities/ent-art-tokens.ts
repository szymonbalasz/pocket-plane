import { createEntity } from "@server/features/entities/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { srdMiniMonsterId } from "../compendium/srd-mini-refs";
import { IMG } from "../scenes-map/town";

const scene = (r: Refs) => r.id("battlemap", "scene");
const srd = (r: Refs, slug: Parameters<typeof srdMiniMonsterId>[2]) =>
  srdMiniMonsterId(r, "cmp-srd-mini", slug);

/**
 * ENT §13 `ent-art-tokens` (S4, FR-ENT-27): custom "Plain Brute" (no `type`, no portrait) and, on
 * `battlemap` (rows 1–3, clear of its own tokens): SRD Goblin (8, 2), fixture Goblin (9, 2), Elite
 * Goblin Warrior (10, 2), SRD Adult Red Dragon (4, 1, huge), SRD Wolf with the `images` wolf token
 * image (12, 2; image beats art), Plain Brute (14, 2), SRD Ogre hidden (17, 1, large).
 */
export default defineFixture({
  key: "ent-art-tokens",
  kind: "setup",
  requires: ["battlemap", "images", "cmp-srd-mini", "enemy-custom"],
  ownerSpec: "entities",
  steps: [
    step(createEntity, {
      kind: "monster",
      name: "Plain Brute",
      statBlock: {
        size: "medium",
        ac: 12,
        hpMax: 20,
        initBonus: 0,
        speed: 30,
        attacks: [{ name: "Slam", toHit: 4, damage: "1d8+2", damageType: "bludgeoning" }],
        cr: "1",
      },
    }),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: srd(r, "goblin"),
      col: 8,
      row: 2,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("enemy-1", IMPORTED_ENTITY_TYPE),
      col: 9,
      row: 2,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("enemy-custom", ENTITY_TYPE),
      col: 10,
      row: 2,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: srd(r, "adult-red-dragon"),
      col: 4,
      row: 1,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: srd(r, "wolf"),
      col: 12,
      row: 2,
      imageAssetId: r.id("images", "asset", IMG.wolf),
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("ent-art-tokens", ENTITY_TYPE),
      col: 14,
      row: 2,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: srd(r, "ogre"),
      col: 17,
      row: 1,
      hidden: true,
    })),
  ],
});
