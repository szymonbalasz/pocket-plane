import { setInitiative } from "@server/features/combat-tracker/initiative";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { type AddCombatantsInput, CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * MOD §13 `trg-combat`: Brakka joins the started ambush (`cbtx.addCombatants`, binds her token),
 * initiative 17 → Wolf 18, Brakka 17, Mira 15, Goblin 12, Goblin 2 12, Thorn 10, Elite 8; still
 * round 1, the Wolf's turn.
 */
export default defineFixture({
  key: "trg-combat",
  kind: "setup",
  requires: ["combat-1", "trg-brakka"],
  ownerSpec: "effect-modifiers",
  steps: [
    // Built per server (it takes the combat rule hooks): named, input still type-checked.
    {
      command: CBTX_INTENTS.addCombatants,
      input: (r: Refs): AddCombatantsInput => ({
        encounterId: r.id("encounter-1", ENCOUNTER_TYPE),
        items: [{ characterId: r.id("char-brakka", ENTITY_TYPE) }],
      }),
    },
    step(setInitiative, (r) => ({
      combatantId: r.id("trg-combat", COMBATANT_TYPE),
      value: 17,
    })),
  ],
});
