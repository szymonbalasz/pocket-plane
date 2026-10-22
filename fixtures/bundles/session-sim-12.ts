import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-8 gate and the DM's "everything on main" bundle (seams S15): `session-sim-11` + the
 * sprint-8 units, stacked as patches like sim-11 did. Created empty by TT0 (`fix/tt-core`); each
 * sprint-8 slice that adds a unit the gate needs appends it to its track's group below in the same
 * branch (keep both lines on a merge). Every unit must be session-sim-11-safe (review A #7): no
 * `gems-on`, no dependence on `st-ambush-facts`, respect `cp-ally` / `fu-hurt-goblins`. Not here:
 * `dicex-request-open`, `camp-paused` (the sim does those live).
 */
export default defineBundle({
  name: "session-sim-12",
  includes: ["session-sim-11"],
  fixtures: [
    // WF: window frame (no unit: aliases only, seams S15)
    // TT: table tools (`dicex-macros` TT1, `audio-chime` + `camp-alert-sounds` TT3)
    "dicex-macros",
    "audio-chime",
    "camp-alert-sounds",
    // SB: stats tier B (`sb-fight-facts`, `sb-luck-rolls`)
    // CB: combat polish (`cb-ties`, `cb-fog-goblin`, `cb-party`)
    // CB0: a three-way 12-tie (Thorn, Fire Elemental 3, Goblin), Goblin fog-hidden, party values
    "cb-ties",
    "cb-fog-goblin",
    "cb-party",
  ],
});
