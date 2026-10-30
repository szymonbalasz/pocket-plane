import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** FR-OVW-46: `overview-scenes` + the 300-item crowd, for OVW §13 walkthrough step 12 only. */
export default defineBundle({
  name: "overview-crowd",
  includes: ["overview-scenes"],
  fixtures: ["ovw-crowd"],
});
