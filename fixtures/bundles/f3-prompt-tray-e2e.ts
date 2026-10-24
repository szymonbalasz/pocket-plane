import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 11 F3 (BL-112): `dice-display` + Mira's two open prompts (`h1-request-insight`,
 * `f3-request-perception`) for `e2e/f3-prompt-tray.e2e.ts`; its answers spend them.
 */
export default defineBundle({
  name: "f3-prompt-tray-e2e",
  includes: ["dice-display"],
  fixtures: ["h1-request-insight", "f3-request-perception"],
});
