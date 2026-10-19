import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * SCN §13 (sprint 5, K1) `tpl-menu` = `map-tools` (Spirit Guardians `player-1`, Thunderwave
 * `player-2`, Web DM, hidden Glyph on Goblin Ambush) on its own server for the template-menu e2e,
 * which deletes templates (the `map-tools` specs clear them). No new unit: the menu adds no record.
 */
export default defineBundle({
  name: "tpl-menu",
  includes: ["map-tools"],
  fixtures: [],
});
