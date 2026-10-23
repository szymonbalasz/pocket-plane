import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** RS2's E2E (`e2e/hold-ui.e2e.ts`): its own copy of `reminders-strongholds` (the spec edits it). */
export default defineBundle({
  name: "hold-ui-e2e",
  includes: ["reminders-strongholds"],
  fixtures: [],
});
