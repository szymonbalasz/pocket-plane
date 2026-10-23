import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** REM / HOLD §13 E2E alias of `reminders-strongholds` (same units; state-changing specs own theirs). */
export default defineBundle({
  name: "rs-e2e",
  includes: ["reminders-strongholds"],
  fixtures: [],
});
