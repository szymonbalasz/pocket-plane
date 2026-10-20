import { setColor } from "@server/features/campaign-management/colors";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** Lavender: ΔE 58.4 from Amber, 34.4 from Jade; Blue 2.3 and Sky 4.9 for colour-blind views. */
export const LAVENDER = "#b388ff";

/**
 * CAMP §13 sprint 6: as DM, `player-2` gets a free (non-palette) colour, lavender, replacing
 * `pc-colours`' Blue; so Player 1 sees Blue and Sky blocked (FR-CAMP-32). One `camp.setColor`, no
 * encounter step: loads on top of `session-sim-9` too (seams S12). Creates no ids or tokens.
 */
export default defineFixture({
  key: "pc-colour-free",
  kind: "setup",
  requires: ["pc-colours"],
  ownerSpec: "campaign-management",
  steps: [step(setColor, (r) => ({ playerId: r.id("player-2", "player"), color: LAVENDER }))],
});
