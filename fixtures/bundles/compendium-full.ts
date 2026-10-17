import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CMP §13 `compendium-full` (S4) = `compendium` + `cmp-srd-full` + `cmp-search-homebrew` +
 * entities' `ent-art-tokens` (ENT §13, token art). The `compendium` bundle stays the fast mini set.
 */
export default defineBundle({
  name: "compendium-full",
  includes: ["compendium"],
  fixtures: ["cmp-srd-full", "cmp-search-homebrew", "ent-art-tokens"],
});
