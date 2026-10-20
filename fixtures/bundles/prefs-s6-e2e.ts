import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** `prefs-s6` under its own name for the state-changing PF e2e spec (seams S12). */
export default defineBundle({
  name: "prefs-s6-e2e",
  includes: ["prefs-s6"],
  fixtures: [],
});
