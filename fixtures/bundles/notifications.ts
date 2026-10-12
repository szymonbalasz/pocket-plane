import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** notifications §13: `base` + `player-2` + `campaign-second` + `notifications-test`. Needs PP_TEST_MODE=1. */
export default defineBundle({
  name: "notifications",
  includes: ["base"],
  fixtures: ["player-2", "campaign-second", "notifications-test"],
});
