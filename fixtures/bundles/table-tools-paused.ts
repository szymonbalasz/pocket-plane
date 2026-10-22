import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 8 TT4 (dice-extras §13): the table-tools state, paused (`camp-paused`). Until TT1+TT2's
 * `table-tools` bundle is on main this builds on `session-sim-11` + the Chime picks (TT3).
 */
export default defineBundle({
  name: "table-tools-paused",
  includes: ["session-sim-11"],
  fixtures: ["audio-chime", "camp-alert-sounds", "camp-paused"],
});
