import { setColor } from "@server/features/campaign-management/colors";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CAMP §13 sprint 5: as DM, `player-2` picks blue (a pick, so the fixture path runs
 * `camp.setColor`); `player-1` keeps its default jade, the DM amber. Creates no ids or tokens.
 */
export default defineFixture({
  key: "pc-colours",
  kind: "setup",
  requires: ["campaign", "player-2"],
  ownerSpec: "campaign-management",
  steps: [
    step(setColor, (r) => ({ playerId: r.id("player-2", "player"), color: "blue" as const })),
  ],
});
