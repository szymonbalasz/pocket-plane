import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 8 TT3 (dice-extras §13): `mid-combat` + the Chime sound + the DM's picks (`request`,
 * `pause` → Chime; `turn` the ping). Mira's turn is a Next away, so the `turn` alert can fire.
 */
export default defineBundle({
  name: "alert-sounds",
  includes: ["mid-combat"],
  fixtures: ["audio-chime", "camp-alert-sounds"],
});
