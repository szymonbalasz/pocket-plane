import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-7 gate and the DM's "everything on main" bundle (seams S13): `session-sim-10` + the
 * sprint-7 units, stacked as patches like sim-10 did. Created by the integrator at gate 1 (#315);
 * each sprint-7 slice that adds a unit the gate needs appends it to its track's group below in the
 * same branch (keep both lines on a merge). Gems stay OFF here: the DM switches them on live.
 */
export default defineBundle({
  name: "session-sim-11",
  includes: ["session-sim-10"],
  fixtures: [
    // GM: gems (no unit: gems off by default, switched on live in the walkthrough)
    // ST: stats (a past session in the log: `st-past-crypt`, ST core)
    // FU: sprint-6 follow-ups (`cp-ally` charmed Goblin 2 + `fu-hurt-goblins`, FU-combat)
    // FU1: no new unit (the window frame walks on session-sim-10's Goblin Ambush; layout tests
    // use its cells in test-cells.ts)
    // FU3: no new unit (the map follow-ups walk on session-sim-10's Goblin Ambush)
    "cp-ally",
    "fu-hurt-goblins",
  ],
});
