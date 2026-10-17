import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CMP §13 `compendium-full` (S4) = `compendium` + `cmp-srd-full` + `cmp-search-homebrew`. The
 * `compendium` bundle stays the fast mini set. (Entities' `ent-art-tokens` joins with C-art.)
 */
export default defineBundle({
  name: "compendium-full",
  includes: ["compendium"],
  fixtures: ["cmp-srd-full", "cmp-search-homebrew"],
});
