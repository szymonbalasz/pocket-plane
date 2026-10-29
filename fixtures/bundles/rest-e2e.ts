import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Rest buttons (CHARX §13, FR-CHARX-121–124, FR-PARTY-79): `character-sheet-full` + Mira's spent
 * slot, uses, hit die and HP (`kit-mira-spells`, `rest-spent`); Thorn wounded (`char-wounds`).
 */
export default defineBundle({
  name: "rest-e2e",
  includes: ["character-sheet-full"],
  fixtures: ["kit-mira-spells", "rest-spent"],
});
