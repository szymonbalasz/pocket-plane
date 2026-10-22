import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 8 TT4 (dice-extras §13): `table-tools` (sim-11 + macros, the Chime picks, the open
 * Perception request) paused (`camp-paused`).
 */
export default defineBundle({
  name: "table-tools-paused",
  includes: ["table-tools"],
  fixtures: ["camp-paused"],
});
