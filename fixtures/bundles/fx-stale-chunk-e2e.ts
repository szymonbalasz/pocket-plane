import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 9 FX3 e2e alias for fx-stale-chunk.e2e.ts (BL-91): = `base`. Its Game log roll writes a
 * line, and state-changing specs never share a server.
 */
export default defineBundle({
  name: "fx-stale-chunk-e2e",
  includes: ["base"],
  fixtures: [],
});
