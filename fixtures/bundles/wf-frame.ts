import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 8 WF `wf-frame` (play-shell §13 sprint 8): `session-sim-11` under its own name for the
 * one-placer walkthrough (F0–F14). No new unit (seams S15: WF adds nothing to session-sim-12).
 */
export default defineBundle({
  name: "wf-frame",
  includes: ["session-sim-11"],
  fixtures: [],
});
