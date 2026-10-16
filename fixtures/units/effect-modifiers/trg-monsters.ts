import { putTrigger } from "@server/features/effect-modifiers/trigger-commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import type { PutTriggerInput } from "@shared/effect-modifiers/trigger-intents";
import { startFromTriggerPreset } from "@shared/effect-modifiers/trigger-presets";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";

/** A definition trigger started from a built-in (FR-MOD-46); `public` off (OQ-MOD-26). */
const fromBuiltin =
  (key: string, definitionId: (r: Refs) => string) =>
  (r: Refs): PutTriggerInput => {
    const s = startFromTriggerPreset(key, { kind: "definition", id: definitionId(r) });
    if (!s) throw new Error(`trg-monsters: built-in ${key} missing`);
    return { trigger: s.draft };
  };

/**
 * MOD §13 `trg-monsters`: definition triggers (DM only, FR-MOD-47) from the built-ins: "Martial
 * Advantage" (2d6, ask "an ally within 5 ft") on the Elite's definition (custom) and
 * "Regeneration" (turn-start reminder, 10 HP) on the Wolf's (imported; the row is this campaign's).
 */
export default defineFixture({
  key: "trg-monsters",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(
      putTrigger,
      fromBuiltin("martial-advantage", (r) => r.id("enemy-custom", ENTITY_TYPE)),
    ),
    step(
      putTrigger,
      fromBuiltin("regeneration", (r) => r.id("enemy-2", IMPORTED_ENTITY_TYPE)),
    ),
  ],
});
