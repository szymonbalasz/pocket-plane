import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * ANIM §13 `animated-tokens`: `base`, Town active with Mira (player-1) and two animated Goblin
 * tokens: "Wisp" visible, "Lurker" hidden (`animated-town`).
 */
export default defineBundle({
  name: "animated-tokens",
  includes: ["base"],
  fixtures: ["char-mira", "enemy-1", "images", "town", "animated-token", "animated-town"],
});
