import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** `session-sim-9` under its own name for the Initiative rows e2e spec (WF4): it Ends the Ambush
 * and Starts "Escort to the Ford", so it gets its own server. */
export default defineBundle({
  name: "init-rows-e2e",
  includes: ["session-sim-9"],
  fixtures: [],
});
