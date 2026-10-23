import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 10 H2 `h2-frame-e2e`: `base` (no scene, no tokens) under its own name, so the frame's
 * window sizes and the L3s shrink are geometry alone (`e2e/h2-frame.e2e.ts`). No new unit.
 */
export default defineBundle({ name: "h2-frame-e2e", includes: ["base"], fixtures: [] });
