import { applyPreset, putPreset } from "@server/features/effect-modifiers/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

const who = (r: Refs, k: keyof typeof COMBAT_1) => r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);

/**
 * MOD §13.1 `mod-fire-ward` (sprint 4, FR-MOD-58): campaign preset "Fire Ward" (`defense`
 * resistance fire), applied to Goblin (not Goblin 2), so a fire part presets Half on Goblin only.
 */
export default defineFixture({
  key: "mod-fire-ward",
  kind: "setup",
  requires: ["combat-1", "mod-presets"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(putPreset, {
      preset: {
        characterId: null,
        name: "Fire Ward",
        modifiers: [{ kind: "defense", types: ["fire"], level: "resistance" }],
        durationRounds: null,
        concentration: false,
        note: "",
      },
    }),
    step(applyPreset, (r) => ({
      targets: [{ combatantId: who(r, "goblin") }],
      preset: { presetId: r.id("mod-fire-ward", EFFECT_PRESET_TYPE) },
    })),
  ],
});
