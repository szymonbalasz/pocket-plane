import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * FOG §13 `fog` = `scenes` + `vision-legacy` + `goblin-2` + `encounter-1` + `fog-ambush` +
 * `fog-ambush-partial`. Sprint 4 (review A4): `vision-legacy` stores Mira's and Thorn's senses as
 * 0 / 0, so the sprint-2 static fog stays exact under the 999 ft default; it runs first, so the
 * fog edits after it re-derive Goblin Ambush (the senses edit only marks that prep scene stale).
 */
export default defineBundle({
  name: "fog",
  includes: ["scenes"],
  fixtures: ["vision-legacy", "goblin-2", "encounter-1", "fog-ambush", "fog-ambush-partial"],
});
