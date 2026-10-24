import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 11 F1 walkthrough bundle `f1-frame`: `session-sim-13` under its own name (Party Manager,
 * Recap, Stats, Rules, the Goblin Ambush), so a walkthrough's reset never touches the gate's.
 * No new unit (the slice is browser-only).
 */
export default defineBundle({ name: "f1-frame", includes: ["session-sim-13"], fixtures: [] });
