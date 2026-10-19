import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.1 `late-damage` (sprint 5, track R; review B10): R0 creates it as `rules-effects`; each
 * slice appends its own unit when it merges (R1 `late-hit-ruled`, R3 `trail-moves`, R4
 * `enc-friendly`). session-sim-9 stacks the same three units on session-sim-8.
 */
export default defineBundle({
  name: "late-damage",
  includes: ["rules-effects"],
  fixtures: [
    // R1: Mira's Light crossbow ruled a hit on Goblin 2, waiting for damage
    "late-hit-ruled",
    // R4: planned "Escort to the Ford", Goblin ×2 + 1 friendly
    "enc-friendly",
  ],
});
