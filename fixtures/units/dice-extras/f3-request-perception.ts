import { request } from "@server/features/dice-extras/requests";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { RequestInput } from "@shared/dice-extras/requests";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * Sprint 11 F3 (BL-112, FR-DICEX-83): a second open request, public Perception for Mira only, so
 * player-1 holds two prompts: one answered through a closed tray (it closes again), one through
 * a tray that was already open (it stays open on the result).
 */
export default defineFixture({
  key: "f3-request-perception",
  kind: "setup",
  requires: ["player-1", "char-mira"],
  ownerSpec: "dice-extras",
  steps: [
    step(
      request,
      (r): RequestInput => ({
        roll: { kind: "skill", key: "perception", expression: null },
        characterIds: [r.id("char-mira", ENTITY_TYPE)],
        dc: null,
        dcShown: false,
        mode: "normal",
        results: "public",
      }),
    ),
  ],
});
