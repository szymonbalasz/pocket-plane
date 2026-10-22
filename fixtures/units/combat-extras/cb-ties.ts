import { setInitiative } from "@server/features/combat-tracker/initiative";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";
import { CP_COMBAT } from "../combat-tracker/cp-combat";

/**
 * CBTX §13.1 `cb-ties` (sprint 8, CB0; joins session-sim-12): `cbt.setInitiative` Thorn → 12 and
 * Fire Elemental 3 (Thorn's `own` summon) → 12: a three-way tie with Goblin, sorted by the default
 * rules (Goblin, Thorn, Fire Elemental 3); no `tieOrder` anywhere. Order: Wolf 18, Brakka 17, Mira
 * 15 (+ Goblin 2, Owlbear, Fire Elemental), Goblin 12, Thorn 12, Fire Elemental 3 12, Elite 8.
 */
export default defineFixture({
  key: "cb-ties",
  kind: "setup",
  requires: ["cp-combat", "cp-ally"],
  ownerSpec: "combat-extras",
  steps: [
    step(setInitiative, (r) => ({
      combatantId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.thorn),
      value: 12,
    })),
    step(setInitiative, (r) => ({
      combatantId: r.id("cp-combat", COMBATANT_TYPE, CP_COMBAT.fe3),
      value: 12,
    })),
  ],
});
