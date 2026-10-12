import { addPlayer } from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** Optional second player, stable link. */
export default defineFixture({
  key: "player-2",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "campaign-management",
  steps: [step(addPlayer, { name: "Player 2" })],
});
