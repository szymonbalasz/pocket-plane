import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.1 e2e alias for undo-move.e2e.ts (FR-CBT-179–181, #457): = `late-damage`, whose
 * `trail-moves` leave this turn's move steps (state-changing specs never share a server).
 */
export default defineBundle({
  name: "undo-move-e2e",
  includes: ["late-damage"],
  fixtures: [],
});
