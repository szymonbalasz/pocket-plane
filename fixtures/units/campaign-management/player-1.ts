import { addPlayer } from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** Player "Player 1" in Fixture Campaign; stable link via the seeded seam. */
export default defineFixture({
  key: "player-1",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "campaign-management",
  steps: [step(addPlayer, { name: "Player 1" })],
});
