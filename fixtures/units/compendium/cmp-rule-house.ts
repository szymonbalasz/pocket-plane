import { putEntry } from "@server/features/compendium/homebrew";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { HOUSE_RULES_CHAPTER } from "@shared/compendium/schemas";

/** CMP §13.3 leak marker: an unshared house rule never reaches a player. */
export const SECRET_HOUSE_RULE = "Critical fumbles";
export const SHARED_HOUSE_RULE = "Flanking";

/**
 * CMP §13.3 `cmp-rule-house` (sprint 9; `sp-rules` / `sp-s9` only, not session-sim-13): Fixture
 * Campaign house rules (homebrew `rule`, FR-CMP-67): "Flanking" (shared) and "Critical fumbles"
 * (DM only).
 */
export default defineFixture({
  key: "cmp-rule-house",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "compendium",
  steps: [
    step(putEntry, {
      shared: true,
      entry: {
        kind: "rule",
        name: SHARED_HOUSE_RULE,
        facets: { chapter: HOUSE_RULES_CHAPTER, section: "Combat", order: 0 },
        body: {
          text: "When you and an ally are on opposite sides of a creature, you have advantage on melee attack rolls against it.",
        },
      },
    }),
    step(putEntry, {
      entry: {
        kind: "rule",
        name: SECRET_HOUSE_RULE,
        facets: { chapter: HOUSE_RULES_CHAPTER, section: "Combat", order: 0 },
        body: {
          text: "A natural 1 on an attack roll: roll 1d6. On a 1, you drop your weapon.",
        },
      },
    }),
  ],
});
