import { putTrigger } from "@server/features/effect-modifiers/trigger-commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { PutTriggerInput } from "@shared/effect-modifiers/trigger-intents";
import { startFromTriggerPreset } from "@shared/effect-modifiers/trigger-presets";
import { editStep, entityOf } from "../character-sheet-full/steps";

/**
 * MOD §13 `trg-thorn`: a patch (seams S10) of Thorn's `classes` only (Rogue 5; no other sheet
 * field, so it stacks with `vision-senses`), and "Sneak Attack" started from the built-in
 * `sneak-attack` (FR-MOD-46): `(ceil(level(rogue) / 2))d6` = 3d6, public.
 */
export default defineFixture({
  key: "trg-thorn",
  kind: "setup",
  requires: ["char-thorn"],
  ownerSpec: "effect-modifiers",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "char-thorn"),
      set: { classes: [{ name: "Rogue", level: 5, hitDie: "d8" }] },
    })),
    step(putTrigger, (r): PutTriggerInput => {
      const s = startFromTriggerPreset("sneak-attack", {
        kind: "character",
        id: entityOf(r, "char-thorn"),
      });
      if (!s) throw new Error("trg-thorn: built-in sneak-attack missing");
      return { trigger: s.draft };
    }),
  ],
});
