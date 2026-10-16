import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * DICEX §13: `dice-log` + `char-mira-full` + `dicex-notation-text`. `dicex-looks` joins with D2
 * (`dice-look` records); until then every owner has the derived default look.
 */
export default defineBundle({
  name: "dice-extras",
  includes: ["dice-log"],
  fixtures: ["char-mira-full", "dicex-notation-text"],
});
