import { applyPreset } from "@server/features/effect-modifiers/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

/**
 * MOD §13 `mod-bless`: `bless` from Mira (start concentration) on Mira and Thorn: Mira
 * concentrates on "Bless" + 2 linked Bless effects (+1d4 attacks and saves), 10 rounds.
 */
export default defineFixture({
  key: "mod-bless",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(applyPreset, (r) => {
      const who = (k: keyof typeof COMBAT_1) => r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);
      return {
        targets: [{ combatantId: who("mira") }, { combatantId: who("thorn") }],
        preset: { key: "bless" as const },
        sourceCombatantId: who("mira"),
        startConcentration: true,
      };
    }),
  ],
});
