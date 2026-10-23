import { request } from "@server/features/dice-extras/requests";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { RequestInput } from "@shared/dice-extras/requests";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * Sprint 10 H1 (BL-105, FR-DICEX-83 / -84): the DM asked Mira for Insight, results hidden (as
 * sim-13's "All PCs: Perception"), no DC: one open request, pending prompts for Mira (player-1) and
 * Thorn (player-2). Each answer is DM + its player only; on that player's screen it throws per
 * their dice settings (Thorn's prompt: the physical-dice popover over the toast, H1 re-test).
 */
export default defineFixture({
  key: "h1-request-insight",
  kind: "setup",
  requires: ["player-1", "player-2", "char-mira", "char-thorn"],
  ownerSpec: "dice-extras",
  steps: [
    step(
      request,
      (r): RequestInput => ({
        roll: { kind: "skill", key: "insight", expression: null },
        characterIds: [r.id("char-mira", ENTITY_TYPE), r.id("char-thorn", ENTITY_TYPE)],
        dc: null,
        dcShown: false,
        mode: "normal",
        results: "hidden",
      }),
    ),
  ],
});
