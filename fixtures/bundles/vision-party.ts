import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * FOG §13 (sprint 4) `vision-party` = `vision` + `vision-invisible` (Goblin 2 Invisible, Thorn
 * Sees invisible). Party vision off at load (the default). Positions and walls as `vision`.
 */
export default defineBundle({
  name: "vision-party",
  includes: ["vision"],
  fixtures: ["vision-invisible"],
});
