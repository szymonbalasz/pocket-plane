import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Kit-parity §13 K2 `kit-initiative` (walkthrough + e2e `kit-initiative`): `theme-gilt` (round 3,
 * Wolf's turn, 6 combatants) + Mira hit to 6 / 12 and the Elite's pending damage card
 * (`combat-hit`, `combat-pending`) + effects (Mira concentrating on Bless, Goblin prone, …:
 * `cbtx-effects`) + temp HP (`cbtx-temp`). Existing units only (no new record type).
 */
export default defineBundle({
  name: "kit-initiative",
  includes: ["theme-gilt"],
  fixtures: ["combat-hit", "combat-pending", "cbtx-effects", "cbtx-temp"],
});
