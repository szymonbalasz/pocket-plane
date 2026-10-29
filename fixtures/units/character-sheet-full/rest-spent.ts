import { charAdjustHp } from "@server/features/character-sheet/commands";
import { useFeatureByName } from "@server/features/effect-modifiers/fixture-commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { CHARX_INTENTS, type CharUseResourceIntent } from "@shared/character-sheet/sheet";
import { entityOf, putRowStep } from "./steps";

/**
 * Rest buttons (FR-CHARX-121–124, FR-PARTY-79): Mira has spent something of each kind on top of
 * `kit-mira-spells` (1 of 2 1st-level slots): Second Wind 0 / 1 (short), a new Lucky row 1 / 3
 * (long), 1 of 1 d10 hit die, HP 7 / 12. Thorn stays at 3 / 10 (`char-wounds`).
 */
export default defineFixture({
  key: "rest-spent",
  kind: "setup",
  requires: ["kit-mira-spells", "char-wounds"],
  ownerSpec: "character-sheet-full",
  steps: [
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "features",
      row: { name: "Lucky", source: "Feat", usesMax: 3, reset: "long" },
    })),
    step(useFeatureByName, (r) => ({
      characterId: entityOf(r, "char-mira"),
      feature: "Second Wind",
      delta: 1,
    })),
    step(useFeatureByName, (r) => ({
      characterId: entityOf(r, "char-mira"),
      feature: "Lucky",
      delta: 2,
    })),
    {
      command: CHARX_INTENTS.useResource,
      input: (r: Refs): CharUseResourceIntent => ({
        characterId: entityOf(r, "char-mira"),
        resource: { hitDie: "d10" },
        delta: 1,
      }),
    },
    step(charAdjustHp, (r) => ({ characterId: entityOf(r, "char-mira"), delta: -5 })),
  ],
});
