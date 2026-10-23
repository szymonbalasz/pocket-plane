import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** RS1 E2E (REM §13): `reminders-strongholds`, its own server for the state-changing spec. */
export default defineBundle({
  name: "rem-ui-e2e",
  includes: ["reminders-strongholds"],
  fixtures: [],
});
