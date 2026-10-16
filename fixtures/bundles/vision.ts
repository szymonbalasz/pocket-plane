import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * FOG §13 `vision` = `scenes` + `goblin-2` + `encounter-1` + `fog-ambush` + `scn-walls` +
 * `vision-senses` + `vision-crypt` (dynamic vision, darkness, Explored memory on).
 */
export default defineBundle({
  name: "vision",
  includes: ["scenes"],
  fixtures: ["goblin-2", "encounter-1", "fog-ambush", "scn-walls", "vision-senses", "vision-crypt"],
});
