import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.8 `tray-attacks` (sprint 15, #385) = `rules-effects` + `kit-mira-spells` +
 * `tray-log-rolls`: the fight at round 1, the Wolf's turn (Wolf 18, Brakka 17, Mira 15, Goblin 12,
 * Goblin 2 12, Thorn 10, Elite 8), three unused plain log lines. `PP_TEST_MODE=1` as
 * `rule-triggers`.
 */
export default defineBundle({
  name: "tray-attacks",
  includes: ["rules-effects"],
  fixtures: ["kit-mira-spells", "tray-log-rolls"],
});
