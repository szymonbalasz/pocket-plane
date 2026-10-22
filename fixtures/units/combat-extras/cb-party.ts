import { addEffect } from "@server/features/combat-extras/effect-commands";
import { setTempHp } from "@server/features/combat-extras/play-state";
import { applyHp } from "@server/features/combat-tracker/hp";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

/**
 * CBTX §13.1 `cb-party` (sprint 8; joins session-sim-12): mixed party values for the party
 * summary: Thorn temp HP 5 (`cbtx.setTempHp`), Mira poisoned (`cbtx.addEffect`), Brakka 20 damage
 * (`cbt.applyHp`, 35 / 55). No turn change.
 */
export default defineFixture({
  key: "cb-party",
  kind: "setup",
  requires: ["cp-combat"],
  ownerSpec: "combat-extras",
  steps: [
    step(setTempHp, (r) => ({
      target: { characterId: r.id("char-thorn", ENTITY_TYPE) },
      value: 5,
    })),
    step(addEffect, (r) => ({
      targets: [{ combatantId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.mira) }],
      kind: "condition" as const,
      condition: "poisoned" as const,
    })),
    step(applyHp, (r) => ({
      combatantId: r.id("trg-combat", COMBATANT_TYPE),
      kind: "damage" as const,
      amount: 20,
    })),
  ],
});
