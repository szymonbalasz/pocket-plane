import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * MAP / SCN §13 (sprint 4) `map-tools` = `vision` + `scn-templates` + `mt-templates` +
 * `mt-crowd`. Goblin Ambush inactive at load (Town live).
 */
export default defineBundle({
  name: "map-tools",
  includes: ["vision"],
  fixtures: ["scn-templates", "mt-templates", "mt-crowd"],
});
