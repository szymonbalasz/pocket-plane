import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Theme-system §13 `theme-gilt` (T2 walkthrough D1–D4, P1–P2, CHARX PS1–PS6 under Gilt & Stone;
 * e2e `theme-geometry`): `combat` (session-sim: Mira's full sheet, the Goblin and the Elite
 * Goblin's sheets) + `combat-1` stepped to round 3 (6 combatants) + the four `rolls-1` log lines.
 */
export default defineBundle({
  name: "theme-gilt",
  includes: ["combat"],
  fixtures: ["combat-1", "theme-round-3", "rolls-1"],
});
