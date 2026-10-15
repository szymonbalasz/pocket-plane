import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** FOG §13 `fog` = `scenes` + `goblin-2` + `encounter-1` + `fog-ambush` + `fog-ambush-partial`. */
export default defineBundle({
  name: "fog",
  includes: ["scenes"],
  fixtures: ["goblin-2", "encounter-1", "fog-ambush", "fog-ambush-partial"],
});
