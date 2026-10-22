import { request } from "@server/features/dice-extras/requests";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { RequestInput } from "@shared/dice-extras/requests";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * Sprint 8 (FR-DICEX-73–77): the DM asked Mira and Thorn for Perception, DC 15 hidden, results
 * hidden: one open request, two pending prompts (no DC in them). Not in session-sim-12 (the sim
 * sends its requests live, seams S15).
 */
export default defineFixture({
  key: "dicex-request-open",
  kind: "setup",
  requires: ["player-1", "player-2", "char-mira", "char-thorn"],
  ownerSpec: "dice-extras",
  steps: [
    step(
      request,
      (r): RequestInput => ({
        roll: { kind: "skill", key: "perception", expression: null },
        characterIds: [r.id("char-mira", ENTITY_TYPE), r.id("char-thorn", ENTITY_TYPE)],
        dc: 15,
        dcShown: false,
        mode: "normal",
        results: "hidden",
      }),
    ),
  ],
});
