import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-5 gate (sprint-5 step 8) and the DM's "everything on main" bundle: `session-sim-8` + the
 * sprint-5 units, stacked as patches like sim-8 did. Starts as sim-8; each sprint-5 slice that adds
 * a unit the gate needs appends it to its track's group below in the same branch (keep both lines
 * on a merge). Not here: `win-layout` (pre-creates sim-8's live "Crypt" and turns Rage on, review-a
 * #25).
 */
export default defineBundle({
  name: "session-sim-9",
  includes: ["session-sim-8"],
  fixtures: [
    // W: windows + layout
    // D: dice polish
    // R: late damage, trails, ally side
    // P: Loot tab, handouts, uploads + paste, Add to party
    // P0: h6 "Ransom Note" with an attachment (unshared); h2 presented to player-1 (S5-1)
    "handout-attachment",
    "handout-present-1",
    // C: compendium images
    // K: player colours, kept-template menu
  ],
});
