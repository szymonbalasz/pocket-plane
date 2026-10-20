import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** `session-sim-9` under its own name for the toast-home e2e spec (WF2): a fresh server, so the
 * sim-9 ruled card's pending summary is still showing (state-changing specs share sim-9). */
export default defineBundle({
  name: "toast-home-e2e",
  includes: ["session-sim-9"],
  fixtures: [],
});
