import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { entityOf, putRowStep } from "../character-sheet-full/steps";

/**
 * SHARE §13: Mira's rows whose names match compendium entries: spell "Fireball" (SRD mini, own
 * notes), item "Moonblade Shard" (`cmp-homebrew`, shared); and "Hedge Whisper", a spell no entry
 * names, so a share falls back to the row's own words (FR-SHARE-04).
 */
export default defineFixture({
  key: "share-mira-rows",
  kind: "setup",
  requires: ["char-mira-full", "cmp-homebrew"],
  ownerSpec: "log-share",
  steps: [
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "spells",
      row: {
        name: "Fireball",
        level: 3,
        prepared: true,
        damage: "8d6",
        damageType: "fire",
        roll: "save",
        saveAbility: "dex",
        notes: "Aim away from the party.",
      },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "spells",
      row: {
        name: "Hedge Whisper",
        level: 1,
        prepared: true,
        notes: "A trick Mira learned from the hedge witch.",
      },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "items",
      row: { name: "Moonblade Shard", qty: 1, equipped: true, notes: "Warm to the touch." },
    })),
  ],
});
