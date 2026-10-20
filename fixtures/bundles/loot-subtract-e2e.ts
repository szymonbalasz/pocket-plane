import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** `party-loot` under its own name for the PF3 Subtract e2e spec (seams S12; LOOT §13 sprint 6). */
export default defineBundle({
  name: "loot-subtract-e2e",
  includes: ["party-loot"],
  fixtures: [],
});
