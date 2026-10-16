import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** DICEX §13: `dice-log` + `char-mira-full` + `dicex-looks` + `dicex-notation-text`. */
export default defineBundle({
  name: "dice-extras",
  includes: ["dice-log"],
  fixtures: ["char-mira-full", "dicex-looks", "dicex-notation-text"],
});
