import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Kit parity K12 `kit-round3` (round 3 combat: Game log box column, the DM toast stack's clear
 * spot, Initiative companion groups, the damage card, Notifications cards; walkthrough + e2e
 * `kit-log`): `kit-parity` (every kit section, the round-3 fight, a pending card, the DM's
 * request summary) + `kit-groups` (Mira's in-turn Fire Elemental line, Thorn's after-owner one).
 */
export default defineBundle({
  name: "kit-round3",
  includes: ["kit-parity"],
  fixtures: ["kit-groups"],
});
