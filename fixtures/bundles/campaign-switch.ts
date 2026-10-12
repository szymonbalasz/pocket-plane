import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** campaign-management §13. */
export default defineBundle({
  name: "campaign-switch",
  includes: ["base"],
  fixtures: ["player-2", "campaign-second"],
});
