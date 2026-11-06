import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * class-resources §13: `base` + `char-vex` (Sorcerer 5 / Warlock 2 with pact slots, a pact
 * weapon and a pact-weapon trigger).
 */
export default defineBundle({
  name: "class-resources",
  includes: ["base"],
  fixtures: ["char-vex"],
});
