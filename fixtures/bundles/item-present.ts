import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CMP §13 entry present (#455) = `party-cmp` (party board, SRD mini: Potion of Healing) +
 * `cmp-homebrew` + `cmp-images` (Moonlit Lantern, shared, 2 images; CMP-IMG-SECRET, unshared) +
 * `entry-present-1` (the Lantern open on every player's screen).
 */
export default defineBundle({
  name: "item-present",
  includes: ["party-cmp"],
  fixtures: ["cmp-homebrew", "cmp-images", "entry-present-1"],
});
