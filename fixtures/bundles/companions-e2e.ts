import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.3 `companions-e2e` (sprint 6): `companions-prep` under its own name; the e2e summons,
 * so it changes state (sprint-4 lesson, seams S12).
 */
export default defineBundle({
  name: "companions-e2e",
  includes: ["companions-prep"],
  fixtures: [],
});
