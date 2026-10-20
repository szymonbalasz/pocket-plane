import { setCompanionCommand } from "@server/features/combat-tracker/companions";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { COMBAT_1 } from "./combat-1";

/**
 * CBT §13.3 `cp-ally` (sprint 6, review 7): `cbt.setCompanion` Goblin 2 → Mira (`after-owner`) in
 * the running fight: a companion combatant without a summon (CP2 / CP4 walk on it).
 */
export default defineFixture({
  key: "cp-ally",
  kind: "setup",
  requires: ["combat-1", "trg-combat"],
  ownerSpec: "combat-tracker",
  steps: [
    step(setCompanionCommand, (r) => ({
      combatantId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.goblin2),
      owner: { characterId: r.id("char-mira", ENTITY_TYPE), turnMode: "after-owner" as const },
    })),
  ],
});
