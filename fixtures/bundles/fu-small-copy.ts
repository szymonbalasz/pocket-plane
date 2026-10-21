import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 7 FU4 small copy (BL-48 + sim-10 extras, play-shell §13 U15, U17) = `session-sim-10` +
 * `cmp-goblin-untyped` (a type-less fixture Goblin beside `enemy-1`'s typed one, FR-CMP-58).
 * Every other FU4 check walks on sim-10 as loaded. Own name, so `e2e/small-copy-s7.e2e.ts` (which
 * rolls and adds to the party) gets its own server.
 */
export default defineBundle({
  name: "fu-small-copy",
  includes: ["session-sim-10"],
  fixtures: ["cmp-goblin-untyped"],
});
