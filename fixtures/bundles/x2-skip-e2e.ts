import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 12 X2 (BL-122): `f3-skip-e2e` again for `e2e/x2-skip-toast.e2e.ts` (it steps turns, so
 * it has its own server). No new unit.
 */
export default defineBundle({
  name: "x2-skip-e2e",
  includes: ["f3-skip-e2e"],
  fixtures: [],
});
