import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 8 track TT (dice-extras §13, walkthrough T): `session-sim-11` + the macros, the Chime
 * sound and the DM's picks, and the open Perception request to Mira and Thorn (its prompts show as
 * restored card toasts on players' loads, FR-DICEX-91). TT4's `table-tools-paused` includes it
 * (+ `camp-paused`); `table-tools-e2e` is this bundle under its own name.
 */
export default defineBundle({
  name: "table-tools",
  includes: ["session-sim-11"],
  fixtures: ["dicex-macros", "audio-chime", "camp-alert-sounds", "dicex-request-open"],
});
