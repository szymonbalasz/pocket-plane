import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBTX §13 `combat-extras` = `combat` + `combat-1` + `cbtx-effects` + `cbtx-temp` +
 * `cbtx-reinforcement` (round 1, Wolf's turn).
 */
export default defineBundle({
  name: "combat-extras",
  includes: ["combat"],
  fixtures: ["combat-1", "cbtx-effects", "cbtx-temp", "cbtx-reinforcement"],
});
