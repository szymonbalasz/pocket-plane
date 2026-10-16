import { applyPreset, putPreset } from "@server/features/effect-modifiers/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

const who = (r: Refs, k: keyof typeof COMBAT_1) => r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);

/**
 * MOD §13 `mod-tier2` (tier 2, R1): campaign preset "Frost Ward" (resistance cold, a `defense`
 * part); built-in Shield of Faith (+2 AC) applied to the Elite (hidden, so its AC part is
 * DM-only). Composes on `mod-presets` + `mod-bane`; touches no other row.
 */
export default defineFixture({
  key: "mod-tier2",
  kind: "setup",
  requires: ["combat-1", "mod-presets", "mod-bane"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(putPreset, {
      preset: {
        characterId: null,
        name: "Frost Ward",
        modifiers: [{ kind: "defense", types: ["cold"], level: "resistance" }],
        durationRounds: 10,
        concentration: false,
        note: "",
      },
    }),
    step(applyPreset, (r) => ({
      targets: [{ combatantId: who(r, "elite") }],
      preset: { key: "shield-of-faith" as const },
    })),
  ],
});
