import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 11 F3: `fu-s7` + `f3-down-companions` for `e2e/f3-skip-toast.e2e.ts` and
 * `e2e/f3-add-hidden.e2e.ts` (the skip e2e steps turns, so it has its own server).
 */
export default defineBundle({
  name: "f3-skip-e2e",
  includes: ["fu-s7"],
  fixtures: ["f3-down-companions"],
});
