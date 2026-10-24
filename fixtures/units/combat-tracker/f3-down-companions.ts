import { applyHp } from "@server/features/combat-tracker/hp";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "./combat-1";
import { CP_COMBAT } from "./cp-combat";

const down = (key: string, index: number) =>
  step(applyHp, (r: Refs) => ({
    combatantId: r.id(key, COMBATANT_TYPE, index),
    kind: "damage" as const,
    amount: 99,
  }));

/**
 * Sprint 11 F3 (BL-110, FR-CBT-50): two down companions in the running ambush (`fu-s7`): Mira's
 * charmed Goblin 2 (`after-owner`, 4 → 0) and Brakka's Drake Companion (`in-owner-turn`, no rank,
 * 22 → 0); still the Wolf's turn. Next → Brakka names the drake, Next past Mira names Goblin 2.
 */
export default defineFixture({
  key: "f3-down-companions",
  kind: "setup",
  requires: ["cp-ally", "cp-combat"],
  ownerSpec: "combat-tracker",
  steps: [down("combat-1", COMBAT_1.goblin2), down("cp-combat", CP_COMBAT.drake)],
});
