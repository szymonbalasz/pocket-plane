import { applyHp } from "@server/features/combat-tracker/hp";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "./combat-1";

const damage = (k: "goblin" | "goblin2", amount: number) =>
  step(applyHp, (r: Refs) => ({
    combatantId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]),
    kind: "damage" as const,
    amount,
  }));

/**
 * Play-shell §13 sprint 7 `fu-hurt-goblins` (FU-combat, FR-CBT-141; joins session-sim-11): the DM's
 * damage (FR-CBT-21) in the running Goblin Ambush: Goblin −7 → 0 / 7 Down, Goblin 2 −3 → 4 / 7; no
 * turn change. End → Start "Escort to the Ford" then shows the kept-HP rule on both.
 */
export default defineFixture({
  key: "fu-hurt-goblins",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "combat-tracker",
  steps: [damage("goblin", 7), damage("goblin2", 3)],
});
