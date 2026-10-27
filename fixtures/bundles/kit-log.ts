import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Kit parity §13 K1 (Game log rows walkthrough; e2e `kit-log`): `theme-gilt` (round 3, the four
 * `rolls-1` lines incl. the DM's hidden roll) + Mira's crit attack, damage and heal as player-1.
 */
export default defineBundle({
  name: "kit-log",
  includes: ["theme-gilt"],
  fixtures: ["kit-log-rolls"],
});
