import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** live-sync §13. Needs PP_TEST_MODE=1 (probes). */
export default defineBundle({
  name: "sync-probe",
  includes: ["base"],
  fixtures: ["player-2", "campaign-second", "sync-probes"],
});
