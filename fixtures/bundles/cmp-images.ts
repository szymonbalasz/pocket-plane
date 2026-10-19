import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** CMP §13.1 `cmp-images` (S5, track C) = `compendium` + `cmp-images`. */
export default defineBundle({
  name: "cmp-images",
  includes: ["compendium"],
  fixtures: ["cmp-images"],
});
