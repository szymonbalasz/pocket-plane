import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CP1 `cp-pets-e2e` (sprint 6): `companions-prep` under its own name for `e2e/cp-pets.e2e.ts`; the
 * e2e makes and releases a pet, so it changes state (sprint-4 lesson, seams S12).
 */
export default defineBundle({
  name: "cp-pets-e2e",
  includes: ["companions-prep"],
  fixtures: [],
});
