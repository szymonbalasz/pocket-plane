import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-5 track W (SHELL §13, windows and layout): `session-sim-8` + `win-layout` (Brakka's Rage
 * on, the planned "Crypt" with Crypt Ogre and Goblin 3 on Goblin Ambush). Combat stays as sim-8
 * left it (round 1, Wolf's turn). `win-layout` stays out of `session-sim-9` (it creates "Crypt"
 * and spends Rage live).
 */
export default defineBundle({
  name: "windows-s5",
  includes: ["session-sim-8"],
  fixtures: ["win-layout"],
});
