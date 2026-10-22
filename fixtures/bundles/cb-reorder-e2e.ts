import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** CBTX §13.1 e2e alias for cb-reorder.e2e.ts (CB0's raw-intent reorder, CB1's drag): = `combat-polish` (state-changing specs never share a server). */
export default defineBundle({
  name: "cb-reorder-e2e",
  includes: ["combat-polish"],
  fixtures: [],
});
