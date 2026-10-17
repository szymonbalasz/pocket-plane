// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
import {
  type PutTriggerWithFeatureInput,
  putTriggerWithFeature,
  useFeatureByName,
} from "@server/features/effect-modifiers/fixture-commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { entityOf, putRowStep } from "../character-sheet-full/steps";

const mira = (r: Refs) => entityOf(r, "char-mira");

/**
 * MOD §13.1 `trg-mira-uses` (sprint 4, review B20): a `feature`-frequency trigger in combat. Mira's
 * feature "Searing Strike" (`usesMax` 2, used 1 → 1 left) and the trigger "Searing Strike" (hit;
 * via weapon; `every: {feature}` = that row; `1d8` fire; public). Homebrew name, no subclass.
 */
export default defineFixture({
  key: "trg-mira-uses",
  kind: "setup",
  requires: ["char-mira-full", "trg-combat"],
  ownerSpec: "effect-modifiers",
  steps: [
    putRowStep((r) => ({
      creatureId: mira(r),
      list: "features",
      row: { name: "Searing Strike", source: "Homebrew", usesMax: 2, reset: "long" },
    })),
    step(useFeatureByName, (r) => ({ characterId: mira(r), feature: "Searing Strike", delta: 1 })),
    step(
      putTriggerWithFeature,
      (r): PutTriggerWithFeatureInput => ({
        trigger: {
          characterId: mira(r),
          name: "Searing Strike",
          public: true,
          rule: {
            on: "hit",
            when: [{ if: "via", via: "weapon" }],
            every: "each",
            then: { do: "damage", formula: "1d8", type: "fire" },
          },
        },
        feature: "Searing Strike",
      }),
    ),
  ],
});
