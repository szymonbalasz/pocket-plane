import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 9 track FX, slice FX3 (`fix/fx-sync-shell`): `session-sim-12` + Mira's Bless beside
 * Thorn's summon concentration (FR-CBTX-75, walkthrough FX3 step 5).
 */
export default defineBundle({
  name: "fx-s9",
  includes: ["session-sim-12"],
  fixtures: ["fx-mira-bless"],
});
