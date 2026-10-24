import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** Sprint 10 H4 E2E (`e2e/h4-stores.e2e.ts`): its own copy of `reminders-strongholds` (it moves items). */
export default defineBundle({
  name: "h4-stores-e2e",
  includes: ["reminders-strongholds"],
  fixtures: [],
});
