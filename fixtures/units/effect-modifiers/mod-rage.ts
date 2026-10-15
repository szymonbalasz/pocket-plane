import { putPreset } from "@server/features/effect-modifiers/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { ENTITY_TYPE } from "@shared/entities/schemas";

const rage = builtinPreset("rage");
if (!rage) throw new Error("mod-rage: built-in rage missing");

/**
 * MOD §13 `mod-rage`: Thorn's character preset "Rage" started from `rage` (tier 1: +2 weapon
 * damage only), off. Tier 3's feature row and `usesFeatureId` are not built.
 */
export default defineFixture({
  key: "mod-rage",
  kind: "setup",
  requires: ["char-thorn"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(putPreset, (r) => ({
      preset: {
        characterId: r.id("char-thorn", ENTITY_TYPE),
        name: rage.name,
        modifiers: rage.modifiers,
        durationRounds: rage.durationRounds,
        concentration: rage.concentration,
        note: rage.note,
      },
    })),
  ],
});
