import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** One campaign + `player-1` (FIX §8). */
export default defineBundle({ name: "base", includes: [], fixtures: ["campaign", "player-1"] });
