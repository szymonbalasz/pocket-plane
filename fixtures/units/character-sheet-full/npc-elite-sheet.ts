import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { editStep, entityOf, putRowStep } from "./steps";

/**
 * The DM edits the custom "Elite Goblin Warrior" on its NPC sheet (CHARX §13): Stealth
 * expertise, 2nd attack Shortbow +5 / 1d6+3 piercing, feature "Nimble Escape", "NPC-NOTE-9".
 */
export default defineFixture({
  key: "npc-elite-sheet",
  kind: "setup",
  requires: ["enemy-custom"],
  ownerSpec: "character-sheet-full",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "enemy-custom"),
      set: { skills: { stealth: "expertise" }, notes: "NPC-NOTE-9" },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "enemy-custom"),
      list: "attacks",
      row: { name: "Shortbow", toHit: 5, damage: "1d6+3", damageType: "piercing" },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "enemy-custom"),
      list: "features",
      row: {
        name: "Nimble Escape",
        source: "Goblin",
        text: "Disengage or Hide as a bonus action on each of its turns.",
      },
    })),
  ],
});
