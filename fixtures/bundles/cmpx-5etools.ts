import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Compendium expansion §13: `base` + the SRD mini set + `town` (a map to drag monsters onto). The
 * books come from the folder at run time: point `PP_5ETOOLS_DIR` at a prepared
 * `fixtures/5etools-mini` (`bun fixtures/5etools-mini/prepare.ts <dir>`), so nothing of it is in the
 * bundle or its DB.
 */
export default defineBundle({
  name: "cmpx-5etools",
  includes: ["base"],
  fixtures: ["cmp-srd-mini-s3", "town"],
});
