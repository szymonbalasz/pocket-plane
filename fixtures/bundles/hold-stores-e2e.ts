import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** RS3's E2E (`e2e/hold-stores.e2e.ts`): its own copy of `reminders-strongholds` (it moves coin and items). */
export default defineBundle({
  name: "hold-stores-e2e",
  includes: ["reminders-strongholds"],
  fixtures: [],
});
