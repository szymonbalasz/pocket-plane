import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 11 F1 `f1-frame-e2e`: `base` (no scene, no tokens) under its own name, so a player's
 * Recap + Stats + Rules at 1280×720 out of a fight are geometry alone (`e2e/f1-frame.e2e.ts`).
 * No new unit.
 */
export default defineBundle({ name: "f1-frame-e2e", includes: ["base"], fixtures: [] });
