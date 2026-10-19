import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 5, track W4 (`e2e/init-chips-effect.e2e.ts`, play-shell §13 W6–W8): `windows-s5`
 * unchanged under its own name, so the e2e gets its own server (it makes Goblin 2 invisible and
 * blinds Mira, which `window-layout.e2e.ts` doesn't expect). Brakka's Rage on ("Rage 10r" +
 * Divine Fury); combat at round 1, the hidden Wolf's turn. No new unit: W4 adds no record (0 B).
 */
export default defineBundle({
  name: "init-chips-effect",
  includes: ["windows-s5"],
  fixtures: [],
});
