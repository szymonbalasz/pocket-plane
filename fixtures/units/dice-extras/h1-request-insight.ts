import { request } from "@server/features/dice-extras/requests";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { RequestInput } from "@shared/dice-extras/requests";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * Sprint 10 H1 (BL-105, FR-DICEX-83 / -84): the DM asked Mira for Insight, results hidden (as
 * sim-13's "All PCs: Perception"), no DC: one open request, one pending prompt for player-1. Its
 * answer is DM + player-1 only; on player-1's screen it throws per their dice settings.
 */
export default defineFixture({
  key: "h1-request-insight",
  kind: "setup",
  requires: ["player-1", "char-mira"],
  ownerSpec: "dice-extras",
  steps: [
    step(
      request,
      (r): RequestInput => ({
        roll: { kind: "skill", key: "insight", expression: null },
        characterIds: [r.id("char-mira", ENTITY_TYPE)],
        dc: null,
        dcShown: false,
        mode: "normal",
        results: "hidden",
      }),
    ),
  ],
});
