import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 10 H2 walkthrough bundle `h2-frame`: `session-sim-13` under its own name (Party Manager,
 * Stronghold, Recap, Rules, the Goblin Ambush), so a walkthrough's reset never touches the gate's.
 * No new unit (the slice is browser-only).
 */
export default defineBundle({ name: "h2-frame", includes: ["session-sim-13"], fixtures: [] });
