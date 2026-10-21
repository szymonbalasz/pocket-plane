import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * GEM §13 `gems` (GM0): `session-sim-10` (Goblin Ambush running) + gems on + the awarded counts;
 * GM1: + Mira's lines to reroll (`gems-rolls`). The only bundles with gems on are this one and
 * those built on it; every other bundle stays off.
 */
export default defineBundle({
  name: "gems",
  includes: ["session-sim-10"],
  fixtures: ["gems-on", "gems-awarded", "gems-rolls"],
});
