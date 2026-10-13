import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** CBT §13 `mid-combat` = `combat` + `combat-1` + `combat-hit` + `combat-pending` (OQ-FIX-04). */
export default defineBundle({
  name: "mid-combat",
  includes: ["combat"],
  fixtures: ["combat-1", "combat-hit", "combat-pending"],
});
