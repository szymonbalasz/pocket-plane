import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { MAP_INTENTS, TOKEN_TYPE, type UpdateTokenInput } from "@shared/scenes-map/schemas";
import { IMG } from "../scenes-map/town";

/** NOTES N9 (FR-NOTES-29) `notes-tokens`: the token names tests hard-code. */
export const NOTES_TOKENS = {
  /** Town's Mira (5, 5) is the character token; this NPC (Goblin) shares her name. */
  npcMira: { name: "Mira", col: 8, row: 5 },
  /** A Wolf hidden from players: the DM's Create asks first. */
  hidden: { name: "Shadow", col: 10, row: 5 },
} as const;

/**
 * On Town (active, revealed): a visible Goblin named "Mira" (NPC, no `characterId`) at (8, 5) and
 * a hidden Wolf named "Shadow" at (10, 5). Placing numbers a taken name ("Mira 2", FR-MAP-16), so
 * the Goblin is renamed after, as the DM would.
 */
export default defineFixture({
  key: "notes-tokens",
  kind: "setup",
  requires: ["town", "enemy-1", "enemy-2"],
  ownerSpec: "linked-notes",
  steps: [
    step(placeToken, (r) => ({
      sceneId: r.id("town", "scene"),
      definitionId: r.id("enemy-1", "imported-entity"),
      col: NOTES_TOKENS.npcMira.col,
      row: NOTES_TOKENS.npcMira.row,
      imageAssetId: r.id("images", "asset", IMG.goblin),
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("town", "scene"),
      definitionId: r.id("enemy-2", "imported-entity"),
      name: NOTES_TOKENS.hidden.name,
      col: NOTES_TOKENS.hidden.col,
      row: NOTES_TOKENS.hidden.row,
      imageAssetId: r.id("images", "asset", IMG.wolf),
      hidden: true,
    })),
    {
      command: MAP_INTENTS.updateToken,
      input: (r: Refs): UpdateTokenInput => ({
        tokenId: r.id("notes-tokens", TOKEN_TYPE, 0),
        name: NOTES_TOKENS.npcMira.name,
      }),
    },
  ],
});
