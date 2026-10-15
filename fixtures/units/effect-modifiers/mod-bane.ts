import { applyPreset } from "@server/features/effect-modifiers/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

const who = (r: Refs, k: keyof typeof COMBAT_1) => r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);

/**
 * MOD §13 `mod-bane`: `bane` on Goblin from Elite (hidden), start concentration (Elite
 * concentrates on Bane, a hidden copy; the Goblin's Bane is linked); `mod-presets`' "Cursed"
 * secret on Goblin 2. Tier 2's Shield of Faith on Elite is not built.
 */
export default defineFixture({
  key: "mod-bane",
  kind: "setup",
  requires: ["combat-1", "mod-presets"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(applyPreset, (r) => ({
      targets: [{ combatantId: who(r, "goblin") }],
      preset: { key: "bane" as const },
      sourceCombatantId: who(r, "elite"),
      startConcentration: true,
    })),
    step(applyPreset, (r) => ({
      targets: [{ combatantId: who(r, "goblin2") }],
      preset: { presetId: r.id("mod-presets", EFFECT_PRESET_TYPE, 1) },
      secret: true,
    })),
  ],
});
