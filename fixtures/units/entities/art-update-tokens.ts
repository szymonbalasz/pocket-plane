import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { MAP_INTENTS, TOKEN_TYPE, type UpdateTokenInput } from "@shared/scenes-map/schemas";
import { srdMiniMonsterId } from "../compendium/srd-mini-refs";

const scene = (r: Refs) => r.id("battlemap", "scene");
const srd = (r: Refs, slug: Parameters<typeof srdMiniMonsterId>[2]) =>
  srdMiniMonsterId(r, "cmp-srd-mini-s3", slug);

/**
 * ENT §13 `art-update-tokens` (S4, review B37): on `battlemap` (row 11, clear of `ent-art-tokens`):
 * SRD Goblin (8, 11), SRD Ogre (10, 11), SRD Wolf (13, 11), all `creatureType` null (their
 * sprint-3 definitions have no type); then Wolf → Art ▸ Initials (`"initials"`, FR-ENT-27).
 */
export default defineFixture({
  key: "art-update-tokens",
  kind: "setup",
  requires: ["battlemap", "cmp-srd-mini-s3"],
  ownerSpec: "entities",
  steps: [
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: srd(r, "goblin"),
      col: 8,
      row: 11,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: srd(r, "ogre"),
      col: 10,
      row: 11,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: srd(r, "wolf"),
      col: 13,
      row: 11,
    })),
    {
      command: MAP_INTENTS.updateToken,
      input: (r: Refs): UpdateTokenInput => ({
        tokenId: r.id("art-update-tokens", TOKEN_TYPE, 2),
        creatureType: "initials",
      }),
    },
  ],
});
