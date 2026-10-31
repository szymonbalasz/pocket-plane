import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 15 (BL-175, BL-151): e2e alias for `e2e/s15-toasts.e2e.ts` = `session-sim-13` (a started
 * fight, the PCs on the battle map, Player 1's sheet). The spec moves windows, makes cards and sends
 * roll requests, so it never shares a server. Mira's
 * spell rows make her Actions tab scroll (FR-NOTE-86).
 */
export default defineBundle({
  name: "s15-toasts-e2e",
  includes: ["session-sim-13"],
  fixtures: ["kit-mira-spells", "sg-row", "moil-row"],
});
