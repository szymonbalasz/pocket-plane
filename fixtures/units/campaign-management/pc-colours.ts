import { setColor } from "@server/features/campaign-management/colors";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { PLAYER_COLORS } from "@shared/campaign-management/colors";

/**
 * CAMP §13 sprint 5: as DM, `player-2` picks blue (a pick, so the fixture path runs
 * `camp.setColor`); `player-1` keeps its default jade, the DM amber. Creates no ids or tokens.
 * Sprint 6: the pick is Blue's hex (keys are no longer accepted, FR-CAMP-33).
 */
export default defineFixture({
  key: "pc-colours",
  kind: "setup",
  requires: ["campaign", "player-2"],
  ownerSpec: "campaign-management",
  steps: [
    step(setColor, (r) => ({ playerId: r.id("player-2", "player"), color: PLAYER_COLORS.blue })),
  ],
});
