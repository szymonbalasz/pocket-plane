import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** assets-pipeline §13, walkthrough B (run at the Scenes gate by scenes-map's test agent). */
export default defineBundle({
  name: "asset-access",
  includes: ["session-sim"],
  fixtures: ["player-2"],
});
