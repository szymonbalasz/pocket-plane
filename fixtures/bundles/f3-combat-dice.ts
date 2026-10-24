import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 11 F3 (combat + dice fixes) walkthrough: `fu-s7` (the running ambush, Mira's charmed
 * Goblin 2) + `f3-down-companions` (Goblin 2 and Brakka's Drake Companion at 0, BL-110) +
 * `h1-request-insight` and `f3-request-perception` (Mira's open prompts, BL-112). The Add dialog
 * (BL-113) needs only the running fight.
 */
export default defineBundle({
  name: "f3-combat-dice",
  includes: ["fu-s7"],
  fixtures: ["f3-down-companions", "h1-request-insight", "f3-request-perception"],
});
