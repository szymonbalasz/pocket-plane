import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 5, track W4 (`e2e/init-chips-effect.e2e.ts`, play-shell §13 W6–W8): `session-sim-8`
 * unchanged under its own name, so the e2e gets its own server (it forces Brakka's Rage on, makes
 * Goblin 2 invisible and blinds Mira). Combat as sim-7 left it: round 1, the hidden Wolf's turn.
 * No new unit: W4 adds no record (0 B). `windows-s5` (W1) replaces it once on main.
 */
export default defineBundle({
  name: "init-chips-effect",
  includes: ["session-sim-8"],
  fixtures: [],
});
