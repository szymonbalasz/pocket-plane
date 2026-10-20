import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-6 gate and the DM's "everything on main" bundle (seams S12): `session-sim-9` + the
 * sprint-6 units, stacked as patches like sim-9 did. Created by IM-1 (first in the schema lane);
 * each sprint-6 slice that adds a unit the gate needs appends it to its track's group below in the
 * same branch (keep both lines on a merge). Every unit loads on top of sim-9's running encounter.
 */
export default defineBundle({
  name: "session-sim-10",
  includes: ["session-sim-9"],
  fixtures: [
    // IM: image search + tags
    // IM-1: 24 tagged library images + 2 attachments (Ruined Keep holds the DM tag `zz-lair-secret`)
    "image-tags",
    // WF: window + layout fixes
    // WF3: no new unit (Fit, pcs pan and the reveal refit walk on sim-9's Goblin Ambush: door
    // (8, 5), party vision, the hidden Elite and Wolf)
    // PF: Preferences, free colour, Subtract
    // CP: companions + summons
  ],
});
