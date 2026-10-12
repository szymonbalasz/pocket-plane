import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** CBT §13 `combat` = `session-sim` + `player-2` + `char-thorn` + `thorn-battlemap`. */
export default defineBundle({
  name: "combat",
  includes: ["session-sim"],
  fixtures: ["player-2", "char-thorn", "thorn-battlemap"],
});
