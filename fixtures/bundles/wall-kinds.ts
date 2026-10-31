import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * SCN §13 FR-SCN-57–59 `wall-kinds` = `vision` in its own server: the DM draws windows and one-way
 * walls over `scn-walls`, and player-1 sees and walks (or doesn't).
 */
export default defineBundle({
  name: "wall-kinds",
  includes: ["vision"],
  fixtures: [],
});
