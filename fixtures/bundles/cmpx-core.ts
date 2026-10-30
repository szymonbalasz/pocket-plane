import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Compendium-expansion X1 core: `base` + `player-2` + `char-mira` + the SRD mini set + two
 * hand-made books whose entries replace SRD entries and each other's (`cmpx-books`).
 */
export default defineBundle({
  name: "cmpx-core",
  includes: ["base"],
  fixtures: ["player-2", "char-mira", "cmp-srd-mini-s3", "cmpx-books"],
});
