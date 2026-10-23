import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { saveReminder } from "@server/features/reminders/commands";

/** REM §13 names (tests and walkthrough RS-R hard-code them). */
export const REM_PARTY_TEXT = "Fresh bread: +1 HP on a short rest";

/** FR-REM-27 `rem-party`: the DM's party reminder, no roll. Session-sim-12-safe (new row only). */
export default defineFixture({
  key: "rem-party",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "reminders",
  steps: [step(saveReminder, { target: { kind: "party" }, text: REM_PARTY_TEXT })],
});
