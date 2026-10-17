import { useFeatureByName } from "@server/features/effect-modifiers/fixture-commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { entityOf } from "../character-sheet-full/steps";

/**
 * MOD §13.1 `uses-rage-spent` (sprint 4, FR-MOD-59): Brakka's Rage row used +3 through
 * `char.useResource` → 0 / 3 left, Rage off (the next toggle on needs an overspend).
 */
export default defineFixture({
  key: "uses-rage-spent",
  kind: "setup",
  requires: ["trg-brakka"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(useFeatureByName, (r) => ({
      characterId: entityOf(r, "char-brakka"),
      feature: "Rage",
      delta: 3,
    })),
  ],
});
