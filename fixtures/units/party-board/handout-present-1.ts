import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { presentHandout } from "@server/features/party-board/present-commands";
import { HANDOUT_TYPE } from "@shared/party-board/schemas";
import { HANDOUTS_1 } from "./handouts-1";

/**
 * PARTY §13.1 `handout-present-1` (patch: one row): presents h2 "Thieves' Map" (shared with
 * player-1 only) to player-1 (`party.presentHandout`, players [player-1]). One `handout-present`
 * row; the popup waits for player-1's next connect (walkthrough S5-1).
 */
export default defineFixture({
  key: "handout-present-1",
  kind: "setup",
  requires: ["handouts-1"],
  ownerSpec: "party-board",
  steps: [
    step(presentHandout, (r) => ({
      handoutId: r.id("handouts-1", HANDOUT_TYPE, HANDOUTS_1.h.thievesMap),
      to: { mode: "players" as const, playerIds: [r.id("player-1", "player")] },
    })),
  ],
});
