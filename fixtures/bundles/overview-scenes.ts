import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** FR-OVW-46: `scenes` (with `player-1`, `player-2`) + Sword Coast (shown), Phandalin. */
export default defineBundle({
  name: "overview-scenes",
  includes: ["scenes"],
  fixtures: ["ovw-sword-coast", "ovw-phandalin"],
});
