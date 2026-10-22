import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** CBTX §13.1 e2e alias for cb-turn-ring.e2e.ts (CB2): = `combat-polish` (state-changing specs never share a server). */
export default defineBundle({
  name: "cb-turn-ring-e2e",
  includes: ["combat-polish"],
  fixtures: [],
});
