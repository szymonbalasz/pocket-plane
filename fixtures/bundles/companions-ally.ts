import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.3 `companions-ally` (sprint 6, review 7): `late-damage` + Goblin 2 made Mira's
 * companion in the running fight (`cbt.setCompanion`). Needs only CP0 (walkthrough S5–S6).
 */
export default defineBundle({
  name: "companions-ally",
  includes: ["late-damage"],
  fixtures: ["cp-ally"],
});
