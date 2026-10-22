import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 8 WF `wf-frame-e2e`: `session-sim-11` under its own name for the state-changing e2e
 * (`e2e/window-frame.e2e.ts` Ends and Starts) and `e2e/useful-size.e2e.ts`. CB3 adds
 * `cb-party-six` (a 6-PC party, FR-SHELL-141; it requires `cb-party`).
 */
export default defineBundle({
  name: "wf-frame-e2e",
  includes: ["session-sim-11"],
  fixtures: [
    "cb-party", // CB3 (required by cb-party-six)
    "cb-party-six", // CB3: party.summary useful-size case
  ],
});
