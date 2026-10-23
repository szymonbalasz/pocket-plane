import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 9 PM `pm-memory` (play-shell §13 sprint 9, walkthrough M0–M14): `session-sim-12` under
 * its own name for the window-memory walkthrough. No new unit (window memory adds no record).
 */
export default defineBundle({
  name: "pm-memory",
  includes: ["session-sim-12"],
  fixtures: [],
});
