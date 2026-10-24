import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 10 H1 (BL-105): `dice-display` + `h1-request-insight` (Mira's open hidden Insight prompt)
 * for `e2e/h1-prompt-roll.e2e.ts`; the Roll answers it, so the spec has a bundle of its own.
 */
export default defineBundle({
  name: "h1-prompt-roll-e2e",
  includes: ["dice-display"],
  fixtures: ["h1-request-insight"],
});
