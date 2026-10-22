import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBTX §13.1 `combat-polish` (sprint 8, track CB): `session-sim-11` + a three-way 12-tie (Goblin,
 * Thorn, Fire Elemental 3), Goblin fog-hidden, mixed party values. The one CB walkthrough (CB1–CB13).
 */
export default defineBundle({
  name: "combat-polish",
  includes: ["session-sim-11"],
  fixtures: ["cb-ties", "cb-fog-goblin", "cb-party"],
});
