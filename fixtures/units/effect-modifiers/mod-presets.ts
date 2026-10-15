import { putPreset } from "@server/features/effect-modifiers/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { builtinPreset } from "@shared/effect-modifiers/presets";

const bless = builtinPreset("bless");
if (!bless) throw new Error("mod-presets: built-in bless missing");

/**
 * MOD §13 `mod-presets`: the built-in `bless` customised (note "House: Bless (test)"); campaign
 * preset "Cursed" (−1d4 saves). Tier 2's "Frost Ward" (resist cold) is not built.
 */
export default defineFixture({
  key: "mod-presets",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(putPreset, {
      preset: {
        characterId: null,
        key: "bless",
        name: bless.name,
        modifiers: bless.modifiers,
        durationRounds: bless.durationRounds,
        concentration: bless.concentration,
        note: "House: Bless (test)",
      },
    }),
    step(putPreset, {
      preset: {
        characterId: null,
        name: "Cursed",
        modifiers: [{ kind: "dice", on: { roll: "save" }, dice: "1d4", sign: -1 }],
        durationRounds: null,
        concentration: false,
        note: "",
      },
    }),
  ],
});
